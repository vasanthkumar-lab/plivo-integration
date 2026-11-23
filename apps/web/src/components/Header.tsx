'use client';

import { useEffect, useRef, useState } from 'react';
import type { PlivoRuntimeConfig, Rep } from '@/lib/types';
import { Avatar, Dot } from './ui';

export function Header({
  config,
  reps,
  repId,
  onRepChange,
  disabled,
}: {
  config: PlivoRuntimeConfig | null;
  reps: Rep[];
  repId: string;
  onRepChange: (id: string) => void;
  disabled: boolean;
}) {
  const live = config?.live;
  // Until config arrives, say so rather than claiming a mode we don't know yet.
  const badge = !config
    ? { text: 'CHECKING…', color: 'var(--muted)', border: 'var(--line)', bg: 'var(--panel-2)' }
    : live
      ? { text: 'LIVE PLIVO', color: 'var(--good)', border: 'rgba(21,128,61,.35)', bg: 'rgba(21,128,61,.08)' }
      : { text: 'SIMULATOR MODE', color: 'var(--warn)', border: 'rgba(180,83,9,.35)', bg: 'rgba(180,83,9,.08)' };

  return (
    <header className="mb-5 flex flex-wrap items-center justify-between gap-4">
      <div className="flex items-center gap-3">
        <div
          className="flex h-10 w-10 items-center justify-center rounded-xl text-lg font-black text-white"
          style={{ background: 'linear-gradient(135deg,var(--accent),var(--accent-2))' }}
        >
          H
        </div>
        <h1 className="text-lg leading-tight font-bold">Hyring Sales CRM</h1>
      </div>

      <div className="flex flex-wrap items-center gap-2.5">
        <div
          className="flex items-center gap-2 rounded-xl border px-3 py-2 text-[11px] font-semibold"
          style={{ borderColor: badge.border, background: badge.bg, color: badge.color }}
          title={
            !config
              ? 'Asking the backend which mode it is in…'
              : live
                ? 'Real Plivo credentials detected — calls go over WebRTC to the phone network.'
                : 'Simulator — real Plivo webhook payloads are posted to your Answer and Hangup URLs.'
          }
        >
          <Dot color={badge.color} />
          {badge.text}
        </div>

        <div className="mono hidden rounded-xl border border-[var(--line)] px-3 py-2 text-[11px] text-[var(--muted)] lg:block">
          {config?.phoneNumber ?? '…'}
        </div>

        <RepPicker reps={reps} repId={repId} onChange={onRepChange} disabled={disabled} />
      </div>
    </header>
  );
}

/**
 * Custom rep picker. A native <select> renders its option list with the
 * operating system's own colours, which ignores the app theme entirely.
 */
function RepPicker({
  reps,
  repId,
  onChange,
  disabled,
}: {
  reps: Rep[];
  repId: string;
  onChange: (id: string) => void;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const rep = reps.find((r) => r.id === repId);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={boxRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        title={disabled ? 'Finish the current call first' : 'Switch logged-in rep'}
        className="flex items-center gap-2 rounded-xl border border-[var(--line)] bg-[var(--panel)] px-2.5 py-1.5 text-[12px] font-semibold transition hover:border-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {rep && <Avatar name={rep.name} color={rep.avatarColor} size={26} />}
        <span>{rep?.name ?? 'Select rep'}</span>
        <span className="text-[10px] text-[var(--muted)]">{open ? '▴' : '▾'}</span>
      </button>

      {open && (
        <ul
          role="listbox"
          className="slide-up panel absolute right-0 z-50 mt-1.5 w-[210px] overflow-hidden p-1"
        >
          {reps.map((r) => {
            const selected = r.id === repId;
            return (
              <li key={r.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => {
                    onChange(r.id);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] transition ${
                    selected
                      ? 'bg-[rgba(21,128,61,.10)] font-semibold text-[var(--accent)]'
                      : 'hover:bg-[var(--panel-2)]'
                  }`}
                >
                  <Avatar name={r.name} color={r.avatarColor} size={24} />
                  <span className="min-w-0 flex-1 truncate">{r.name}</span>
                  <Dot color={r.online ? 'var(--good)' : 'var(--line)'} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
