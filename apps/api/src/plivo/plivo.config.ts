import { Injectable, Logger } from '@nestjs/common';

/** Result of the last reachability probe against PUBLIC_BASE_URL. */
export interface TunnelStatus {
  /** null until the first probe has run. */
  ok: boolean | null;
  checkedAt: string | null;
  detail: string | null;
}

@Injectable()
export class PlivoConfig {
  private readonly log = new Logger('PlivoConfig');

  readonly authId = (process.env.PLIVO_AUTH_ID || '').trim();
  readonly authToken = (process.env.PLIVO_AUTH_TOKEN || '').trim();
  readonly phoneNumber = (process.env.PLIVO_PHONE_NUMBER || '+918031770725').trim();
  readonly publicUrl = (process.env.PUBLIC_BASE_URL || 'http://localhost:4000').trim().replace(/\/$/, '');
  readonly recordCalls = (process.env.PLIVO_RECORD || 'true') === 'true';
  readonly tokenTtlSec = Number(process.env.PLIVO_TOKEN_TTL || 300);

  /**
   * Maximum length of a recording, in seconds.
   * Plivo's Record API defaults to 60, which silently truncates any call longer
   * than a minute. Plivo allows up to 24 hours; two hours is a sane ceiling.
   */
  readonly recordMaxSeconds = Number(process.env.PLIVO_RECORD_MAX_SECONDS || 7200);

  /**
   * 'stereo' puts each leg on its own audio channel, which lets Deepgram label
   * speakers from the channel split instead of guessing by voice.
   *
   * Plivo's parameter is record_channel_type and it accepts only "mono" or
   * "stereo" -- and it ignores anything else WITHOUT an error, so a wrong value
   * here silently produces mono recordings. Legacy "dual" is mapped through.
   */
  get recordChannels(): 'mono' | 'stereo' {
    const raw = (process.env.PLIVO_RECORD_CHANNELS || 'stereo').trim().toLowerCase();
    return raw === 'mono' ? 'mono' : 'stereo';
  }

  /** Plivo Application the endpoints are linked to. Optional, but Plivo recommends it. */
  readonly appId = (process.env.PLIVO_APP_ID || '').trim();

  /**
   * Country code assumed when someone dials a local number with no prefix.
   * Plivo needs E.164: a bare 10-digit number is not routable and the call
   * fails immediately with NO_ANSWER.
   */
  readonly defaultCountryCode = (process.env.PLIVO_DEFAULT_COUNTRY_CODE || '91').replace(/\D/g, '');

  /**
   * Backdate `nbf` so a few seconds of clock drift between this machine and
   * Plivo cannot produce a token that is "not yet valid".
   */
  readonly clockSkewSec = Number(process.env.PLIVO_CLOCK_SKEW || 120);

  /** Set PLIVO_FORCE_SIMULATOR=true to demo offline without deleting credentials. */
  readonly forceSimulator = (process.env.PLIVO_FORCE_SIMULATOR || '').trim() === 'true';

  /**
   * Webhook signature checking. On by default in live mode -- that is what stops
   * anyone on the internet from POSTing fake calls at your Answer URL.
   * Set PLIVO_VERIFY_WEBHOOKS=false to hand-test the handlers with curl.
   */
  readonly verifyWebhooks = (process.env.PLIVO_VERIFY_WEBHOOKS || 'true').trim() !== 'false';

  /**
   * Last known reachability of PUBLIC_BASE_URL, kept up to date by TunnelMonitor.
   * Starts as null: unknown, not broken.
   */
  private tunnel: TunnelStatus = { ok: null, checkedAt: null, detail: null };

  get tunnelStatus(): TunnelStatus {
    return { ...this.tunnel };
  }

  /** Store a probe result. Returns true when the state actually flipped. */
  setTunnelStatus(ok: boolean, detail: string | null): boolean {
    const changed = this.tunnel.ok !== ok;
    this.tunnel = { ok, checkedAt: new Date().toISOString(), detail };
    return changed;
  }

  /** The exact command that puts the tunnel back on the same public URL. */
  get restartHint(): string {
    const port = process.env.PORT || 4000;
    try {
      return `Restart it with: ngrok http --url=${new URL(this.publicUrl).origin} ${port}`;
    } catch {
      return `Restart your tunnel on port ${port}.`;
    }
  }

  /** True once real credentials are present: real JWTs, real WebRTC, real carrier audio. */
  get live(): boolean {
    return Boolean(this.authId && this.authToken) && !this.forceSimulator;
  }

  get mode(): 'live' | 'simulator' {
    return this.live ? 'live' : 'simulator';
  }

  get publiclyReachable(): boolean {
    return !/^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(
      this.publicUrl,
    );
  }

  /** Everything blocking real calls right now. Empty array means ready. */
  get blockers(): string[] {
    const out: string[] = [];
    if (!this.authId) out.push('PLIVO_AUTH_ID is not set');
    if (!this.authToken) out.push('PLIVO_AUTH_TOKEN is not set');
    if (this.live && this.publiclyReachable && this.tunnel.ok === false) {
      out.push(
        `${this.publicUrl} is not answering (${this.tunnel.detail ?? 'no response'}). ` +
          `Plivo cannot reach your Answer URL, so every call fails - the Browser SDK ` +
          `reports that as "Busy". ${this.restartHint}`,
      );
    }
    if (this.live && !this.publiclyReachable) {
      out.push(
        `PUBLIC_BASE_URL is ${this.publicUrl}, which Plivo cannot reach - run "ngrok http ${process.env.PORT || 4000}" and put the https URL here`,
      );
    }
    return out;
  }

  describe() {
    return {
      mode: this.mode,
      live: this.live,
      phoneNumber: this.phoneNumber,
      answerUrl: `${this.publicUrl}/plivo/answer`,
      hangupUrl: `${this.publicUrl}/plivo/hangup`,
      recordCalls: this.recordCalls,
      tokenTtlSec: this.tokenTtlSec,
      authIdMasked: this.authId ? `${this.authId.slice(0, 4)}...${this.authId.slice(-2)}` : null,
      publiclyReachable: this.publiclyReachable,
      blockers: this.blockers,
      appId: this.appId || null,
      clockSkewSec: this.clockSkewSec,
      tunnel: this.tunnelStatus,
    };
  }

  reportReadiness() {
    if (!this.live) {
      this.log.warn(
        this.forceSimulator
          ? 'PLIVO_FORCE_SIMULATOR=true - running in SIMULATOR mode (credentials ignored).'
          : 'No PLIVO_AUTH_ID / PLIVO_AUTH_TOKEN found - running in SIMULATOR mode.',
      );
      return;
    }

    this.log.log(`LIVE mode - credentials loaded for Auth ID ${this.describe().authIdMasked}`);
    this.log.log(`Caller ID / inbound number: ${this.phoneNumber}`);

    if (!this.publiclyReachable) {
      this.log.error('--------------------------------------------------------------');
      this.log.error('Plivo CANNOT reach your Answer URL.');
      this.log.error(`  PUBLIC_BASE_URL = ${this.publicUrl}`);
      this.log.error(`  Run:  ngrok http ${process.env.PORT || 4000}`);
      this.log.error('  Then set PUBLIC_BASE_URL to the https URL ngrok prints,');
      this.log.error('  and point your Plivo Application at <that>/plivo/answer');
      this.log.error('  Calls will fail until this is done.');
      this.log.error('--------------------------------------------------------------');
    } else {
      this.log.log('Answer URL is publicly reachable.');
    }
  }
}
