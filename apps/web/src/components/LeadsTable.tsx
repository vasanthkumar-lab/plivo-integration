'use client';

import type { Lead, PhoneState, Rep } from '@/lib/types';
import { Avatar, fmtMoney, fmtRelative, StageChip } from './ui';

export function LeadsTable({
  leads,
  reps,
  currentRepId,
  phone,
  onCall,
  onOpen,
}: {
  leads: Lead[];
  reps: Rep[];
  currentRepId: string;
  phone: PhoneState;
  onCall: (lead: Lead) => void;
  onOpen: (lead: Lead) => void;
}) {
  const canCall = phone.kind === 'ready';
  const activeLeadId =
    phone.kind === 'dialing' || phone.kind === 'in-call' || phone.kind === 'ringing-in'
      ? phone.lead?.id
      : undefined;

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="text-left text-[11px] tracking-wide text-[var(--muted)] uppercase">
            <th className="px-4 py-2.5 font-semibold">Lead</th>
            <th className="px-4 py-2.5 font-semibold">Phone</th>
            <th className="px-4 py-2.5 font-semibold">Stage</th>
            <th className="px-4 py-2.5 font-semibold">Value</th>
            <th className="px-4 py-2.5 font-semibold">Owner</th>
            <th className="px-4 py-2.5 font-semibold">Last call</th>
            <th className="px-4 py-2.5 text-right font-semibold">Action</th>
          </tr>
        </thead>
        <tbody>
          {leads.map((lead) => {
            const owner = reps.find((r) => r.id === lead.ownerId);
            const isMine = lead.ownerId === currentRepId;
            const isActive = activeLeadId === lead.id;

            return (
              <tr
                key={lead.id}
                className={`border-t border-[var(--line)]/70 transition hover:bg-white/[0.025] ${
                  isActive ? 'bg-[rgba(34,197,94,.09)]' : ''
                }`}
              >
                <td className="px-4 py-3">
                  <button onClick={() => onOpen(lead)} className="flex items-center gap-3 text-left">
                    <Avatar name={lead.name} color={owner?.avatarColor ?? '#22c55e'} />
                    <span>
                      <span className="block font-semibold hover:text-[var(--accent)]">{lead.name}</span>
                      <span className="block text-[11px] text-[var(--muted)]">{lead.company}</span>
                    </span>
                  </button>
                </td>
                <td className="mono px-4 py-3 text-[12px] text-[var(--muted)]">{lead.phone}</td>
                <td className="px-4 py-3">
                  <StageChip stage={lead.stage} />
                </td>
                <td className="px-4 py-3 font-semibold tabular-nums">{fmtMoney(lead.value)}</td>
                <td className="px-4 py-3 text-[12px] text-[var(--muted)]">
                  {owner?.name ?? '—'}
                  {!isMine && <span className="ml-1 text-[10px] opacity-60">(other rep)</span>}
                </td>
                <td className="px-4 py-3 text-[12px] text-[var(--muted)]">
                  {fmtRelative(lead.lastContactedAt)}
                </td>
                <td className="px-4 py-3 text-right">
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
  );
}
