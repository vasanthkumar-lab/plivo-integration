import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { Activity, CallLog, Disposition, EndedBy, Lead, Rep } from './crm.types';
import { describeOutcome } from './call-outcome';
import { CrmRepository } from './crm.repository';

/** What gets written to disk. Rep presence is runtime state and stays out. */
interface CrmSnapshot {
  version: number;
  savedAt: string;
  leadSeq: number;
  leads: Lead[];
  calls: CallLog[];
  activities: Activity[];
}

/**
 * The CRM store. In the real product this is your Postgres/Prisma layer -- the
 * Plivo integration only ever touches it through these methods.
 *
 * Held in memory for speed and mirrored to a JSON file so it survives a
 * restart. Without that mirror every `nest start --watch` reload wiped the
 * pipeline, the call log and the activity timeline, which made real calls look
 * like they had never happened.
 */
@Injectable()
export class CrmService implements OnApplicationShutdown, OnModuleInit {
  private readonly log = new Logger('CRM');

  private reps: Rep[] = [
    { id: 'u_ravi', name: 'Ravi Kumar', endpoint: 'repravi', avatarColor: '#22c55e', online: false },
    { id: 'u_meera', name: 'Meera Nair', endpoint: 'repmeera', avatarColor: '#14b8a6', online: false },
    { id: 'u_arjun', name: 'Arjun Shah', endpoint: 'reparjun', avatarColor: '#a3e635', online: false },
  ];

  /**
   * No invented contacts. The pipeline fills from real activity: every number
   * actually dialled or received becomes a contact, and contacts can be added
   * by hand. Replace this array with a query against the real CRM database.
   */
  private leads: Lead[] = [];
  private leadSeq = 1000;

  private calls: CallLog[] = [];
  private activities: Activity[] = [];

  /** Override with CRM_STORE_FILE to point at another path (or a tmpfs in CI). */
  private readonly storeFile = process.env.CRM_STORE_FILE
    ? resolve(process.env.CRM_STORE_FILE)
    : resolve(__dirname, '..', '..', '.data', 'crm.json');

  private saveTimer: NodeJS.Timeout | null = null;

  /** True once Postgres is the store; the JSON file is then left untouched. */
  private usingDb = false;

  /**
   * Resolves once the working set is final -- restored from disk and, if a
   * database is configured, replaced by what it holds.
   *
   * Anything that adjusts call rows at boot must await this. Nest's hook
   * ordering is an implementation detail, and a write made before the swap is
   * silently thrown away with the array it was made on.
   */
  private markLoaded!: () => void;
  private readonly loaded = new Promise<void>((resolve) => {
    this.markLoaded = resolve;
  });

  whenLoaded(): Promise<void> {
    return this.loaded;
  }

  constructor(private readonly repo: CrmRepository) {
    this.applyRealEndpoints();
    // Postgres is not connected yet at construction time, so the JSON store
    // loads first and onModuleInit swaps in the database when it is ready.
    this.restore();
  }

  /**
   * Postgres becomes the source of truth once it is up.
   *
   * On an empty database the JSON store that just loaded is imported, so an
   * existing pipeline survives the move rather than starting over.
   */
  async onModuleInit() {
    try {
      const live = await this.repo.ensureReady();
      if (!live) return;

      if (await this.repo.isEmpty()) {
        if (this.leads.length || this.calls.length) {
          await this.repo.importSnapshot({
            leads: this.leads,
            calls: this.calls,
            activities: this.activities,
          });
        }
      } else {
        const data = await this.repo.loadAll();
        this.leads = data.leads;
        this.calls = data.calls;
        this.activities = data.activities;
        this.leadSeq = Math.max(
          1000,
          // Strip NON-digits: /D/ (without the backslash) matches a literal "D",
        // leaves "L-1001" intact, yields NaN, and the next contact silently
        // reuses an id that already exists.
        ...this.leads.map((l) => Number(String(l.id).replace(/\D/g, '')) || 0),
        );
      }
      this.usingDb = true;
      this.log.log(
        `Postgres is the store: ${this.leads.length} contacts, ${this.calls.length} calls, ` +
          `${this.activities.length} activities`,
      );
    } catch (err) {
      this.log.error(
        `Postgres load failed: ${(err as Error).message}. Staying on the JSON store.`,
      );
    } finally {
      // Resolves on every path, including the early return, so nothing hangs.
      this.markLoaded();
    }
  }

  onApplicationShutdown() {
    // A debounced write may still be pending; do not lose the last few seconds.
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    this.flush();
  }

  /** Load the previous session's pipeline, call log and timeline. */
  private restore() {
    if (!existsSync(this.storeFile)) {
      this.log.log(`No CRM store yet - starting empty (${this.storeFile})`);
      return;
    }
    try {
      const raw = JSON.parse(readFileSync(this.storeFile, 'utf8')) as Partial<CrmSnapshot>;
      this.leads = raw.leads ?? [];
      this.calls = (raw.calls ?? []).map((c) => ({
        // Stores written before these features existed have no such fields.
        transcriptStatus: 'none' as const,
        analysisStatus: 'none' as const,
        ...c,
      }));
      this.activities = raw.activities ?? [];
      // Never re-issue an id that a restored lead already holds.
      this.leadSeq = Math.max(
        raw.leadSeq ?? 1000,
        1000,
        // Strip NON-digits: /D/ (without the backslash) matches a literal "D",
        // leaves "L-1001" intact, yields NaN, and the next contact silently
        // reuses an id that already exists.
        ...this.leads.map((l) => Number(String(l.id).replace(/\D/g, '')) || 0),
      );
      this.log.log(
        `CRM restored: ${this.leads.length} contacts, ${this.calls.length} calls, ` +
          `${this.activities.length} activities from ${this.storeFile}`,
      );
    } catch (err) {
      this.log.error(
        `Could not read ${this.storeFile}: ${(err as Error).message}. Starting empty.`,
      );
    }
  }

  /**
   * Write a change through to storage.
   *
   * With Postgres up, only the rows that changed are written, immediately --
   * losing a call because a debounce timer had not fired yet is not a trade
   * worth making. Without it, the whole snapshot is still debounced to the
   * JSON file as before.
   */
  private persist(changed: {
    lead?: Lead | null;
    call?: CallLog | null;
    activity?: Activity | null;
  } = {}) {
    if (this.usingDb) {
      void this.writeThrough(changed);
      return;
    }
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.flush();
    }, 250);
    this.saveTimer.unref?.();
  }

  /**
   * Leads are written before calls and activities so a row always lands after
   * the contact it points at. A failure here is logged rather than thrown: the
   * in-memory copy is still correct and the caller is usually a Plivo webhook
   * that must answer promptly.
   */
  private async writeThrough(changed: {
    lead?: Lead | null;
    call?: CallLog | null;
    activity?: Activity | null;
  }) {
    try {
      if (changed.lead) await this.repo.saveLead(changed.lead);
      if (changed.call) await this.repo.saveCall(changed.call);
      if (changed.activity) {
        // An activity always belongs to a contact; make sure it exists first.
        const owner = this.getLead(changed.activity.leadId);
        if (owner) await this.repo.saveLead(owner);
        await this.repo.saveActivity(changed.activity);
      }
    } catch (err) {
      this.log.error(`Postgres write failed: ${(err as Error).message}`);
    }
  }

  /** Write via a temp file + rename, so a crash mid-write cannot truncate the store. */
  private flush() {
    if (this.usingDb) return;
    const snapshot: CrmSnapshot = {
      version: 1,
      savedAt: new Date().toISOString(),
      leadSeq: this.leadSeq,
      leads: this.leads,
      calls: this.calls,
      activities: this.activities,
    };
    try {
      mkdirSync(dirname(this.storeFile), { recursive: true });
      const tmp = `${this.storeFile}.tmp`;
      writeFileSync(tmp, JSON.stringify(snapshot, null, 2), 'utf8');
      renameSync(tmp, this.storeFile);
    } catch (err) {
      this.log.error(`Could not write ${this.storeFile}: ${(err as Error).message}`);
    }
  }

  /**
   * Plivo appends a random suffix to endpoint usernames, so the real ones are
   * only known after `npm run plivo:setup` runs. It writes them to
   * apps/api/plivo-endpoints.json; without that file the defaults above are
   * placeholders and live login will fail with INVALID_ACCESS_TOKEN.
   */
  private applyRealEndpoints() {
    const file = resolve(__dirname, '..', '..', 'plivo-endpoints.json');
    if (!existsSync(file)) {
      this.log.warn(
        'No plivo-endpoints.json found. Endpoint names are placeholders - ' +
          'run "npm run plivo:setup -- <public-url>" before trying live calls.',
      );
      return;
    }

    try {
      const map = JSON.parse(readFileSync(file, 'utf8')) as Record<string, string>;
      for (const rep of this.reps) {
        if (map[rep.id]) {
          rep.endpoint = map[rep.id];
        }
      }
      this.log.log(
        `Plivo endpoints loaded: ${this.reps.map((r) => `${r.name}=${r.endpoint}`).join(', ')}`,
      );
    } catch (err) {
      this.log.error(`Could not read ${file}: ${(err as Error).message}`);
    }
  }

  // ---------- reads ----------
  getReps() { return this.reps; }
  getRep(id: string) { return this.reps.find((r) => r.id === id) ?? null; }
  getRepByEndpoint(endpoint: string) { return this.reps.find((r) => r.endpoint === endpoint) ?? null; }
  getLeads() { return this.leads; }
  getLead(id: string) { return this.leads.find((l) => l.id === id) ?? null; }
  getCalls() { return [...this.calls].sort((a, b) => b.startedAt.localeCompare(a.startedAt)); }
  getCallByUuid(uuid: string) { return this.calls.find((c) => c.callUuid === uuid) ?? null; }

  getActivities(leadId?: string) {
    return this.activities
      .filter((a) => !leadId || a.leadId === leadId)
      .sort((a, b) => b.at.localeCompare(a.at));
  }

  /** Normalises +91..., 91..., 0... so an inbound caller ID matches a stored lead. */
  findLeadByPhone(phone: string): Lead | null {
    const tail = (phone || '').replace(/\D/g, '').slice(-10);
    if (!tail) return null;
    return this.leads.find((l) => l.phone.replace(/\D/g, '').endsWith(tail)) ?? null;
  }

  /** Step 3 of the inbound flow: look up the caller, find the lead's owner. */
  findRepForPhone(phone: string): Rep | null {
    const lead = this.findLeadByPhone(phone);
    if (!lead) return null;
    const rep = this.getRep(lead.ownerId);
    return rep && rep.online ? rep : null;
  }

  /** Add a contact by hand. */
  createLead(input: Partial<Lead> & { phone: string; ownerId?: string }): Lead {
    const existing = this.findLeadByPhone(input.phone);
    if (existing) return existing;

    const lead: Lead = {
      id: `L-${++this.leadSeq}`,
      name: (input.name || '').trim() || input.phone,
      company: (input.company || '').trim() || '—',
      phone: input.phone.trim(),
      email: (input.email || '').trim(),
      stage: input.stage ?? 'new',
      value: Number(input.value ?? 0),
      ownerId: input.ownerId ?? this.reps[0]?.id ?? 'u_ravi',
      lastContactedAt: null,
    };
    this.leads.push(lead);
    this.addActivity({ leadId: lead.id, type: 'system', title: 'Contact created' });
    this.log.log(`lead created ${lead.id} ${lead.phone}`);
    this.persist({ lead });
    return lead;
  }

  /**
   * Turn a real call into a contact. A number you actually spoke to belongs in
   * the pipeline; inventing sample rows does not.
   */
  private contactForCall(phone: string, ownerId: string | null, direction: 'outbound' | 'inbound'): Lead | null {
    const digits = (phone || '').replace(/\D/g, '');
    if (digits.length < 8) return null; // not a dialable number (e.g. a sip: address)

    const existing = this.findLeadByPhone(phone);
    if (existing) return existing;

    return this.createLead({
      phone: phone.startsWith('+') ? phone : `+${digits}`,
      name: phone.startsWith('+') ? phone : `+${digits}`,
      company: direction === 'inbound' ? 'Inbound caller' : 'Dialled number',
      ownerId: ownerId ?? undefined,
      stage: 'contacted',
    });
  }

  /** Calls that produced an audio file, newest first. */
  getRecordings() {
    return this.getCalls().filter((c) => Boolean(c.recordingUrl));
  }

  /**
   * Plivo delivers the recording after the call, on its own callback, so the
   * URL usually arrives later than the hangup. Attach it when it does.
   */
  attachRecording(callUuid: string, url: string, durationSec?: number): CallLog | null {
    const call = this.getCallByUuid(callUuid);
    if (!call) {
      this.log.warn(`recording for unknown CallUUID ${callUuid}`);
      return null;
    }
    call.recordingUrl = url;
    if (durationSec && !call.durationSec) call.durationSec = durationSec;

    if (call.leadId) {
      this.addActivity({
        leadId: call.leadId,
        type: 'system',
        title: 'Recording available',
        body: `${this.fmt(call.durationSec)} of audio attached to this call.`,
        meta: { callUuid, recordingUrl: url },
      });
    }
    this.log.log(`recording attached to ${callUuid}`);
    this.persist({ call });
    return call;
  }

  /**
   * Who ended the call, learned from the dial webhook before the hangup lands.
   * Stored separately from saveCallEnd because the two webhooks race.
   */
  noteCallOutcome(callUuid: string, endedBy: EndedBy | null, endReason: string | null) {
    const call = this.getCallByUuid(callUuid);
    if (!call) return null;
    if (endedBy) call.endedBy = endedBy;
    if (endReason) call.endReason = endReason;
    this.persist({ call });
    return call;
  }

  /**
   * Forget a call: the log entry, its transcript, its AI verdict and the
   * timeline entries it produced. Returns the call that was removed, or null.
   */
  async deleteCall(callUuid: string): Promise<CallLog | null> {
    const call = this.getCallByUuid(callUuid);
    if (!call) return null;

    this.calls = this.calls.filter((c) => c.callUuid !== callUuid);
    this.activities = this.activities.filter(
      (a) => (a.meta as { callUuid?: string } | undefined)?.callUuid !== callUuid,
    );

    if (this.usingDb) {
      try {
        await this.repo.deleteCall(callUuid);
      } catch (err) {
        this.log.error(`could not delete call ${callUuid}: ${(err as Error).message}`);
      }
    } else {
      this.flush();
    }

    this.log.log(`call deleted ${callUuid}`);
    return call;
  }

  /** Move a call's transcript through none -> pending -> ready / failed. */
  setTranscriptStatus(callUuid: string, status: CallLog['transcriptStatus']) {
    const call = this.getCallByUuid(callUuid);
    if (!call || call.transcriptStatus === status) return call;
    call.transcriptStatus = status;
    this.persist({ call });
    return call;
  }

  /** Move a call's AI analysis through none -> pending -> ready / failed. */
  setAnalysisStatus(callUuid: string, status: CallLog['analysisStatus']) {
    const call = this.getCallByUuid(callUuid);
    if (!call || call.analysisStatus === status) return call;
    call.analysisStatus = status;
    this.persist({ call });
    return call;
  }

  /** Any rep whose browser is registered. Used to answer callers we don't know. */
  findAnyOnlineRep(): Rep | null {
    return this.reps.find((r) => r.online) ?? null;
  }

  setRepOnline(repId: string, online: boolean) {
    const rep = this.getRep(repId);
    if (rep) rep.online = online;
    return rep;
  }

  // ---------- call lifecycle ----------
  /** Called from the Answer URL handler -- saveCallStart() in the design doc. */
  saveCallStart(input: {
    callUuid: string;
    from: string;
    to: string;
    direction: 'outbound' | 'inbound';
    leadId?: string | null;
    repId?: string | null;
    /** When the call really began. Omit for a live call; pass it when rebuilding history. */
    startedAt?: string | null;
  }): CallLog {
    const existing = this.getCallByUuid(input.callUuid);
    if (existing) return existing;

    // Every real call puts its counterparty in the pipeline.
    const counterparty = input.direction === 'outbound' ? input.to : input.from;
    const leadId =
      input.leadId ?? this.contactForCall(counterparty, input.repId ?? null, input.direction)?.id ?? null;

    const call: CallLog = {
      id: `C-${randomUUID().slice(0, 8)}`,
      callUuid: input.callUuid,
      leadId,
      repId: input.repId ?? null,
      direction: input.direction,
      from: input.from,
      to: input.to,
      status: 'in-progress',
      startedAt: input.startedAt || new Date().toISOString(),
      endedAt: null,
      durationSec: 0,
      recordingUrl: null,
      disposition: null,
      notes: null,
      endedBy: null,
      endReason: null,
      transcriptStatus: 'none',
      analysisStatus: 'none',
    };
    this.calls.push(call);
    this.log.log(`call start ${call.callUuid} ${call.direction} ${call.from} -> ${call.to}`);
    // The contact may have just been created inside this method.
    this.persist({ call, lead: leadId ? this.getLead(leadId) : null });
    return call;
  }

  /** Called from the Hangup URL handler. This is what turns calling into a CRM feature. */
  saveCallEnd(
    callUuid: string,
    patch: {
      status?: CallLog['status'];
      durationSec?: number;
      recordingUrl?: string | null;
      /** When the call really ended. Omit for a live call. */
      endedAt?: string | null;
      endedBy?: EndedBy | null;
      endReason?: string | null;
    },
  ): CallLog | null {
    const call = this.getCallByUuid(callUuid);
    if (!call) {
      this.log.warn(`hangup for unknown CallUUID ${callUuid}`);
      return null;
    }

    call.status = patch.status ?? 'completed';
    // A duplicate or late hangup must not zero a duration we already recorded.
    call.durationSec = patch.durationSec ?? call.durationSec;
    // Only ever set audio, never clear it: the Record API callback can land
    // before the Hangup URL does, and that hangup carries no RecordUrl.
    if (patch.recordingUrl) call.recordingUrl = patch.recordingUrl;
    call.endedAt = patch.endedAt || new Date().toISOString();
    // The dial webhook usually lands first and already knows who hung up;
    // do not let a later, vaguer hangup webhook overwrite that.
    if (patch.endedBy) call.endedBy = patch.endedBy;
    if (patch.endReason) call.endReason = patch.endReason;

    if (call.leadId) {
      const lead = this.getLead(call.leadId);
      if (lead) {
        lead.lastContactedAt = call.endedAt;
        if (lead.stage === 'new' && call.status === 'completed') lead.stage = 'contacted';
      }
      this.addActivity({
        leadId: call.leadId,
        type: 'call',
        title:
          call.direction === 'outbound'
            ? `Outbound call - ${this.fmt(call.durationSec)}`
            : `Inbound call - ${this.fmt(call.durationSec)}`,
        body: describeOutcome(call),
        meta: {
          callUuid: call.callUuid,
          status: call.status,
          endedBy: call.endedBy,
          endReason: call.endReason,
          recordingUrl: call.recordingUrl,
        },
      });
    }
    this.persist({ call, lead: call.leadId ? this.getLead(call.leadId) : null });
    return call;
  }

  /** The disposition popup the rep fills in after hangup. */
  setDisposition(callUuid: string, disposition: Disposition, notes?: string): CallLog | null {
    const call = this.getCallByUuid(callUuid);
    if (!call) return null;
    call.disposition = disposition;
    call.notes = (notes && notes.trim()) || null;

    if (call.leadId) {
      const lead = this.getLead(call.leadId);
      if (lead) {
        if (disposition === 'interested' && ['new', 'contacted'].includes(lead.stage)) lead.stage = 'qualified';
        if (disposition === 'not_interested') lead.stage = 'lost';
      }
      this.addActivity({
        leadId: call.leadId,
        type: 'note',
        title: `Disposition: ${this.labelFor(disposition)}`,
        body: call.notes ?? undefined,
        meta: { callUuid },
      });
    }
    this.persist({ call, lead: call.leadId ? this.getLead(call.leadId) : null });
    return call;
  }

  addActivity(input: Omit<Activity, 'id' | 'at'> & { at?: string }): Activity {
    const activity: Activity = {
      id: `A-${randomUUID().slice(0, 8)}`,
      at: input.at ?? new Date().toISOString(),
      leadId: input.leadId,
      type: input.type,
      title: input.title,
      body: input.body,
      meta: input.meta,
    };
    this.activities.push(activity);
    this.persist({ activity });
    return activity;
  }

  private labelFor(d: Disposition) {
    const map = {
      interested: 'Interested',
      callback: 'Callback requested',
      not_interested: 'Not interested',
      no_answer: 'No answer',
    };
    return map[d];
  }

  private fmt(sec: number) {
    if (!sec) return '0s';
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return m ? `${m}m ${s}s` : `${s}s`;
  }
}
