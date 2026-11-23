'use client';

import { useMemo, useState } from 'react';
import { useSoftphone } from '@/lib/useSoftphone';
import { Header } from '@/components/Header';
import { DemoBar } from '@/components/DemoBar';
import { Dialer } from '@/components/Dialer';
import { LeadsPanel } from '@/components/LeadsPanel';
import { Recordings } from '@/components/Recordings';
import { Softphone } from '@/components/Softphone';
import { IncomingCall } from '@/components/IncomingCall';
import { Inspector } from '@/components/Inspector';
import { LeadDrawer } from '@/components/LeadDrawer';
import { Toasts } from '@/components/Toasts';
import { AddLead } from '@/components/AddLead';
import { Section, fmtDuration, fmtTime } from '@/components/ui';
import type { Lead } from '@/lib/types';

export default function Page() {
  const s = useSoftphone();
  const [openLead, setOpenLead] = useState<Lead | null>(null);
  const [outcome, setOutcome] = useState<'answer' | 'no-answer' | 'busy'>('answer');

  const myLeads = useMemo(() => s.leads.filter((l) => l.ownerId === s.repId), [s.leads, s.repId]);
  const otherLeads = useMemo(() => s.leads.filter((l) => l.ownerId !== s.repId), [s.leads, s.repId]);

  const stats = useMemo(() => {
    const connected = s.calls.filter((c) => c.status === 'completed');
    return {
      calls: s.calls.length,
      connected: connected.length,
      talkTime: connected.reduce((sum, c) => sum + c.durationSec, 0),
      recordings: s.recordings.length,
    };
  }, [s.calls]);

  const inCall = ['dialing', 'in-call', 'ringing-in', 'wrap-up'].includes(s.phone.kind);

  return (
    <main className="mx-auto max-w-[1500px] px-4 py-5 md:px-6">
      <Header
        config={s.config}
        reps={s.reps}
        repId={s.repId}
        onRepChange={s.setRepId}
        disabled={inCall}
      />

      {/* Errors surface as toasts, not as a banner that pushes the page down. */}
      {s.config?.live && (s.config.blockers?.length ?? 0) > 0 && (
        <div className="mb-4 rounded-xl border border-[var(--warn)]/35 bg-[rgba(180,83,9,.07)] px-4 py-3 text-sm text-[var(--warn)]">
          <div className="mb-1 font-semibold">Live mode is on, but calls will fail:</div>
          <ul className="list-inside list-disc space-y-0.5 text-[12px]">
            {s.config.blockers.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </div>
      )}

      {s.config && (s.phone.kind === 'offline' || s.phone.kind === 'registering') && (
        <div className="mb-4 rounded-xl border border-[var(--warn)]/35 bg-[rgba(180,83,9,.07)] px-4 py-3 text-sm text-[var(--warn)]">
          {s.phone.kind === 'registering' ? (
            <>Registering your phone with Plivo…</>
          ) : (
            <>
              <span className="font-semibold">Phone not registered.</span> Incoming calls will not
              ring — Plivo ends them immediately when no browser is registered. Use{' '}
              <span className="font-semibold">Register phone</span> in the panel on the right.
            </>
          )}
        </div>
      )}

      <DemoBar
        config={s.config}
        outcome={outcome}
        onOutcomeChange={setOutcome}
        onSimulateInbound={s.simulateInbound}
        busy={inCall || s.phone.kind === 'offline'}
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Calls today" value={String(stats.calls)} />
        <Stat label="Connected" value={String(stats.connected)} />
        <Stat label="Talk time" value={fmtDuration(stats.talkTime)} />
        <Stat label="Recordings" value={String(stats.recordings)} accent />
      </div>

      {/* items-start stops the columns stretching, which is what lets the
          softphone below stick instead of scrolling away during a call. */}
      <div className="mt-5 grid items-start gap-5 lg:grid-cols-[1fr_340px]">
        {/* ---------------- left column ---------------- */}
        <div className="flex min-w-0 flex-col gap-5">
          <Dialer phone={s.phone} defaultNumber="" onCall={(n) => s.callNumber(n, outcome)} />

          <LeadsPanel
            title="My pipeline"
            leads={myLeads}
            reps={s.reps}
            currentRepId={s.repId}
            phone={s.phone}
            onCall={(lead) => s.callLead(lead, outcome)}
            onOpen={setOpenLead}
          >
            <AddLead
              onAdded={(n) => {
                s.pushToast('success', 'Contact added', n);
                s.refresh();
              }}
            />
          </LeadsPanel>

          {otherLeads.length > 0 && (
            <LeadsPanel
              title="Other reps' leads"
              leads={otherLeads}
              reps={s.reps}
              currentRepId={s.repId}
              phone={s.phone}
              onCall={(lead) => s.callLead(lead, outcome)}
              onOpen={setOpenLead}
            />
          )}

          <Recordings recordings={s.recordings} leads={s.leads} />

          <div className="h-[380px]">
            <Inspector wire={s.wire} onClear={s.clearWire} />
          </div>
        </div>

        {/* ---------------- right rail ---------------- */}
        <div className="flex flex-col gap-5 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto lg:pr-1">
          <div className="z-30 rounded-2xl bg-[var(--bg)] lg:sticky lg:top-0">
            <Softphone
              phone={s.phone}
              rep={s.rep}
              config={s.config}
              elapsed={s.elapsed}
              muted={s.muted}
              onRegister={s.register}
              onUnregister={s.unregister}
              onHangup={s.hangup}
              onToggleMute={s.toggleMute}
              onDisposition={s.submitDisposition}
              onSkip={s.skipDisposition}
            />
          </div>

          <Section title="Recent calls">
            <div className="max-h-[300px] overflow-y-auto">
              {s.calls.length === 0 ? (
                <p className="px-4 py-6 text-center text-[12px] text-[var(--muted)]">
                  No calls logged yet.
                </p>
              ) : (
                <ul>
                  {s.calls.slice(0, 20).map((c) => {
                    const lead = s.leads.find((l) => l.id === c.leadId);
                    const other = c.direction === 'outbound' ? c.to : c.from.replace(/^sip:/, '');
                    return (
                      <li
                        key={c.id}
                        className="border-b border-[var(--line)]/60 px-4 py-2.5 text-[12px] last:border-0"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate font-semibold">
                            {c.direction === 'outbound' ? '↗' : '↘'} {lead?.name ?? other}
                          </span>
                          <span className="mono shrink-0 text-[var(--muted)]">
                            {fmtDuration(c.durationSec)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-[11px] text-[var(--muted)]">
                          <span className="capitalize">
                            {c.disposition
                              ? c.disposition.replace('_', ' ')
                              : c.status.replace('-', ' ')}
                          </span>
                          <span>
                            {c.recordingUrl && <span title="Recorded">🎙 </span>}
                            {fmtTime(c.startedAt)}
                          </span>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </Section>

          <Section title="Integration config">
            <dl className="space-y-2.5 px-4 py-3 text-[11px]">
              <Row k="Mode" v={s.config?.mode ?? '…'} />
              <Row k="Your number" v={s.config?.phoneNumber ?? '…'} />
              <Row k="Answer URL" v={s.config?.answerUrl ?? '…'} wrap />
              <Row k="Hangup URL" v={s.config?.hangupUrl ?? '…'} wrap />
              <Row k="Endpoint" v={s.rep ? `sip:${s.rep.endpoint}` : '…'} wrap />
              <Row k="Token TTL" v={`${s.config?.tokenTtlSec ?? '—'}s`} />
              <Row k="Recording" v={s.config?.recordCalls ? 'on' : 'off'} />
            </dl>
          </Section>
        </div>
      </div>

      {s.phone.kind === 'ringing-in' && (
        <IncomingCall
          lead={s.phone.lead}
          from={s.phone.from}
          onAnswer={s.answerIncoming}
          onReject={s.hangup}
        />
      )}

      <Toasts toasts={s.toasts} onDismiss={s.dismissToast} />

      {openLead && (
        <LeadDrawer
          lead={s.leads.find((l) => l.id === openLead.id) ?? openLead}
          owner={s.reps.find((r) => r.id === openLead.ownerId) ?? null}
          activities={s.activities.filter((a) => a.leadId === openLead.id)}
          calls={s.calls.filter((c) => c.leadId === openLead.id)}
          canCall={s.phone.kind === 'ready'}
          onCall={(lead) => {
            setOpenLead(null);
            s.callLead(lead, outcome);
          }}
          onClose={() => setOpenLead(null)}
        />
      )}
    </main>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="panel px-4 py-3">
      <div className="text-[10px] tracking-wide text-[var(--muted)] uppercase">{label}</div>
      <div
        className="mono text-xl font-bold tabular-nums"
        style={accent ? { color: 'var(--good)' } : undefined}
      >
        {value}
      </div>
    </div>
  );
}

function Row({ k, v, wrap }: { k: string; v: string; wrap?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="shrink-0 text-[var(--muted)]">{k}</dt>
      <dd className={`mono text-right ${wrap ? 'break-all' : ''}`}>{v}</dd>
    </div>
  );
}
