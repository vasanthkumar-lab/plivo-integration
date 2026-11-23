'use client';

import { useState } from 'react';
import { API_BASE } from '@/lib/api';
import type { CallLog, Lead } from '@/lib/types';
import { fmtDuration, fmtTime } from './ui';

/**
 * Call recordings. Audio is streamed through our own API rather than straight
 * from Plivo's media host, because those URLs need account credentials that
 * must not reach the browser.
 */
export function Recordings({ recordings, leads }: { recordings: CallLog[]; leads: Lead[] }) {
  const [playing, setPlaying] = useState<string | null>(null);

  return (
    <section className="panel overflow-hidden">
      <header className="flex items-center justify-between border-b border-[var(--line)] px-4 py-3">
        <div>
          <h2 className="text-[13px] font-semibold tracking-wide text-[var(--muted)] uppercase">
            Call recordings
          </h2>
          <p className="text-[11px] text-[var(--muted)]/80">
            Delivered by Plivo after each call ends
          </p>
        </div>
        <span className="mono text-[11px] text-[var(--muted)]">{recordings.length}</span>
      </header>

      {recordings.length === 0 ? (
        <p className="px-4 py-8 text-center text-[12px] text-[var(--muted)]">
          No recordings yet. Once a call completes, Plivo posts the audio to the recording
          callback and it appears here.
        </p>
      ) : (
        <ul className="max-h-[340px] overflow-y-auto">
          {recordings.map((c) => {
            const lead = leads.find((l) => l.id === c.leadId);
            const other = c.direction === 'outbound' ? c.to : c.from.replace(/^sip:/, '');
            const isOpen = playing === c.callUuid;

            return (
              <li key={c.id} className="border-b border-[var(--line)]/60 px-4 py-3 last:border-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-semibold">
                      {c.direction === 'outbound' ? '↗' : '↘'} {lead?.name ?? other}
                    </div>
                    <div className="mono text-[11px] text-[var(--muted)]">
                      {other} · {fmtDuration(c.durationSec)} · {fmtTime(c.startedAt)}
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    {c.disposition && (
                      <span className="rounded-full bg-[var(--panel-2)] px-2.5 py-1 text-[10px] font-semibold text-[var(--muted)] capitalize">
                        {c.disposition.replace('_', ' ')}
                      </span>
                    )}
                    <button
                      onClick={() => setPlaying(isOpen ? null : c.callUuid)}
                      className="rounded-lg border border-[var(--line)] px-3 py-1.5 text-[12px] font-semibold transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
                    >
                      {isOpen ? 'Close' : '▶ Play'}
                    </button>
                  </div>
                </div>

                {isOpen && (
                  <div className="slide-up mt-2.5 flex flex-col gap-1.5">
                    <audio
                      controls
                      autoPlay
                      preload="none"
                      className="w-full"
                      src={`${API_BASE}/api/recordings/${encodeURIComponent(c.callUuid)}/audio`}
                    >
                      Your browser cannot play this audio.
                    </audio>
                    <span className="mono truncate text-[10px] text-[var(--muted)]">
                      {c.recordingUrl}
                    </span>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
