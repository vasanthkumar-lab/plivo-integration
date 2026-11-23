'use client';

import { useEffect, useRef, useState } from 'react';
import type { WireEntry } from '@/lib/types';
import { fmtTime } from './ui';

const ACTOR: Record<WireEntry['actor'], { label: string; color: string }> = {
  browser: { label: 'BROWSER', color: '#0f766e' },
  backend: { label: 'BACKEND', color: '#15803d' },
  plivo: { label: 'PLIVO', color: '#6d28d9' },
  carrier: { label: 'CARRIER', color: '#b45309' },
};

function Entry({ entry }: { entry: WireEntry }) {
  const [open, setOpen] = useState(false);
  const actor = ACTOR[entry.actor];
  const hasBody = entry.body !== undefined && entry.body !== null;

  return (
    <li className="border-b border-[var(--line)]/60 px-4 py-2.5 last:border-0">
      <button
        onClick={() => hasBody && setOpen((o) => !o)}
        className={`flex w-full items-start gap-3 text-left ${hasBody ? 'cursor-pointer' : 'cursor-default'}`}
      >
        <span className="mono mt-0.5 w-[60px] shrink-0 text-[10px] text-[var(--muted)]">
          {fmtTime(entry.at)}
        </span>
        <span
          className="mono mt-0.5 w-[62px] shrink-0 rounded px-1 py-0.5 text-center text-[9px] font-bold"
          style={{ background: `${actor.color}22`, color: actor.color }}
        >
          {actor.label}
        </span>
        <span className="min-w-0 flex-1">
          <span className="mono block truncate text-[12px] font-semibold text-[var(--text)]">
            {entry.label}
          </span>
          {entry.detail && (
            <span className="block truncate text-[11px] text-[var(--muted)]">{entry.detail}</span>
          )}
        </span>
        {hasBody && (
          <span className="mt-0.5 shrink-0 text-[10px] text-[var(--muted)]">{open ? '▾' : '▸'}</span>
        )}
      </button>

      {open && hasBody && (
        <pre className="mono mt-2 ml-[134px] overflow-x-auto rounded-lg bg-[var(--code-bg)] p-3 text-[11px] leading-relaxed text-[var(--code-fg)]">
          {typeof entry.body === 'string' ? entry.body : JSON.stringify(entry.body, null, 2)}
        </pre>
      )}
    </li>
  );
}

export function Inspector({ wire, onClear }: { wire: WireEntry[]; onClear: () => void }) {
  const [autoScroll, setAutoScroll] = useState(true);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (autoScroll) endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [wire, autoScroll]);

  return (
    <section className="panel flex min-h-0 flex-col overflow-hidden">
      <header className="flex shrink-0 items-center justify-between border-b border-[var(--line)] px-4 py-3">
        <div>
          <h2 className="text-[13px] font-semibold tracking-wide text-[var(--muted)] uppercase">
            Integration Inspector
          </h2>
          <p className="text-[11px] text-[var(--muted)]/80">
            Live traffic on the Plivo boundary — click a row to see the payload
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-[var(--muted)]">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
              className="accent-[var(--accent)]"
            />
            Follow
          </label>
          <button
            onClick={onClear}
            className="rounded-lg border border-[var(--line)] px-2.5 py-1 text-[11px] font-semibold text-[var(--muted)] transition hover:text-[var(--text)]"
          >
            Clear
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {wire.length === 0 ? (
          <div className="px-4 py-10 text-center text-[12px] text-[var(--muted)]">
            Nothing yet. Register the phone, then place a call — every request between the browser,
            your backend and Plivo shows up here.
          </div>
        ) : (
          <ul>
            {wire.map((e) => (
              <Entry key={e.id} entry={e} />
            ))}
            <div ref={endRef} />
          </ul>
        )}
      </div>
    </section>
  );
}
