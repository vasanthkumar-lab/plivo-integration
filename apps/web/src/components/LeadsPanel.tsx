'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Lead, LeadStage, PhoneState, Rep } from '@/lib/types';
import { Avatar, fmtMoney, fmtRelative, StageChip } from './ui';

const STAGES: LeadStage[] = ['new', 'contacted', 'qualified', 'negotiation', 'won', 'lost'];

/** How far along the pipeline a stage sits. Derived from stage, not stored. */
const PROGRESS: Record<LeadStage, number> = {
  new: 15,
  contacted: 40,
  qualified: 65,
  negotiation: 85,
  won: 100,
  lost: 0,
};

export function LeadsPanel({
  title,
  leads,
  reps,
  currentRepId,
  phone,
  onCall,
  onOpen,
  children,
}: {
  title: string;
  leads: Lead[];
  reps: Rep[];
  currentRepId: string;
  phone: PhoneState;
  onCall: (lead: Lead) => void;
  onOpen: (lead: Lead) => void;
  children?: React.ReactNode;
}) {
  const [query, setQuery] = useState('');
  const [stages, setStages] = useState<LeadStage[]>([]);
  const [owner, setOwner] = useState<string>('');
  const [selected, setSelected] = useState<string[]>([]);
  const [filterOpen, setFilterOpen] = useState(false);
  const filterRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = useState<{ top: number; right: number } | null>(null);

  /**
   * The popover is rendered into <body>. The panel around it needs
   * overflow:hidden to round the table's corners, and the table scrolls
   * horizontally — either one would clip an absolutely positioned menu.
   */
  const placeMenu = () => {
    const r = filterRef.current?.getBoundingClientRect();
    if (r) setAnchor({ top: r.bottom + 6, right: window.innerWidth - r.right });
  };

  useEffect(() => {
    if (!filterOpen) return;

    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (filterRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setFilterOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setFilterOpen(false);
    const reposition = () => placeMenu();

    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [filterOpen]);

  const filterCount = stages.length + (owner ? 1 : 0);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return leads.filter((l) => {
      if (stages.length && !stages.includes(l.stage)) return false;
      if (owner && l.ownerId !== owner) return false;
      if (!q) return true;
      return [l.name, l.company, l.phone, l.email, l.id]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    });
  }, [leads, query, stages, owner]);

  const canCall = phone.kind === 'ready';
  const activeLeadId =
    phone.kind === 'dialing' || phone.kind === 'in-call' || phone.kind === 'ringing-in'
      ? phone.lead?.id
      : undefined;

  const allChecked = rows.length > 0 && rows.every((r) => selected.includes(r.id));
  const toggleAll = () =>
    setSelected(allChecked ? [] : rows.map((r) => r.id));
  const toggleOne = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  return (
    <section className="panel overflow-hidden">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] px-4 py-3">
        <h2 className="text-[13px] font-semibold tracking-wide text-[var(--muted)] uppercase">
          {title} · {rows.length}
          {rows.length !== leads.length && (
            <span className="ml-1 normal-case opacity-70">of {leads.length}</span>
          )}
        </h2>

        <div className="flex flex-1 flex-wrap items-center justify-end gap-2">
          <label className="relative min-w-0 flex-1 sm:max-w-[320px]">
            <span className="absolute top-1/2 left-3 -translate-y-1/2 text-[var(--muted)]">⌕</span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name, company, phone…"
              aria-label="Search leads"
              className="w-full rounded-xl border border-[var(--line)] bg-[var(--panel)] py-2 pr-3 pl-8 text-[13px] outline-none placeholder:text-[var(--muted)]/70 focus:border-[var(--accent)]"
            />
            {query && (
              <button
                onClick={() => setQuery('')}
                aria-label="Clear search"
                className="absolute top-1/2 right-2 -translate-y-1/2 text-[var(--muted)] hover:text-[var(--text)]"
              >
                ×
              </button>
            )}
          </label>

          <div ref={filterRef} className="relative">
            <button
              onClick={() => {
                placeMenu();
                setFilterOpen((o) => !o);
              }}
              aria-expanded={filterOpen}
              className={`flex items-center gap-1.5 rounded-xl border px-3 py-2 text-[13px] font-semibold transition ${
                filterCount
                  ? 'border-[var(--accent)] text-[var(--accent)]'
                  : 'border-[var(--line)] text-[var(--muted)] hover:text-[var(--text)]'
              }`}
            >
              <span aria-hidden>⚟</span> Filter
              {filterCount > 0 && (
                <span className="rounded-full bg-[var(--accent)] px-1.5 text-[11px] font-bold text-white">
                  {filterCount}
                </span>
              )}
            </button>

            {filterOpen &&
              anchor &&
              typeof document !== 'undefined' &&
              createPortal(
                <div
                  ref={panelRef}
                  className="slide-up panel fixed z-[70] max-h-[70vh] w-[240px] overflow-y-auto p-3 shadow-xl"
                  style={{ top: anchor.top, right: anchor.right }}
                >
                <div className="mb-1.5 text-[10px] font-semibold tracking-wide text-[var(--muted)] uppercase">
                  Stage
                </div>
                <div className="mb-3 flex flex-wrap gap-1.5">
                  {STAGES.map((s) => {
                    const on = stages.includes(s);
                    return (
                      <button
                        key={s}
                        onClick={() =>
                          setStages((prev) => (on ? prev.filter((x) => x !== s) : [...prev, s]))
                        }
                        className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold capitalize transition ${
                          on
                            ? 'border-[var(--accent)] bg-[rgba(21,128,61,.10)] text-[var(--accent)]'
                            : 'border-[var(--line)] text-[var(--muted)] hover:text-[var(--text)]'
                        }`}
                      >
                        {s}
                      </button>
                    );
                  })}
                </div>

                <div className="mb-1.5 text-[10px] font-semibold tracking-wide text-[var(--muted)] uppercase">
                  Owner
                </div>
                <div className="flex flex-col gap-1">
                  {reps.map((r) => (
                    <button
                      key={r.id}
                      onClick={() => setOwner((o) => (o === r.id ? '' : r.id))}
                      className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12px] transition ${
                        owner === r.id
                          ? 'bg-[rgba(21,128,61,.10)] font-semibold text-[var(--accent)]'
                          : 'hover:bg-[var(--panel-2)]'
                      }`}
                    >
                      <Avatar name={r.name} color={r.avatarColor} size={20} />
                      {r.name}
                    </button>
                  ))}
                </div>

                {filterCount > 0 && (
                  <button
                    onClick={() => {
                      setStages([]);
                      setOwner('');
                    }}
                    className="mt-3 w-full rounded-lg border border-[var(--line)] py-1.5 text-[12px] font-semibold text-[var(--muted)] hover:text-[var(--text)]"
                  >
                    Clear filters
                  </button>
                )}
                </div>,
                document.body,
              )}
          </div>
        </div>
      </header>

      {selected.length > 0 && (
        <div className="flex items-center gap-3 border-b border-[var(--line)] bg-[var(--panel-2)] px-4 py-2 text-[12px]">
          <span className="font-semibold">{selected.length} selected</span>
          <button
            onClick={() => setSelected([])}
            className="text-[var(--muted)] hover:text-[var(--text)]"
          >
            Clear selection
          </button>
        </div>
      )}

      {rows.length === 0 ? (
        <p className="px-4 py-10 text-center text-[12px] text-[var(--muted)]">
          {leads.length === 0
            ? 'No contacts yet. Numbers you call — and numbers that call you — appear here automatically.'
            : 'No leads match this search.'}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="text-left text-[11px] tracking-wide text-[var(--muted)] uppercase">
                <th className="w-9 px-4 py-2.5">
                  <input
                    type="checkbox"
                    checked={allChecked}
                    onChange={toggleAll}
                    aria-label="Select all leads"
                    className="accent-[var(--accent)]"
                  />
                </th>
                <th className="px-3 py-2.5 font-semibold">Name</th>
                <th className="px-3 py-2.5 font-semibold">Contacts</th>
                <th className="px-3 py-2.5 font-semibold">Company</th>
                <th className="px-3 py-2.5 font-semibold">Amount</th>
                <th className="px-3 py-2.5 font-semibold">Lead owner</th>
                <th className="px-3 py-2.5 font-semibold">Progress</th>
                <th className="px-3 py-2.5 font-semibold">Stage</th>
                <th className="px-3 py-2.5 text-right font-semibold">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((lead) => {
                const ownerRep = reps.find((r) => r.id === lead.ownerId);
                const isActive = activeLeadId === lead.id;
                const pct = PROGRESS[lead.stage];

                return (
                  <tr
                    key={lead.id}
                    className={`border-t border-[var(--line)] transition hover:bg-[var(--panel-2)]/60 ${
                      isActive ? 'bg-[rgba(21,128,61,.07)]' : ''
                    }`}
                  >
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selected.includes(lead.id)}
                        onChange={() => toggleOne(lead.id)}
                        aria-label={`Select ${lead.name}`}
                        className="accent-[var(--accent)]"
                      />
                    </td>

                    <td className="px-3 py-3">
                      <button onClick={() => onOpen(lead)} className="flex items-center gap-2.5 text-left">
                        <Avatar name={lead.name} color={ownerRep?.avatarColor ?? '#15803d'} size={32} />
                        <span className="font-semibold hover:text-[var(--accent)]">{lead.name}</span>
                      </button>
                    </td>

                    <td className="px-3 py-3">
                      <div className="text-[12px]">{lead.email || '—'}</div>
                      <div className="mono text-[12px] text-[var(--muted)]">{lead.phone}</div>
                    </td>

                    <td className="px-3 py-3 text-[13px] text-[var(--muted)]">{lead.company}</td>

                    <td className="px-3 py-3 font-semibold tabular-nums">{fmtMoney(lead.value)}</td>

                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2">
                        {ownerRep && <Avatar name={ownerRep.name} color={ownerRep.avatarColor} size={24} />}
                        <span className="text-[12px] text-[var(--muted)]">
                          {ownerRep?.name.split(' ')[0] ?? '—'}
                        </span>
                      </div>
                    </td>

                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-[72px] overflow-hidden rounded-full bg-[var(--panel-2)]">
                          <div
                            className="h-full rounded-full"
                            style={{ width: `${pct}%`, background: 'var(--accent)' }}
                          />
                        </div>
                        <span className="mono text-[11px] tabular-nums text-[var(--muted)]">{pct}%</span>
                      </div>
                      <div className="mt-0.5 text-[10px] text-[var(--muted)]">
                        {fmtRelative(lead.lastContactedAt)}
                      </div>
                    </td>

                    <td className="px-3 py-3">
                      <StageChip stage={lead.stage} />
                    </td>

                    <td className="px-3 py-3 text-right">
                      <button
                        disabled={!canCall}
                        onClick={() => onCall(lead)}
                        title={canCall ? `Call ${lead.name}` : 'Register the phone first'}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-3 py-1.5 text-[12px] font-bold text-white transition enabled:hover:brightness-110 disabled:cursor-not-allowed disabled:bg-[var(--panel-2)] disabled:text-[var(--muted)]"
                      >
                        <span>📞</span> Call
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {children}
    </section>
  );
}
