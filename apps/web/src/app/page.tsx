'use client';

import { useMemo, useState } from 'react';
import { useSoftphone } from '@/lib/useSoftphone';
import { Sidebar, type View } from '@/components/Sidebar';
import { OverviewView } from '@/components/OverviewView';
import { LeadsView } from '@/components/LeadsView';
import { CallsView } from '@/components/CallsView';
import { Dialer } from '@/components/Dialer';
import { Softphone } from '@/components/Softphone';
import { IncomingCall } from '@/components/IncomingCall';
import { LeadDrawer } from '@/components/LeadDrawer';
import { Toasts } from '@/components/Toasts';
import { AddLead } from '@/components/AddLead';
import type { Lead } from '@/lib/types';

const TITLES: Record<View, { title: string; subtitle: string }> = {
  overview: { title: 'Overview', subtitle: 'Your calling activity at a glance' },
  leads: { title: 'Leads', subtitle: 'Everyone you have called, and everyone who called you' },
  calls: { title: 'Calls', subtitle: 'Recordings, transcripts and AI verdicts' },
};

export default function Page() {
  const s = useSoftphone();
  const [view, setView] = useState<View>('overview');
  const [openLead, setOpenLead] = useState<Lead | null>(null);

  const inCall = ['dialing', 'in-call', 'ringing-in', 'wrap-up'].includes(s.phone.kind);
  const canCall = s.phone.kind === 'ready';
  const myLeads = useMemo(() => s.leads.filter((l) => l.ownerId === s.repId), [s.leads, s.repId]);

  const blockers = s.config?.live ? (s.config.blockers ?? []) : [];
  const liveLead = openLead ? (s.leads.find((l) => l.id === openLead.id) ?? openLead) : null;

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar
        view={view}
        onView={setView}
        rep={s.rep}
        reps={s.reps}
        onRepChange={s.setRepId}
        counts={{ leads: s.leads.length, calls: s.calls.length }}
        disabled={inCall}
      />

      {/* ------------------------------ main ------------------------------ */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-[var(--line)] bg-white px-6 py-4">
          <div>
            <h1 className="text-[20px] font-bold tracking-tight">{TITLES[view].title}</h1>
            <p className="mt-0.5 text-[12.5px] text-[var(--muted)]">{TITLES[view].subtitle}</p>
          </div>
          <span
            className="mt-1 flex shrink-0 items-center gap-1.5 rounded-full border border-[var(--line)] px-3 py-1.5 text-[11px] font-semibold"
            title={s.config?.live ? 'Real Plivo calls' : 'Simulator mode'}
          >
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: s.config?.live ? 'var(--good)' : 'var(--warn)' }}
            />
            {s.config?.live ? 'Live' : 'Simulator'}
          </span>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {/* Anything that will make calls fail belongs above the fold. */}
          {blockers.length > 0 && (
            <div className="mb-4 rounded-xl border border-[var(--warn)]/35 bg-[rgba(180,83,9,.07)] px-4 py-3 text-[13px] text-[var(--warn)]">
              <div className="mb-1 font-semibold">Live mode is on, but calls will fail:</div>
              <ul className="list-inside list-disc space-y-0.5 text-[12px]">
                {blockers.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            </div>
          )}

          {view === 'overview' && (
            <OverviewView
              calls={s.calls}
              leads={s.leads}
              activities={s.activities}
              analyses={s.analyses}
              onOpenCalls={() => setView('calls')}
            />
          )}

          {view === 'leads' && (
            <LeadsView
              leads={myLeads.length ? myLeads : s.leads}
              reps={s.reps}
              phone={s.phone}
              onCall={(lead) => s.callLead(lead)}
              onOpen={setOpenLead}
              addLead={
                <AddLead
                  onAdded={(n) => {
                    s.pushToast('success', 'Contact added', n);
                    s.refresh();
                  }}
                />
              }
            />
          )}

          {view === 'calls' && (
            <div className="h-[calc(100vh-170px)]">
              <CallsView
                calls={s.calls}
                leads={s.leads}
                repName={s.rep?.name ?? 'You'}
                transcripts={s.transcripts}
                transcribing={s.transcribing}
                analyses={s.analyses}
                analysing={s.analysing}
                analysisEnabled={Boolean(s.analysisConfig?.enabled)}
                onOpenTranscript={s.loadTranscript}
                onTranscribe={s.requestTranscript}
                onOpenAnalysis={s.loadAnalysis}
                onAnalyse={s.requestAnalysis}
                languages={s.transcription?.languages ?? []}
                defaultLanguage={s.transcription?.language ?? 'en'}
                onDelete={s.deleteCall}
              />
            </div>
          )}
        </main>
      </div>

      {/* --------------------------- right rail ---------------------------
          The softphone never unmounts: tearing it down would drop the live
          WebRTC session and the browser's Plivo registration with it. */}
      {/* min-h-0 is what actually lets this scroll: without it a flex item
          refuses to shrink below its content, so overflow-y-auto never
          engages and the end of the wrap-up form is unreachable. */}
      <aside className="hidden min-h-0 w-[320px] shrink-0 flex-col gap-4 overflow-y-auto border-l border-[var(--line)] bg-white px-4 py-5 lg:flex">
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
        <Dialer phone={s.phone} defaultNumber="" onCall={(n) => s.callNumber(n)} />
      </aside>

      {s.phone.kind === 'ringing-in' && (
        <IncomingCall
          lead={s.phone.lead}
          from={s.phone.from}
          onAnswer={s.answerIncoming}
          onReject={s.hangup}
        />
      )}

      {liveLead && (
        <LeadDrawer
          lead={liveLead}
          owner={s.reps.find((r) => r.id === liveLead.ownerId) ?? null}
          calls={s.calls.filter((c) => c.leadId === liveLead.id)}
          activities={s.activities.filter((a) => a.leadId === liveLead.id)}
          canCall={canCall}
          onClose={() => setOpenLead(null)}
          onCall={(lead) => {
            s.callLead(lead);
            setOpenLead(null);
          }}
        />
      )}

      <Toasts toasts={s.toasts} onDismiss={s.dismissToast} />
    </div>
  );
}
