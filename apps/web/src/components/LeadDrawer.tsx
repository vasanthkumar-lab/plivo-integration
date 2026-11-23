'use client';

import type { Activity, CallLog, Lead, Rep } from '@/lib/types';
import { Avatar, fmtDuration, fmtMoney, fmtRelative, StageChip } from './ui';

const ICON: Record<Activity['type'], string> = { call: '📞', note: '📝', stage: '🎯', system: '⚙' };

export function LeadDrawer({
  lead,
  owner,
  activities,
  calls,
  onClose,
  onCall,
  canCall,
}: {
  lead: Lead;
  owner: Rep | null;
  activities: Activity[];
  calls: CallLog[];
  onClose: () => void;
  onCall: (lead: Lead) => void;
  canCall: boolean;
}) {
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <aside
        className="slide-up h-full w-[min(92vw,460px)] overflow-y-auto border-l border-[var(--line)] bg-[var(--panel)] p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-start justify-between">
          <div className="flex items-center gap-3">
            <Avatar name={lead.name} color={owner?.avatarColor ?? '#22c55e'} size={48} />
            <div>
              <h3 className="text-lg font-bold">{lead.name}</h3>
              <p className="text-xs text-[var(--muted)]">{lead.company}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-xl text-[var(--muted)] hover:text-[var(--text)]">
            ×
          </button>
        </div>

        <div className="mb-5 grid grid-cols-2 gap-3 text-sm">
          <Field label="Stage" value={<StageChip stage={lead.stage} />} />
          <Field label="Deal value" value={<span className="font-bold">{fmtMoney(lead.value)}</span>} />
          <Field label="Phone" value={<span className="mono text-[12px]">{lead.phone}</span>} />
          <Field label="Owner" value={owner?.name ?? '—'} />
          <Field label="Email" value={<span className="text-[12px] break-all">{lead.email}</span>} />
          <Field label="Last call" value={fmtRelative(lead.lastContactedAt)} />
        </div>

        <button
          disabled={!canCall}
          onClick={() => onCall(lead)}
          className="mb-6 w-full rounded-xl bg-[var(--accent)] py-2.5 text-sm font-bold text-white transition enabled:hover:brightness-110 disabled:cursor-not-allowed disabled:bg-[var(--panel-2)] disabled:text-[var(--muted)]"
        >
          📞 Call {lead.name.split(' ')[0]}
        </button>

        <h4 className="mb-3 text-[11px] font-semibold tracking-wide text-[var(--muted)] uppercase">
          Call history ({calls.length})
        </h4>
        {calls.length === 0 ? (
          <p className="mb-6 text-xs text-[var(--muted)]">No calls yet.</p>
        ) : (
          <ul className="mb-6 space-y-2">
            {calls.map((c) => (
              <li key={c.id} className="rounded-xl border border-[var(--line)] px-3 py-2.5 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-semibold">
                    {c.direction === 'outbound' ? '↗ Outbound' : '↘ Inbound'}
                  </span>
                  <span className="mono text-[var(--muted)]">{fmtDuration(c.durationSec)}</span>
                </div>
                <div className="mt-1 flex items-center justify-between text-[var(--muted)]">
                  <span>{new Date(c.startedAt).toLocaleString()}</span>
                  <span className="capitalize">{c.status.replace('-', ' ')}</span>
                </div>
                {c.disposition && (
                  <div className="mt-1.5 text-[var(--accent)] capitalize">
                    {c.disposition.replace('_', ' ')}
                    {c.notes && <span className="text-[var(--muted)]"> — {c.notes}</span>}
                  </div>
                )}
                {c.recordingUrl && (
                  <div className="mono mt-1 truncate text-[10px] text-[var(--muted)]">
                    🎙 {c.recordingUrl}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        <h4 className="mb-3 text-[11px] font-semibold tracking-wide text-[var(--muted)] uppercase">
          Activity timeline
        </h4>
        {activities.length === 0 ? (
          <p className="text-xs text-[var(--muted)]">Nothing logged yet.</p>
        ) : (
          <ul className="space-y-3 border-l border-[var(--line)] pl-4">
            {activities.map((a) => (
              <li key={a.id} className="relative">
                <span className="absolute top-1 -left-[22px] text-xs">{ICON[a.type]}</span>
                <div className="text-[13px] font-semibold">{a.title}</div>
                {a.body && <div className="text-xs text-[var(--muted)]">{a.body}</div>}
                <div className="text-[10px] text-[var(--muted)]/70">
                  {new Date(a.at).toLocaleString()}
                </div>
              </li>
            ))}
          </ul>
        )}
      </aside>
    </div>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-[var(--panel-2)] px-3 py-2">
      <div className="mb-1 text-[10px] tracking-wide text-[var(--muted)] uppercase">{label}</div>
      <div>{value}</div>
    </div>
  );
}
