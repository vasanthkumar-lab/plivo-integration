'use client';

import { useState } from 'react';
import type { PlivoRuntimeConfig } from '@/lib/types';

/**
 * Demo controls. These stand in for things that happen outside the app in
 * production (a customer picking up, a customer dialling in), so the whole
 * flow can be shown end to end without a second phone in the room.
 */
export function DemoBar({
  config,
  outcome,
  onOutcomeChange,
  onSimulateInbound,
  busy,
}: {
  config: PlivoRuntimeConfig | null;
  outcome: 'answer' | 'no-answer' | 'busy';
  onOutcomeChange: (o: 'answer' | 'no-answer' | 'busy') => void;
  onSimulateInbound: (from: string) => void;
  busy: boolean;
}) {
  const [from, setFrom] = useState('+919361778524');

  // In live mode there is nothing to simulate -- real calls drive everything.
  if (config?.live) return null;

  return (
    <div className="panel mb-5 flex flex-wrap items-center gap-x-5 gap-y-3 px-4 py-3">
      <span className="text-[11px] font-semibold tracking-wide text-[var(--muted)] uppercase">
        Demo controls
      </span>

      <div className="flex items-center gap-2 text-[12px]">
        <span className="text-[var(--muted)]">Customer:</span>
        {/* Segmented control rather than a <select>: the OS paints a native
            option list in its own colours, which ignores the app theme. */}
        <div
          role="radiogroup"
          aria-label="What the customer does"
          className="flex overflow-hidden rounded-lg border border-[var(--line)]"
        >
          {(
            [
              ['answer', 'Picks up'],
              ['no-answer', 'No answer'],
              ['busy', 'Busy'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="radio"
              aria-checked={outcome === key}
              onClick={() => onOutcomeChange(key)}
              className={`px-2.5 py-1 font-semibold transition ${
                outcome === key
                  ? 'bg-[var(--accent)] text-white'
                  : 'bg-[var(--panel-2)] text-[var(--muted)] hover:text-[var(--text)]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="ml-auto flex items-center gap-2">
        <input
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          aria-label="Number to simulate an incoming call from"
          placeholder="+91…"
          className="mono w-[150px] rounded-lg border border-[var(--line)] bg-[var(--panel-2)] px-2 py-1.5 text-[12px] outline-none focus:border-[var(--accent)]"
        />
        <button
          disabled={busy || !from.trim()}
          onClick={() => onSimulateInbound(from.trim())}
          className="rounded-lg border border-[var(--accent-2)] bg-[rgba(15,118,110,.10)] px-3 py-1.5 text-[12px] font-bold text-[var(--accent-2)] transition enabled:hover:brightness-125 disabled:cursor-not-allowed disabled:opacity-40"
          title="Posts a real inbound Answer URL payload — your backend decides who to ring"
        >
          ☎ Simulate incoming call
        </button>
      </div>
    </div>
  );
}
