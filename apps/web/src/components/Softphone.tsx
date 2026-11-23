'use client';

import { useState } from 'react';
import type { Disposition, PhoneState, PlivoRuntimeConfig, Rep } from '@/lib/types';
import { Avatar, Dot, fmtDuration } from './ui';

const DISPOSITIONS: { key: Disposition; label: string; color: string }[] = [
  { key: 'interested', label: 'Interested', color: 'var(--good)' },
  { key: 'callback', label: 'Callback', color: 'var(--warn)' },
  { key: 'not_interested', label: 'Not interested', color: 'var(--bad)' },
];

export function Softphone({
  phone,
  rep,
  config,
  elapsed,
  muted,
  onRegister,
  onUnregister,
  onHangup,
  onToggleMute,
  onDisposition,
  onSkip,
}: {
  phone: PhoneState;
  rep: Rep | null;
  config: PlivoRuntimeConfig | null;
  elapsed: number;
  muted: boolean;
  onRegister: () => void;
  onUnregister: () => void;
  onHangup: () => void;
  onToggleMute: () => void;
  onDisposition: (d: Disposition, notes?: string) => void;
  onSkip: () => void;
}) {
  const [notes, setNotes] = useState('');

  const statusMeta = {
    offline: { label: 'Not registered', color: 'var(--muted)' },
    registering: { label: 'Registering…', color: 'var(--warn)' },
    ready: { label: 'Phone ready', color: 'var(--good)' },
    dialing: { label: 'Dialing…', color: 'var(--accent-2)' },
    'ringing-in': { label: 'Incoming call', color: 'var(--accent-2)' },
    'in-call': { label: 'On call', color: 'var(--good)' },
    'wrap-up': { label: 'Wrap-up', color: 'var(--warn)' },
  }[phone.kind];

  return (
    <div className="panel overflow-hidden">
      <div className="flex items-center justify-between border-b border-[var(--line)] px-4 py-3">
        <div className="flex items-center gap-2">
          <Dot color={statusMeta.color} />
          <span className="text-sm font-semibold">{statusMeta.label}</span>
        </div>
        {/* The endpoint username is long enough to overflow the header, and it
            means nothing to a rep -- show the name, keep the URI on hover. */}
        <span
          className="max-w-[55%] truncate text-[11px] text-[var(--muted)]"
          title={rep ? `sip:${rep.endpoint}@phone.plivo.com` : undefined}
        >
          {rep ? rep.name : '—'}
        </span>
      </div>

      <div className="p-4">
        {/* ---------- not registered ---------- */}
        {phone.kind === 'offline' && (
          <div className="text-center">
            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-[var(--panel-2)] text-2xl">
              ☎
            </div>
            <p className="mb-1 text-sm text-[var(--muted)]">
              The browser must register with Plivo before it can make or receive calls.
            </p>
            <p className="mb-4 text-[11px] text-[var(--muted)]">
              Fetches a short-lived JWT from your backend — credentials never reach the browser.
            </p>
            <button
              onClick={onRegister}
              className="w-full rounded-xl bg-[var(--accent)] py-2.5 text-sm font-semibold text-white transition hover:brightness-110"
            >
              Register phone
            </button>
          </div>
        )}

        {phone.kind === 'registering' && (
          <div className="py-6 text-center text-sm text-[var(--muted)]">
            <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-[var(--line)] border-t-[var(--accent)]" />
            Requesting token and logging in…
          </div>
        )}

        {/* ---------- idle ---------- */}
        {phone.kind === 'ready' && (
          <div className="text-center">
            <div className="mb-3 text-sm text-[var(--muted)]">
              Registered as <span className="font-semibold text-[var(--text)]">{rep?.name}</span>.
              <br />
              Click <span className="font-semibold text-[var(--text)]">Call</span> on any lead to dial out.
            </div>
            <div className="mono mb-3 rounded-lg bg-[var(--panel-2)] px-3 py-2 text-[11px] text-[var(--muted)]">
              Your number: {config?.phoneNumber}
            </div>
            <button
              onClick={onUnregister}
              className="w-full rounded-xl border border-[var(--line)] py-2 text-xs font-semibold text-[var(--muted)] transition hover:text-[var(--text)]"
            >
              Unregister
            </button>
          </div>
        )}

        {/* ---------- dialing ---------- */}
        {phone.kind === 'dialing' && (
          <div className="text-center">
            <div className="ring-pulse mx-auto mb-3 h-16 w-16 rounded-full" style={{ background: 'var(--panel-2)' }}>
              <div className="flex h-full w-full items-center justify-center text-2xl">📞</div>
            </div>
            <div className="text-base font-semibold">{phone.lead.name}</div>
            <div className="mono mb-1 text-xs text-[var(--muted)]">{phone.lead.phone}</div>
            <div className="mb-4 text-xs text-[var(--accent)]">Ringing…</div>
            <button
              onClick={onHangup}
              className="w-full rounded-xl bg-[var(--bad)] py-2.5 text-sm font-semibold text-white transition hover:brightness-110"
            >
              Cancel
            </button>
          </div>
        )}

        {/* ---------- in call ---------- */}
        {phone.kind === 'in-call' && (
          <div className="text-center">
            <div className="mb-2 flex items-center justify-center gap-2">
              <Avatar name={phone.lead?.name ?? 'Unknown'} color="#15803d" size={44} />
            </div>
            <div className="text-base font-semibold">{phone.lead?.name ?? 'Unknown caller'}</div>
            <div className="text-xs text-[var(--muted)]">{phone.lead?.company}</div>
            <div className="mono my-3 text-3xl font-bold tabular-nums text-[var(--good)]">
              {fmtDuration(elapsed)}
            </div>
            <div className="mb-4 flex items-center justify-center gap-2 text-[11px] text-[var(--muted)]">
              <Dot color="#22c55e" />
              {phone.direction === 'outbound' ? 'Outbound' : 'Inbound'}
              {config?.recordCalls && ' · recording'}
            </div>
            <div className="flex gap-2">
              <button
                onClick={onToggleMute}
                className={`flex-1 rounded-xl border py-2.5 text-sm font-semibold transition ${
                  muted
                    ? 'border-[var(--warn)] bg-[rgba(245,158,11,.14)] text-[var(--warn)]'
                    : 'border-[var(--line)] text-[var(--muted)] hover:text-[var(--text)]'
                }`}
              >
                {muted ? 'Unmute' : 'Mute'}
              </button>
              <button
                onClick={onHangup}
                className="flex-1 rounded-xl bg-[var(--bad)] py-2.5 text-sm font-semibold text-white transition hover:brightness-110"
              >
                Hang up
              </button>
            </div>
          </div>
        )}

        {/* ---------- disposition ---------- */}
        {phone.kind === 'wrap-up' && (
          <div className="slide-up">
            <div className="mb-3 text-center">
              <div className="text-sm font-semibold">{phone.title ?? 'Call ended'}</div>
              <div className="text-xs text-[var(--muted)]">
                {phone.lead?.name ?? 'Unknown'} · {fmtDuration(phone.durationSec)}
              </div>
              {phone.summary && (
                <div className="mt-1 text-[11px] text-[var(--muted)]">{phone.summary}</div>
              )}
            </div>
            <div className="mb-2 text-[11px] font-semibold tracking-wide text-[var(--muted)] uppercase">
              How did it go?
            </div>
            <div className="mb-3 grid gap-2">
              {DISPOSITIONS.map((d) => (
                <button
                  key={d.key}
                  onClick={() => {
                    onDisposition(d.key, notes);
                    setNotes('');
                  }}
                  className="flex items-center gap-2 rounded-xl border border-[var(--line)] px-3 py-2.5 text-left text-sm font-semibold transition hover:border-[color:var(--accent)]"
                >
                  <Dot color={d.color} />
                  {d.label}
                </button>
              ))}
            </div>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Add a note (optional)…"
              rows={2}
              className="mb-2 w-full resize-none rounded-xl border border-[var(--line)] bg-[var(--panel-2)] px-3 py-2 text-sm outline-none placeholder:text-[var(--muted)] focus:border-[var(--accent)]"
            />
            <button
              onClick={() => {
                onSkip();
                setNotes('');
              }}
              className="w-full py-1 text-[11px] text-[var(--muted)] hover:text-[var(--text)]"
            >
              Skip
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
