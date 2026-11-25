'use client';

import type { Rep } from '@/lib/types';
import { Avatar } from './ui';

export type View = 'overview' | 'leads' | 'calls';

const NAV: { key: View; label: string; icon: React.ReactNode }[] = [
  {
    key: 'overview',
    label: 'Overview',
    icon: (
      <path d="M3 13h8V3H3v10Zm0 8h8v-6H3v6Zm10 0h8V11h-8v10Zm0-18v6h8V3h-8Z" />
    ),
  },
  {
    key: 'leads',
    label: 'Leads',
    icon: (
      <path d="M16 11a4 4 0 1 0-4-4 4 4 0 0 0 4 4Zm-8 1a3 3 0 1 0-3-3 3 3 0 0 0 3 3Zm0 2c-2.3 0-6 1.2-6 3.5V20h7v-2.5c0-1 .4-1.9 1.1-2.6A10 10 0 0 0 8 14Zm8 0c-2.7 0-8 1.3-8 4v2h16v-2c0-2.7-5.3-4-8-4Z" />
    ),
  },
  {
    key: 'calls',
    label: 'Calls',
    icon: (
      <path d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.2 11.4 11.4 0 0 0 3.6.6 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1 11.4 11.4 0 0 0 .6 3.6 1 1 0 0 1-.3 1l-2.2 2.2Z" />
    ),
  },
];

export function Sidebar({
  view,
  onView,
  rep,
  reps,
  onRepChange,
  counts,
  disabled,
}: {
  view: View;
  onView: (v: View) => void;
  rep: Rep | null;
  reps: Rep[];
  onRepChange: (id: string) => void;
  counts: { leads: number; calls: number };
  disabled: boolean;
}) {
  return (
    <aside className="flex h-screen w-[232px] shrink-0 flex-col border-r border-[var(--line)] bg-white">
      {/* brand */}
      <div className="flex items-center gap-2.5 px-5 py-5">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--accent)] text-[15px] font-bold text-white">
          H
        </span>
        <span className="text-[17px] font-bold tracking-tight">Hyring</span>
      </div>

      <nav className="flex flex-col gap-1 px-3">
        {NAV.map((item) => {
          const active = view === item.key;
          const badge =
            item.key === 'leads' ? counts.leads : item.key === 'calls' ? counts.calls : 0;
          return (
            <button
              key={item.key}
              onClick={() => onView(item.key)}
              aria-current={active ? 'page' : undefined}
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-[14px] font-semibold transition ${
                active
                  ? 'bg-[var(--panel-2)] text-[var(--accent)]'
                  : 'text-[var(--muted)] hover:bg-[var(--panel-2)]/60 hover:text-[var(--text)]'
              }`}
            >
              <svg
                viewBox="0 0 24 24"
                className="h-[18px] w-[18px] shrink-0"
                fill="currentColor"
                aria-hidden="true"
              >
                {item.icon}
              </svg>
              <span className="flex-1 text-left">{item.label}</span>
              {badge > 0 && (
                <span className="mono text-[11px] font-semibold text-[var(--muted)]">{badge}</span>
              )}
            </button>
          );
        })}
      </nav>

      <div className="flex-1" />

      {/* who you are signed in as */}
      <div className="border-t border-[var(--line)] p-3">
        <label className="mb-1.5 block px-1 text-[10px] font-semibold tracking-wide text-[var(--muted)] uppercase">
          Signed in as
        </label>
        <div className="flex items-center gap-2.5 rounded-xl px-1 py-1">
          <Avatar name={rep?.name ?? '—'} color={rep?.avatarColor ?? '#15803d'} size={30} />
          <select
            value={rep?.id ?? ''}
            onChange={(e) => onRepChange(e.target.value)}
            disabled={disabled}
            title={disabled ? 'Finish the call before switching rep' : undefined}
            className="min-w-0 flex-1 cursor-pointer truncate bg-transparent text-[13px] font-semibold outline-none disabled:cursor-not-allowed disabled:opacity-60"
          >
            {reps.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </div>
      </div>
    </aside>
  );
}
