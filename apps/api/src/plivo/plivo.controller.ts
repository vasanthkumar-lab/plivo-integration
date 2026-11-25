import { Body, Controller, ForbiddenException, Get, Header, HttpCode, Logger, Param, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { PlivoService } from './plivo.service';
import { PlivoConfig } from './plivo.config';
import { CrmService } from '../crm/crm.service';
import { EventsService } from '../events/events.service';
import { HEALTH_MARKER } from './tunnel.monitor';

@Controller()
export class PlivoController {
  private readonly log = new Logger('PlivoController');

  constructor(
    private readonly plivo: PlivoService,
    private readonly config: PlivoConfig,
    private readonly crm: CrmService,
    private readonly events: EventsService,
  ) {}

  /** What mode the demo is in, and which URLs Plivo should be pointed at. */
  @Get('api/plivo/config')
  describe() {
    return this.config.describe();
  }

  /**
   * Liveness marker the tunnel probe looks for.
   *
   * Unguarded on purpose: it carries no account data, and the probe has no
   * Plivo signature to present. The 'service' field is what proves the public
   * URL reached THIS server and not an ngrok error page.
   */
  @Get('plivo/health')
  health() {
    return { ok: true, service: HEALTH_MARKER, mode: this.config.mode };
  }

  /** Which rep browsers are registered with Plivo right now (inbound depends on this). */
  @Get('api/plivo/endpoint-status')
  endpointStatus() {
    return this.plivo.endpointStatus();
  }

  /** Step 1 of rep login: the browser asks the backend for a token. */
  @Get('api/plivo/token')
  async token(@Query('repId') repId: string) {
    return this.plivo.mintToken(repId || 'u_ravi');
  }

  /**
   * The Answer URL. Plivo calls this whenever a call starts to ask what to do.
   * Must be publicly reachable -- use ngrok in development.
   */
  @Post('plivo/answer')
  @HttpCode(200)
  @Header('Content-Type', 'application/xml')
  answer(@Body() body: Record<string, any>, @Req() req: Request) {
    this.guard(req);
    const { xml } = this.plivo.handleAnswer(body);
    return xml;
  }

  /** The Hangup URL. Plivo reports how the call went; we log it against the lead. */
  @Post('plivo/hangup')
  @HttpCode(200)
  hangup(@Body() body: Record<string, any>, @Req() req: Request) {
    this.guard(req);
    const call = this.plivo.handleHangup(body);
    return { ok: true, call };
  }

  /**
   * Dial events: answer, connected, hangup, digits. We use it to start
   * recording the moment the two parties are actually connected.
   */
  @Post('plivo/dial-event')
  @HttpCode(200)
  dialEvent(@Body() body: Record<string, any>) {
    const event = String(body.Event ?? body.DialAction ?? '').toLowerCase();
    const callUuid = String(body.CallUUID ?? '');

    this.events.wire({
      actor: 'plivo',
      kind: 'http',
      label: `Dial event: ${event || 'unknown'}`,
      detail: callUuid ? `call ${callUuid.slice(0, 8)}` : undefined,
      body,
    });

    // Plivo sends these as dialanswer / dialconnected / dialhangup.
    if (event.includes('answer') || event.includes('connected')) {
      void this.plivo.startRecording(callUuid);
    }

    // The only webhook that says who released the call.
    if (event.includes('hangup')) {
      const call = this.plivo.handleDialHangup(body);
      if (call) this.events.emit({ type: 'call-ended', payload: call });
    }
    return { ok: true };
  }

  /**
   * Plivo posts the finished recording here once it has been written.
   * The Record API callback uses snake_case, unlike the XML webhooks.
   */
  @Post('plivo/recording')
  @HttpCode(200)
  recording(@Body() body: Record<string, any>) {
    /**
     * Plivo is inconsistent about the casing here between the XML webhooks and
     * the Record API callback, so match on shape rather than on an exact list
     * of names. The old fixed list silently matched nothing, which left the
     * recording unattached until the next poll of the Recordings API.
     */
    const pick = (test: RegExp): string => {
      const key = Object.keys(body).find((k) => test.test(k) && String(body[k] ?? '').trim());
      return key ? String(body[key]).trim() : '';
    };

    const callUuid = pick(/^call_?uuid$/i) || pick(/call_?uuid/i);
    const url = pick(/record(ing)?_?url/i);
    const duration = Number(
      body.RecordingDuration ?? body.recording_duration ?? body.Duration ?? 0,
    );

    this.events.wire({
      actor: 'plivo',
      kind: 'http',
      label: 'POST /plivo/recording',
      // Log what actually arrived, not what we made of it: the previous version
      // logged its own (empty) interpretation and hid the mismatch.
      detail: url ? 'recording ready' : 'recording callback had no usable URL',
      body,
    });

    if (!callUuid || !url) return { ok: false };

    const call = this.crm.attachRecording(callUuid, url, duration);
    if (call) {
      // Audio exists now, so the transcript can start. Does not block the 200.
      this.plivo.queueTranscription(callUuid);
      this.events.wire({
        actor: 'backend',
        kind: 'note',
        label: 'Recording saved to CRM',
        detail: call.leadId ? `attached to ${call.leadId}` : 'attached to call record',
      });
      this.events.emit({ type: 'crm-updated', payload: { reason: 'recording', callUuid } });
    }
    return { ok: true };
  }

  /**
   * Streams a recording through our server.
   * Plivo's media URLs need account credentials, which must never reach the
   * browser, so the audio element points here instead.
   */
  @Get('api/recordings/:callUuid/audio')
  async audio(@Param('callUuid') callUuid: string, @Res() res: Response) {
    const call = this.crm.getCallByUuid(callUuid);
    if (!call?.recordingUrl) {
      res.status(404).json({ error: 'No recording for this call' });
      return;
    }

    try {
      const upstream = await fetch(call.recordingUrl, {
        headers: this.config.live
          ? {
              Authorization: `Basic ${Buffer.from(`${this.config.authId}:${this.config.authToken}`).toString('base64')}`,
            }
          : {},
      });

      if (!upstream.ok || !upstream.body) {
        res.status(502).json({ error: `Plivo returned ${upstream.status}`, url: call.recordingUrl });
        return;
      }

      res.setHeader('Content-Type', upstream.headers.get('content-type') ?? 'audio/mpeg');
      res.setHeader('Accept-Ranges', 'bytes');
      const buf = Buffer.from(await upstream.arrayBuffer());
      res.setHeader('Content-Length', String(buf.length));
      res.end(buf);
    } catch (err) {
      this.log.error(`recording fetch failed: ${(err as Error).message}`);
      res.status(502).json({ error: 'Could not fetch recording' });
    }
  }

  /** Voicemail recording callback, used when no rep is online. */
  @Post('plivo/voicemail')
  @HttpCode(200)
  @Header('Content-Type', 'application/xml')
  voicemail(@Body() body: Record<string, any>) {
    this.log.log(`voicemail recorded: ${body.RecordUrl ?? 'n/a'}`);
    return '<Response><Speak>Thank you. We will call you back shortly.</Speak><Hangup/></Response>';
  }

  /** Reject webhooks that did not come from Plivo (no-op while in simulator mode). */
  private guard(req: Request) {
    const signature = String(req.headers['x-plivo-signature-v3'] ?? '');
    const nonce = String(req.headers['x-plivo-signature-v3-nonce'] ?? '');

    // Must be the URL exactly as Plivo signed it -- the one configured on the
    // Application, which is PUBLIC_BASE_URL, not the local host:port.
    const url = `${this.config.publicUrl}${req.originalUrl}`;

    if (!this.plivo.verifySignature(req.method, url, nonce, signature, req.body ?? {})) {
      this.log.warn(
        `Rejected unsigned/invalid webhook on ${req.originalUrl}. ` +
          `If this was your own curl test, set PLIVO_VERIFY_WEBHOOKS=false in .env ` +
          `(or PLIVO_FORCE_SIMULATOR=true) and restart.`,
      );
      throw new ForbiddenException(
        'Invalid X-Plivo-Signature-V3. This request did not come from Plivo. ' +
          'For local curl testing set PLIVO_VERIFY_WEBHOOKS=false in .env.',
      );
    }
  }
}
