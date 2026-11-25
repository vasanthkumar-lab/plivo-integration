'use client';

import { useMemo, useState } from 'react';
import type { Lead, PhoneState, Rep } from '@/lib/types';
import { Avatar, StageChip, fmtMoney, fmtRelative } from './ui';

export function LeadsView({
  leads,
  reps,
  phone,
  onCall,
  onOpen,
  addLead,
}: {
  leads: Lead[];
  reps: Rep[];
  phone: PhoneState;
  onCall: (lead: Lead) => void;
  onOpen: (lead: Lead) => void;
  addLead: React.ReactNode;
}) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return leads;
    return leads.filter((l) =>
      [l.name, l.company, l.phone, l.email].some((v) => (v ?? '').toLowerCase().includes(q)),
    );
  }, [leads, query]);

  const canCall = phone.kind === 'ready';

  return (
    <section className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-[var(--line)] bg-white">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] px-4 py-3.5">
        <h2 className="text-[17px] font-bold tracking-tight">Contacts</h2>

        <div className="flex flex-1 items-center justify-end gap-2">
          <div className="relative w-full max-w-[280px]">
            <svg
              viewBox="0 0 24 24"
              className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-[var(--muted)]"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name, company, phone…"
              className="w-full rounded-xl border border-[var(--line)] bg-[var(--panel-2)] py-2 pr-3 pl-9 text-[13px] outline-none placeholder:text-[var(--muted)] focus:border-[var(--accent)]"
            />
          </div>
          {addLead}
        </div>
      </header>

      {filtered.length === 0 ? (
        <p className="px-4 py-12 text-center text-[13px] text-[var(--muted)]">
          {leads.length === 0
            ? 'No contacts yet. Numbers you call — and numbers that call you — appear here automatically.'
            : `No contacts match “${query}”.`}
        </p>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full border-collapse text-left">
            <thead className="sticky top-0 z-10 bg-white">
              <tr className="border-b border-[var(--line)]">
                {['Full name', 'Phone number', 'Email', 'Stage', 'Value', 'Last contact', ''].map(
                  (h) => (
                    <th
                      key={h}
                      scope="col"
                      className="px-4 py-2.5 text-[10.5px] font-semibold tracking-wide text-[var(--muted)] uppercase"
                    >
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {filtered.map((l) => {
                const owner = reps.find((r) => r.id === l.ownerId);
                return (
                  <tr
                    key={l.id}
                    className="group cursor-pointer border-b border-[var(--line)]/60 transition hover:bg-[var(--panel-2)]/60"
                    onClick={() => onOpen(l)}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <Avatar
                          name={l.name}
                          color={owner?.avatarColor ?? '#15803d'}
                          size={30}
                        />
                        <div className="min-w-0">
                          <div className="truncate text-[13.5px] font-semibold">{l.name}</div>
                          <div className="truncate text-[11px] text-[var(--muted)]">
                            {l.company}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="mono px-4 py-3 text-[12.5px] whitespace-nowrap">{l.phone}</td>
                    <td className="px-4 py-3 text-[12.5px] text-[var(--muted)]">
                      {l.email || '—'}
                    </td>
                    <td className="px-4 py-3">
                      <StageChip stage={l.stage} />
                    </td>
                    <td className="px-4 py-3 text-[12.5px] font-semibold whitespace-nowrap">
                      {fmtMoney(l.value)}
                    </td>
                    <td className="px-4 py-3 text-[12px] whitespace-nowrap text-[var(--muted)]">
                      {fmtRelative(l.lastContactedAt)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onCall(l);
                        }}
                        disabled={!canCall}
                        title={canCall ? `Call ${l.name}` : 'Phone is busy'}
                        className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-[12px] font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        Call
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
