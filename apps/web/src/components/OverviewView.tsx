'use client';

import { useMemo } from 'react';
import type { Activity, CallAnalysis, CallLog, Lead } from '@/lib/types';
import { fmtDuration, fmtRelative } from './ui';
import { titleForOutcome } from '@/lib/callOutcome';

function Stat({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: string;
  hint?: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-[var(--line)] bg-white p-4">
      <div className="text-[10.5px] font-semibold tracking-wide text-[var(--muted)] uppercase">
        {label}
      </div>
      <div
        className="mt-1.5 text-[26px] leading-none font-bold tabular-nums"
        style={accent ? { color: 'var(--accent)' } : undefined}
      >
        {value}
      </div>
      {hint && <div className="mt-1 text-[11.5px] text-[var(--muted)]">{hint}</div>}
    </div>
  );
}

export function OverviewView({
  calls,
  leads,
  activities,
  analyses,
  onOpenCalls,
}: {
  calls: CallLog[];
  leads: Lead[];
  activities: Activity[];
  analyses: Record<string, CallAnalysis>;
  onOpenCalls: () => void;
}) {
  const stats = useMemo(() => {
    const connected = calls.filter((c) => c.status === 'completed');
    const verdicts = Object.values(analyses).filter((a) => a.status === 'ready');
    return {
      calls: calls.length,
      connected: connected.length,
      talkTime: connected.reduce((sum, c) => sum + c.durationSec, 0),
      recordings: calls.filter((c) => c.recordingUrl).length,
      analysed: verdicts.length,
      converted: verdicts.filter((a) => a.converted).length,
    };
  }, [calls, analyses]);

  const recent = calls.slice(0, 6);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Calls" value={String(stats.calls)} hint={`${stats.connected} connected`} />
        <Stat label="Talk time" value={fmtDuration(stats.talkTime)} />
        <Stat label="Contacts" value={String(leads.length)} />
        <Stat
          label="Converted"
          value={stats.analysed ? `${stats.converted}/${stats.analysed}` : '—'}
          hint={stats.analysed ? 'by AI verdict' : 'no calls analysed yet'}
          accent
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* recent calls */}
        <section className="overflow-hidden rounded-2xl border border-[var(--line)] bg-white">
          <header className="flex items-center justify-between border-b border-[var(--line)] px-4 py-3">
            <h2 className="text-[11px] font-semibold tracking-wide text-[var(--muted)] uppercase">
              Recent calls
            </h2>
            <button
              onClick={onOpenCalls}
              className="text-[11.5px] font-semibold text-[var(--accent)] transition hover:brightness-110"
            >
              View all
            </button>
          </header>
          {recent.length === 0 ? (
            <p className="px-4 py-8 text-center text-[12.5px] text-[var(--muted)]">
              No calls yet.
            </p>
          ) : (
            <ul>
              {recent.map((c) => {
                const lead = leads.find((l) => l.id === c.leadId);
                const a = analyses[c.callUuid];
                return (
                  <li
                    key={c.id}
                    className="flex items-center justify-between gap-3 border-b border-[var(--line)]/60 px-4 py-2.5 last:border-0"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-[13px] font-semibold">
                        {lead?.name ?? (c.direction === 'outbound' ? c.to : c.from)}
                      </div>
                      <div className="truncate text-[11px] text-[var(--muted)]">
                        {titleForOutcome(c)} · {fmtDuration(c.durationSec)} ·{' '}
                        {fmtRelative(c.startedAt)}
                      </div>
                    </div>
                    {a?.status === 'ready' && (
                      <span
                        className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold"
                        style={{
                          background: a.converted ? '#dcfce7' : 'var(--panel-2)',
                          color: a.converted ? '#166534' : 'var(--muted)',
                        }}
                      >
                        {a.converted ? 'Converted' : 'Not yet'}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* follow-up timeline */}
        <section className="overflow-hidden rounded-2xl border border-[var(--line)] bg-white">
          <header className="border-b border-[var(--line)] px-4 py-3">
            <h2 className="text-[11px] font-semibold tracking-wide text-[var(--muted)] uppercase">
              Follow-ups
            </h2>
          </header>
          {activities.length === 0 ? (
            <p className="px-4 py-8 text-center text-[12.5px] text-[var(--muted)]">
              Activity against your contacts shows up here.
            </p>
          ) : (
            <ul className="max-h-[320px] overflow-y-auto">
              {activities.slice(0, 12).map((a) => (
                <li
                  key={a.id}
                  className="border-b border-[var(--line)]/60 px-4 py-2.5 last:border-0"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="truncate text-[12.5px] font-semibold">{a.title}</span>
                    <span className="shrink-0 text-[10.5px] text-[var(--muted)]">
                      {fmtRelative(a.at)}
                    </span>
                  </div>
                  {a.body && (
                    <p className="mt-0.5 line-clamp-2 text-[11.5px] text-[var(--muted)]">
                      {a.body}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
