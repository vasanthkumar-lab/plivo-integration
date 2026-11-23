import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import * as plivoSdk from 'plivo';
import { PlivoConfig } from './plivo.config';
import { CrmService } from '../crm/crm.service';
import { partyFromDialSource, statusFromCallStatus, statusFromCause, titleForOutcome, describeOutcome } from '../crm/call-outcome';
import { EventsService } from '../events/events.service';

@Injectable()
export class PlivoService {
  private readonly log = new Logger('Plivo');

  constructor(
    private readonly config: PlivoConfig,
    private readonly crm: CrmService,
    private readonly events: EventsService,
  ) {}

  // ------------------------------------------------------------------
  // Rep login: mint a short-lived JWT for this rep's endpoint.
  // ------------------------------------------------------------------
  async mintToken(repId: string): Promise<{ token: string; endpoint: string; expiresIn: number; simulated: boolean }> {
    const rep = this.crm.getRep(repId);
    if (!rep) throw new Error(`Unknown rep ${repId}`);

    this.events.wire({
      actor: 'browser',
      kind: 'http',
      label: 'GET /api/plivo/token',
      detail: `rep ${rep.name} asks the backend for a calling token`,
      body: { repId },
    });

    if (!this.config.live) {
      const token = `sim.${Buffer.from(JSON.stringify({ sub: rep.endpoint, exp: Date.now() + this.config.tokenTtlSec * 1000 })).toString('base64url')}`;
      this.events.wire({
        actor: 'backend',
        kind: 'note',
        label: 'JWT minted (simulated)',
        detail: `no credentials configured - issuing a local token for sip:${rep.endpoint}@phone.plivo.com`,
      });
      return { token, endpoint: rep.endpoint, expiresIn: this.config.tokenTtlSec, simulated: true };
    }

    const now = Math.floor(Date.now() / 1000);
    const url = `https://api.plivo.com/v1/Account/${this.config.authId}/JWT/Token/`;
    const payload: Record<string, unknown> = {
      iss: this.config.authId,
      sub: rep.endpoint,
      // Backdated: this machine's clock can run slightly ahead of Plivo's, and a
      // future `nbf` is rejected as INVALID_ACCESS_TOKEN.
      nbf: now - this.config.clockSkewSec,
      exp: now + this.config.tokenTtlSec,
      per: { voice: { incoming_allow: true, outgoing_allow: true } },
    };

    // Tie the session to the Application the endpoints are linked to, so call
    // routing is unambiguous. Plivo rejects an empty string here.
    if (this.config.appId) payload.app = this.config.appId;

    this.events.wire({
      actor: 'backend',
      kind: 'http',
      label: 'POST api.plivo.com/.../JWT/Token/',
      detail: 'Basic Auth with Auth ID + Auth Token (server side only)',
      body: payload,
    });

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${Buffer.from(`${this.config.authId}:${this.config.authToken}`).toString('base64')}`,
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const text = await res.text();
      this.log.error(`JWT mint failed ${res.status}: ${text}`);
      throw new Error(`Plivo token request failed (${res.status})`);
    }

    const data = (await res.json()) as { token: string };
    this.events.wire({
      actor: 'plivo',
      kind: 'http',
      label: '200 OK - signed JWT',
      detail: `valid ${this.config.tokenTtlSec}s for sip:${rep.endpoint}@phone.plivo.com`,
    });

    return { token: data.token, endpoint: rep.endpoint, expiresIn: this.config.tokenTtlSec, simulated: false };
  }

  /** Never interpolate raw webhook values into XML -- escape them. */
  private esc(value: string): string {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  /**
   * <Dial> has no recording attributes -- `record="true"` on Dial is silently
   * ignored, which is why no audio ever arrived. Recording a bridged call is
   * done through the Record API once the call is up, so ask Plivo to tell us
   * when that happens.
   */
  private recordAttrs(): string {
    if (!this.config.recordCalls) return '';
    const cb = `${this.esc(this.config.publicUrl)}/plivo/dial-event`;
    return ` callbackUrl="${cb}" callbackMethod="POST"`;
  }

  /** Call UUIDs we have already asked Plivo to record, so we never start twice. */
  private readonly recording = new Set<string>();

  /**
   * Start recording an in-progress call.
   * POST /Call/{call_uuid}/Record/ — the result arrives later on callback_url
   * as record_url, so this returns nothing useful by itself.
   */
  async startRecording(callUuid: string): Promise<void> {
    if (!this.config.recordCalls || !this.config.live) return;
    if (!callUuid || this.recording.has(callUuid)) return;
    this.recording.add(callUuid);

    const url = `https://api.plivo.com/v1/Account/${this.config.authId}/Call/${callUuid}/Record/`;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Basic ${Buffer.from(`${this.config.authId}:${this.config.authToken}`).toString('base64')}`,
        },
        body: JSON.stringify({
          file_format: 'mp3',
          // Without this, Plivo stops recording after 60 seconds.
          time_limit: this.config.recordMaxSeconds,
          callback_url: `${this.config.publicUrl}/plivo/recording`,
          callback_method: 'POST',
        }),
      });

      if (!res.ok) {
        this.recording.delete(callUuid);
        const text = await res.text();
        this.log.warn(`record start failed ${res.status}: ${text.slice(0, 200)}`);
        this.events.wire({
          actor: 'backend',
          kind: 'note',
          label: `Recording could not start (${res.status})`,
          detail: text.slice(0, 120),
        });
        return;
      }

      this.events.wire({
        actor: 'backend',
        kind: 'http',
        label: 'POST /Call/{uuid}/Record/',
        detail: 'recording started for this call',
      });
    } catch (err) {
      this.recording.delete(callUuid);
      this.log.error(`record start error: ${(err as Error).message}`);
    }
  }

  /**
   * Pull recordings straight from Plivo and attach any we have not seen.
   * The callback is the fast path, but it can be missed (tunnel restarted,
   * server down), and Plivo's Recordings API is the source of truth.
   */
  async syncRecordings(limit = 20): Promise<number> {
    if (!this.config.live) return 0;

    try {
      const res = await fetch(
        `https://api.plivo.com/v1/Account/${this.config.authId}/Recording/?limit=${limit}`,
        {
          headers: {
            Authorization: `Basic ${Buffer.from(`${this.config.authId}:${this.config.authToken}`).toString('base64')}`,
          },
        },
      );
      if (!res.ok) return 0;

      const data = (await res.json()) as { objects?: any[] };
      let added = 0;

      for (const rec of data.objects ?? []) {
        const callUuid = String(rec.call_uuid ?? '');
        const url = String(rec.recording_url ?? '');
        if (!callUuid || !url) continue;

        let call = this.crm.getCallByUuid(callUuid);
        if (call?.recordingUrl) continue;

        // The call log is in memory, so a restart loses it while the recording
        // still exists at Plivo. Rebuild the record from Plivo's own call
        // details rather than dropping the recording on the floor.
        if (!call) {
          const detail = await this.fetchCallDetail(callUuid);
          if (!detail) continue;

          call = this.crm.saveCallStart({
            callUuid,
            from: detail.from_number ?? '',
            to: detail.to_number ?? '',
            direction: detail.call_direction === 'outbound' ? 'inbound' : 'outbound',
            // Without this the rebuilt row is stamped "now", so every restart
            // collapsed the whole history into the moment the sync ran.
            startedAt: this.plivoTime(detail.initiation_time ?? rec.add_time),
          });
          this.crm.saveCallEnd(callUuid, {
            status: 'completed',
            durationSec: Number(detail.call_duration ?? rec.recording_duration ?? 0),
            endedAt: this.plivoTime(detail.end_time),
          });
        }

        this.crm.attachRecording(callUuid, url, Number(rec.recording_duration ?? 0));
        added++;
      }

      if (added) {
        this.events.wire({
          actor: 'backend',
          kind: 'note',
          label: `Synced ${added} recording${added === 1 ? '' : 's'} from Plivo`,
          detail: 'found by polling, not by callback',
        });
        this.events.emit({ type: 'crm-updated', payload: { reason: 'recording' } });
      }
      return added;
    } catch (err) {
      this.log.warn(`recording sync failed: ${(err as Error).message}`);
      return 0;
    }
  }

  /**
   * Plivo stamps times as "2026-11-20 04:15:30+00:00" -- close to ISO, but the
   * space makes it unparseable in Safari, so normalise before constructing.
   */
  private plivoTime(value: unknown): string | null {
    if (!value) return null;
    const d = new Date(String(value).trim().replace(' ', 'T'));
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }

  /** Plivo's record of one call, used to rebuild a log entry we no longer hold. */
  private async fetchCallDetail(callUuid: string): Promise<Record<string, any> | null> {
    try {
      const res = await fetch(
        `https://api.plivo.com/v1/Account/${this.config.authId}/Call/${callUuid}/`,
        {
          headers: {
            Authorization: `Basic ${Buffer.from(`${this.config.authId}:${this.config.authToken}`).toString('base64')}`,
          },
        },
      );
      return res.ok ? ((await res.json()) as Record<string, any>) : null;
    } catch {
      return null;
    }
  }

  /** Forget a finished call so a later call with the same id could record again. */
  clearRecordingFlag(callUuid: string) {
    this.recording.delete(callUuid);
  }

  /** Strip stray whitespace so <Number> never ends up with a leading space. */
  private normalizeNumber(value: string): string {
    return String(value ?? '').replace(/[\s\-()]/g, '').trim();
  }

  /**
   * Is this number complete enough for Plivo to route?
   * E.164 allows at most 15 digits, and anything under 11 (country code plus a
   * national number) is an unfinished entry rather than a real destination.
   */
  isDialable(value: string): boolean {
    const digits = this.toE164(value).replace(/\D/g, '');
    return digits.length >= 11 && digits.length <= 15;
  }

  /**
   * Put a dialled number into E.164, because Plivo will not route anything else.
   * A bare "9361778524" is rejected instantly as NO_ANSWER, which looks to the
   * caller like the other end simply did not pick up.
   */
  toE164(value: string): string {
    const raw = this.normalizeNumber(value);
    if (raw.startsWith('sip:')) return raw;

    let digits = raw.replace(/\D/g, '');
    if (!digits) return raw;

    const cc = this.config.defaultCountryCode;

    // 00 international prefix -> drop it; it is already fully qualified.
    if (digits.startsWith('00')) digits = digits.slice(2);
    // Local trunk prefix, e.g. 0 9361778524
    else if (digits.length === 11 && digits.startsWith('0')) digits = cc + digits.slice(1);
    // Bare national number, e.g. 9361778524
    else if (digits.length === 10) digits = cc + digits;

    return `+${digits}`;
  }

  /**
   * Who is reachable for inbound calls.
   *
   * Trust `online`, not `sipRegistered`. Plivo's sip_registered flag tracks SIP
   * *device* registrations and stays "false" for Browser SDK / JWT sessions even
   * while the browser is connected and taking calls, so it is reported only for
   * completeness. `online` comes from the SDK's own onLogin/onLogout, which is
   * what actually decides whether the Answer URL rings a browser.
   */
  async endpointStatus() {
    if (!this.config.live) {
      return this.crm.getReps().map((r) => ({
        repId: r.id,
        name: r.name,
        endpoint: r.endpoint,
        online: r.online,
        sipRegistered: null,
        note: 'simulator mode',
      }));
    }

    const res = await fetch(
      `https://api.plivo.com/v1/Account/${this.config.authId}/Endpoint/`,
      {
        headers: {
          Authorization: `Basic ${Buffer.from(`${this.config.authId}:${this.config.authToken}`).toString('base64')}`,
        },
      },
    );
    const data = (await res.json()) as { objects?: any[] };
    const objects = data.objects ?? [];

    return this.crm.getReps().map((r) => {
      const ep = objects.find((o) => o.username === r.endpoint);
      return {
        repId: r.id,
        name: r.name,
        endpoint: r.endpoint,
        /** Authoritative: driven by the Browser SDK's onLogin / onLogout. */
        online: r.online,
        /** Informational only -- always false for Browser SDK sessions. */
        sipRegistered: ep ? ep.sip_registered === 'true' : false,
        note: ep ? undefined : 'no such endpoint in Plivo - run npm run plivo:setup',
      };
    });
  }

  // ------------------------------------------------------------------
  // Answer URL: Plivo asks what to do with a call that just started.
  // ------------------------------------------------------------------
  handleAnswer(body: Record<string, any>): { xml: string; decision: string } {
    const From = String(body.From ?? '');
    const To = String(body.To ?? '');
    const CallUUID = String(body.CallUUID ?? randomUUID());

    this.events.wire({
      actor: 'plivo',
      kind: 'http',
      label: 'POST /plivo/answer',
      detail: 'Plivo asks the backend what to do with this call',
      body: { From, To, CallUUID, Direction: body.Direction, 'X-PH-LeadId': body['X-PH-LeadId'] ?? null },
    });

    // A browser call arrives at Plivo as *inbound*, so Direction alone is not enough.
    // If From starts with sip:, a rep is dialling out. Otherwise a customer is dialling in.
    const repIsCalling = From.startsWith('sip:');
    let xml: string;
    let decision: string;

    if (repIsCalling) {
      // Plivo reports the caller as sip:<username>_<AUTH_ID>@phone.plivo.com,
      // so strip the account suffix before matching the rep.
      const endpoint = From.replace(/^sip:/, '').split('@')[0].split('_')[0];
      const rep = this.crm.getRepByEndpoint(endpoint);
      const lead = this.crm.getLead(String(body['X-PH-LeadId'] ?? '')) ?? this.crm.findLeadByPhone(To);

      const record = this.recordAttrs();
      const dest = this.toE164(To);
      xml =
        `<Response>\n` +
        `  <Dial callerId="${this.esc(this.config.phoneNumber)}"${record}>\n` +
        `    <Number>${this.esc(dest)}</Number>\n` +
        `  </Dial>\n` +
        `</Response>`;
      decision = `Outbound: dial ${dest} from ${this.config.phoneNumber}`;

      this.crm.saveCallStart({
        callUuid: CallUUID,
        from: From,
        to: To,
        direction: 'outbound',
        leadId: lead?.id ?? null,
        repId: rep?.id ?? (body['X-PH-RepId'] ? String(body['X-PH-RepId']) : null),
      });
    } else {
      const lead = this.crm.findLeadByPhone(From);
      // Prefer the lead's owner when we recognise the caller, but fall back to
      // whoever is registered. An unknown number is still a call worth taking.
      const rep = this.crm.findRepForPhone(From) ?? this.crm.findAnyOnlineRep();

      if (rep) {
        const record = this.recordAttrs();

        // A Browser SDK session authenticated with a JWT registers as
        // "<username>_<AUTH_ID>" -- that is the From Plivo reports on outbound
        // calls -- while the Endpoint resource's sip_uri has no suffix. Which
        // one receives the INVITE depends on how the endpoint logged in, so ring
        // both: <Dial> rings every <User> in parallel and the registered one wins.
        const targets = [rep.endpoint];
        if (this.config.authId) targets.push(`${rep.endpoint}_${this.config.authId}`);

        xml =
          `<Response>\n` +
          `  <Dial timeout="30"${record}>\n` +
          targets.map((t) => `    <User>sip:${this.esc(t)}@phone.plivo.com</User>\n`).join('') +
          `  </Dial>\n` +
          `  <Speak>Sorry, we could not connect you. Please try again later.</Speak>\n` +
          `</Response>`;
        decision = lead
          ? `Inbound: ring ${rep.name} (owns ${lead.name})`
          : `Inbound: ring ${rep.name} (caller not in CRM)`;
      } else {
        // No rep online for this caller: take a voicemail instead of dropping the lead.
        xml =
          `<Response>\n` +
          `  <Speak>Thanks for calling. Our team is unavailable. Please leave a message after the beep.</Speak>\n` +
          `  <Record maxLength="120" action="${this.esc(this.config.publicUrl)}/plivo/voicemail" />\n` +
          `</Response>`;
        decision = 'Inbound: no rep online - record voicemail';
      }

      this.crm.saveCallStart({
        callUuid: CallUUID,
        from: From,
        to: To,
        direction: 'inbound',
        leadId: lead?.id ?? null,
        repId: rep?.id ?? null,
      });

      // Only ring the UI ourselves in simulator mode. In live mode the Browser
      // SDK receives the real WebRTC INVITE and fires onIncomingCall -- raising
      // our own event too would show a popup with no SDK call behind it, and
      // client.answer() would then throw "Cannot read properties of undefined".
      if (rep && !this.config.live) {
        this.events.emit({
          type: 'incoming-call',
          payload: {
            callUuid: CallUUID,
            from: From,
            repId: rep.id,
            repEndpoint: rep.endpoint,
            lead: lead ?? null,
            simulated: true,
          },
        });
      }
    }

    this.events.wire({
      actor: 'backend',
      kind: 'xml',
      label: '200 OK - Plivo XML',
      detail: decision,
      body: xml,
    });

    // Belt and braces: the dial callback is the primary trigger, but if it does
    // not arrive the call is still recordable once it is up. startRecording()
    // de-duplicates, so whichever fires first wins.
    if (this.config.recordCalls && this.config.live) {
      setTimeout(() => void this.startRecording(CallUUID), 6000);
    }

    return { xml, decision };
  }

  /**
   * The dial webhook fires before the Hangup URL and is the only place Plivo
   * says who released the call, so this is where "customer hung up" vs "rep
   * hung up" is actually decided.
   */
  handleDialHangup(body: Record<string, any>) {
    const callUuid = String(body.CallUUID ?? body.DialALegUUID ?? '');
    if (!callUuid) return null;

    const call = this.crm.getCallByUuid(callUuid);
    if (!call) return null;

    const source = String(body.DialBLegHangupSource ?? '');
    const cause = String(body.DialBLegHangupCause ?? '');
    const causeName = String(body.DialBLegHangupCauseName ?? '');
    // Absent means "unknown" (leave what we have); "0" means a genuinely
    // zero-length leg, which is the truth for a cancelled or unanswered call.
    const dialled =
      body.DialBLegDuration === undefined || body.DialBLegDuration === null
        ? undefined
        : Number(body.DialBLegDuration);

    const endedBy = partyFromDialSource(source, call.direction);
    // A bridged leg that never had any duration was never really connected,
    // whatever the cause says.
    const status = statusFromCause(cause) ?? ((dialled ?? 0) > 0 ? 'completed' : 'no-answer');

    this.crm.noteCallOutcome(callUuid, endedBy, causeName || cause || null);
    this.crm.saveCallEnd(callUuid, {
      status,
      durationSec: dialled,
      endedBy,
      endReason: causeName || cause || null,
    });

    this.events.wire({
      actor: 'backend',
      kind: 'note',
      label: titleForOutcome({ ...call, status, endedBy }),
      detail: describeOutcome({ ...call, status, endedBy, durationSec: dialled }),
    });

    return this.crm.getCallByUuid(callUuid);
  }

  // ------------------------------------------------------------------
  // Hangup URL: the call is over. Log it against the lead.
  // ------------------------------------------------------------------
  handleHangup(body: Record<string, any>) {
    const CallUUID = String(body.CallUUID ?? '');
    const durationSec = Number(body.Duration ?? body.BillDuration ?? 0);
    const rawStatus = String(body.CallStatus ?? 'completed');

    /**
     * Plivo's CallStatus vocabulary includes "cancel" and "timeout", which the
     * old whitelist did not cover -- both fell through to "completed", so a
     * call nobody answered was logged as a successful conversation.
     */
    const existing = this.crm.getCallByUuid(CallUUID);
    const status =
      statusFromCallStatus(rawStatus) ??
      // The dial webhook already classified this one; do not undo its work.
      (existing && existing.status !== 'in-progress' && existing.status !== 'ringing'
        ? existing.status
        : durationSec > 0
          ? 'completed'
          : 'no-answer');

    this.events.wire({
      actor: 'plivo',
      kind: 'http',
      label: 'POST /plivo/hangup',
      detail: 'call finished - Plivo reports the outcome',
      body: { CallUUID, Duration: durationSec, CallStatus: rawStatus, RecordUrl: body.RecordUrl ?? null },
    });

    const hangupSource = String(body.HangupSource ?? '');
    const call = this.crm.saveCallEnd(CallUUID, {
      status,
      durationSec,
      recordingUrl: body.RecordUrl ? String(body.RecordUrl) : null,
      // Only a fallback: the dial webhook is more precise and ran first.
      endedBy: existing?.endedBy ?? (hangupSource ? partyFromDialSource(hangupSource, existing?.direction ?? 'outbound') : null),
      endReason: existing?.endReason ?? (body.HangupCauseName ? String(body.HangupCauseName) : null),
    });

    if (call) {
      this.events.wire({
        actor: 'backend',
        kind: 'note',
        label: titleForOutcome(call),
        detail: call.leadId
          ? `${describeOutcome(call)} Activity added to ${call.leadId}.`
          : `${describeOutcome(call)} No matching lead.`,
      });
      this.events.emit({ type: 'call-ended', payload: call });
    }

    return call;
  }

  // ------------------------------------------------------------------
  // Webhook authenticity: X-Plivo-Signature-V3
  // ------------------------------------------------------------------
  /**
   * Uses Plivo's own validator. The V3 scheme folds the HTTP method, the full
   * URL, the sorted POST parameters and the nonce into one HMAC-SHA256 -- easy
   * to get subtly wrong by hand, and a wrong implementation rejects every real
   * webhook with 403, which looks exactly like a dead tunnel.
   */
  verifySignature(
    method: string,
    url: string,
    nonce: string,
    signature: string,
    params: Record<string, any>,
  ): boolean {
    if (!this.config.live) return true; // nothing to verify against in simulator mode
    if (!this.config.verifyWebhooks) return true; // explicitly disabled for local testing
    if (!signature || !nonce) return false;

    // Plivo sends one signature per active Auth Token, comma separated.
    return signature.split(',').some((candidate) => {
      try {
        return plivoSdk.validateV3Signature(
          method,
          url,
          nonce.trim(),
          this.config.authToken,
          candidate.trim(),
          params,
        );
      } catch {
        return false;
      }
    });
  }
}
