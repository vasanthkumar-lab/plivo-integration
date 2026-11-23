import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { PlivoConfig } from './plivo.config';
import { EventsService } from '../events/events.service';

/** How often to re-check that Plivo can still reach us. */
const PROBE_INTERVAL_MS = 30_000;
/** A healthy tunnel answers in well under a second; 6s is a generous ceiling. */
const PROBE_TIMEOUT_MS = 6_000;
/** Delay before the first probe so app.listen() has definitely bound the port. */
const FIRST_PROBE_DELAY_MS = 2_000;

/** What GET /plivo/health must say for us to believe we reached *this* server. */
export const HEALTH_MARKER = 'pivlo-api';

/**
 * Watches the public tunnel.
 *
 * `publiclyReachable` on PlivoConfig only checks that PUBLIC_BASE_URL is not a
 * localhost/private address -- it cannot tell a live tunnel from a dead one.
 * When ngrok stops, Plivo gets "Error Reaching Answer URL" (7011) and kills the
 * call, which the Browser SDK reports to the rep as the cause "Busy". That is a
 * thoroughly misleading message for "your tunnel is down", so probe for it and
 * say so plainly instead.
 *
 * The probe goes out to the public URL and comes back in through the tunnel to
 * this same process, so it exercises exactly the path Plivo uses.
 */
@Injectable()
export class TunnelMonitor implements OnModuleInit, OnApplicationShutdown {
  private readonly log = new Logger('TunnelMonitor');
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly config: PlivoConfig,
    private readonly events: EventsService,
  ) {}

  onModuleInit() {
    // Simulator mode never talks to Plivo, so there is nothing to keep alive.
    if (!this.config.live) return;

    setTimeout(() => void this.probe(), FIRST_PROBE_DELAY_MS).unref?.();
    this.timer = setInterval(() => void this.probe(), PROBE_INTERVAL_MS);
    // Never hold the process open just for the heartbeat.
    this.timer.unref?.();
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * One reachability check. Returns null when there is nothing to probe
   * (simulator mode, or a PUBLIC_BASE_URL that is already flagged as private).
   */
  async probe(): Promise<boolean | null> {
    if (!this.config.live || !this.config.publiclyReachable) return null;

    const url = `${this.config.publicUrl}/plivo/health`;
    let ok = false;
    let detail = 'unknown';

    try {
      const res = await fetch(url, {
        headers: {
          // Free ngrok otherwise serves an HTML interstitial instead of our JSON.
          'ngrok-skip-browser-warning': '1',
          accept: 'application/json',
        },
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });

      // ngrok answers for a domain whose agent is gone, so a 404 here is the
      // tunnel being down rather than a missing route on our server.
      const ngrokError = res.headers.get('ngrok-error-code');

      if (ngrokError) {
        detail = `the tunnel is not running (${ngrokError})`;
      } else if (!res.ok) {
        detail = `the public URL answered HTTP ${res.status}`;
      } else {
        const data = (await res.json().catch(() => null)) as { service?: string } | null;
        if (data?.service === HEALTH_MARKER) {
          ok = true;
          detail = 'reachable';
        } else {
          detail = 'the public URL is answering, but not with this API';
        }
      }
    } catch (err) {
      const e = err as Error;
      detail =
        e.name === 'TimeoutError' || e.name === 'AbortError'
          ? `no response within ${PROBE_TIMEOUT_MS / 1000}s`
          : e.message;
    }

    this.publish(ok, detail);
    return ok;
  }

  /** Record the result, and shout about it only when it actually changed. */
  private publish(ok: boolean, detail: string) {
    const changed = this.config.setTunnelStatus(ok, detail);
    if (!changed) return;

    if (ok) {
      this.log.log(`Answer URL is reachable: ${this.config.publicUrl}/plivo/answer`);
      this.events.wire({
        actor: 'backend',
        kind: 'note',
        label: 'Tunnel is up',
        detail: `Plivo can reach ${this.config.publicUrl}/plivo/answer`,
      });
    } else {
      this.log.error(
        `Answer URL is UNREACHABLE - ${detail}. Every call will fail. ${this.config.restartHint}`,
      );
      this.events.wire({
        actor: 'backend',
        kind: 'note',
        label: 'Tunnel is DOWN',
        detail: `${detail} - Plivo cannot reach ${this.config.publicUrl}/plivo/answer`,
      });
    }

    this.events.emit({
      type: 'plivo-config',
      payload: { tunnel: this.config.tunnelStatus, blockers: this.config.blockers },
    });
  }
}
