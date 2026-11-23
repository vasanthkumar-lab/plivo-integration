'use client';

import type { Lead } from '@/lib/types';
import { Avatar, fmtMoney, StageChip } from './ui';

export function IncomingCall({
  lead,
  from,
  onAnswer,
  onReject,
}: {
  lead: Lead | null;
  from: string;
  onAnswer: () => void;
  onReject: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-sm">
      <div className="slide-up panel w-[min(94vw,400px)] p-6 text-center">
        <div className="shake mb-3 text-4xl">📞</div>
        <div className="mb-1 text-[11px] font-semibold tracking-widest text-[var(--accent)] uppercase">
          Incoming call
        </div>

        {lead ? (
          <>
            <div className="my-3 flex items-center justify-center">
              <Avatar name={lead.name} color="#15803d" size={64} />
            </div>
            <div className="text-xl font-bold">{lead.name}</div>
            <div className="text-sm text-[var(--muted)]">{lead.company}</div>
            <div className="mt-3 flex items-center justify-center gap-2">
              <StageChip stage={lead.stage} />
              <span className="rounded-full bg-[var(--panel-2)] px-2.5 py-1 text-[11px] font-semibold text-[var(--muted)]">
                {lead.id}
              </span>
              <span className="rounded-full bg-[var(--panel-2)] px-2.5 py-1 text-[11px] font-semibold text-[var(--muted)]">
                {fmtMoney(lead.value)}
              </span>
            </div>
          </>
        ) : (
          <>
            <div className="my-4 text-xl font-bold">Unknown caller</div>
            <div className="text-xs text-[var(--muted)]">No matching lead in the CRM</div>
          </>
        )}

        <div className="mono mt-3 mb-5 text-xs text-[var(--muted)]">{from}</div>

        <div className="flex gap-3">
          <button
            onClick={onReject}
            className="flex-1 rounded-xl border border-[var(--line)] py-3 text-sm font-semibold text-[var(--muted)] transition hover:border-[var(--bad)] hover:text-[var(--bad)]"
          >
            Decline
          </button>
          <button
            onClick={onAnswer}
            className="flex-1 rounded-xl bg-[var(--good)] py-3 text-sm font-bold text-white transition hover:brightness-110"
          >
            Answer
          </button>
        </div>
      </div>
    </div>
  );
}
