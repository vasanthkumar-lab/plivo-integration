'use client';

import { useMemo, useRef, useState } from 'react';
import { API_BASE } from '@/lib/api';
import type {
  CallAnalysis,
  CallLog,
  Lead,
  Transcript as TranscriptData,
  TranscriptionLanguage,
} from '@/lib/types';
import { fmtDuration, fmtRelative } from './ui';
import { Transcript } from './Transcript';
import { AnalysisPanel } from './AnalysisPanel';
import { titleForOutcome } from '@/lib/callOutcome';

function counterparty(c: CallLog): string {
  return c.direction === 'outbound' ? c.to : c.from.replace(/^sip:/, '').split('@')[0];
}

const STATUS_TONE: Record<string, string> = {
  completed: 'var(--good)',
  canceled: 'var(--muted)',
  declined: 'var(--bad)',
  busy: 'var(--warn)',
  'no-answer': 'var(--warn)',
  failed: 'var(--bad)',
};

export function CallsView({
  calls,
  leads,
  repName,
  transcripts,
  transcribing,
  analyses,
  analysing,
  analysisEnabled,
  onOpenTranscript,
  onTranscribe,
  onOpenAnalysis,
  onAnalyse,
  languages,
  defaultLanguage,
  onDelete,
}: {
  calls: CallLog[];
  leads: Lead[];
  repName: string;
  transcripts: Record<string, TranscriptData>;
  transcribing: Record<string, boolean>;
  analyses: Record<string, CallAnalysis>;
  analysing: Record<string, boolean>;
  analysisEnabled: boolean;
  onOpenTranscript: (callUuid: string) => void;
  onTranscribe: (callUuid: string, force?: boolean, language?: string) => void;
  onOpenAnalysis: (callUuid: string) => void;
  onAnalyse: (callUuid: string, force?: boolean) => void;
  languages: TranscriptionLanguage[];
  defaultLanguage: string;
  onDelete: (callUuid: string) => Promise<boolean>;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [language, setLanguage] = useState(defaultLanguage);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return calls;
    return calls.filter((c) => {
      const lead = leads.find((l) => l.id === c.leadId);
      return (
        counterparty(c).toLowerCase().includes(q) ||
        (lead?.name ?? '').toLowerCase().includes(q) ||
        (lead?.company ?? '').toLowerCase().includes(q)
      );
    });
  }, [calls, leads, query]);

  const call = selected ? calls.find((c) => c.callUuid === selected) ?? null : null;
  const lead = call?.leadId ? leads.find((l) => l.id === call.leadId) ?? null : null;

  const open = (c: CallLog) => {
    setSelected(c.callUuid);
    setConfirmDelete(null);
    // Show the language this transcript was produced in, not a stale choice.
    const existing = transcripts[c.callUuid]?.language;
    setLanguage(existing || defaultLanguage);
    if (c.recordingUrl) {
      onOpenTranscript(c.callUuid);
      onOpenAnalysis(c.callUuid);
    }
  };

  /** Clicking a transcript timestamp moves the player to that moment. */
  const seek = (seconds: number) => {
    const el = audioRef.current;
    if (!el) return;
    el.currentTime = seconds;
    void el.play().catch(() => undefined);
  };

  return (
    <div className="grid h-full min-h-0 grid-cols-1 gap-4 lg:grid-cols-[360px_1fr]">
      {/* ------------------------------- list ------------------------------- */}
      <section className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-[var(--line)] bg-white">
        <header className="border-b border-[var(--line)] p-3">
          <div className="relative">
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
              placeholder="Search calls"
              className="w-full rounded-xl border border-[var(--line)] bg-[var(--panel-2)] py-2 pr-3 pl-9 text-[13px] outline-none placeholder:text-[var(--muted)] focus:border-[var(--accent)]"
            />
          </div>
        </header>

        {filtered.length === 0 ? (
          <p className="px-4 py-10 text-center text-[12.5px] text-[var(--muted)]">
            {calls.length === 0 ? 'No calls yet.' : `No calls match “${query}”.`}
          </p>
        ) : (
          <ul className="min-h-0 flex-1 overflow-y-auto">
            {filtered.map((c) => {
              const l = leads.find((x) => x.id === c.leadId);
              const active = c.callUuid === selected;
              return (
                <li key={c.id}>
                  <button
                    onClick={() => open(c)}
                    className={`flex w-full items-start gap-3 border-b border-[var(--line)]/60 px-4 py-3 text-left transition ${
                      active ? 'bg-[var(--panel-2)]' : 'hover:bg-[var(--panel-2)]/60'
                    }`}
                  >
                    <span
                      className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[12px]"
                      style={{
                        background: c.recordingUrl ? 'rgba(21,128,61,.1)' : 'var(--panel-2)',
                      }}
                      aria-hidden="true"
                    >
                      {c.direction === 'outbound' ? '↗' : '↘'}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13.5px] font-semibold">
                        {l?.name ?? counterparty(c)}
                      </span>
                      <span className="mono block truncate text-[11px] text-[var(--muted)]">
                        {fmtDuration(c.durationSec)} · {fmtRelative(c.startedAt)}
                      </span>
                      <span className="mt-1 flex flex-wrap items-center gap-1.5">
                        <span
                          className="text-[10.5px] font-semibold"
                          style={{ color: STATUS_TONE[c.status] ?? 'var(--muted)' }}
                        >
                          {titleForOutcome(c)}
                        </span>
                        {c.transcriptStatus === 'ready' && (
                          <span className="rounded-full bg-[var(--panel-2)] px-1.5 py-0.5 text-[9.5px] font-semibold text-[var(--muted)]">
                            transcript
                          </span>
                        )}
                        {c.analysisStatus === 'ready' && (
                          <span className="rounded-full bg-[var(--accent)]/10 px-1.5 py-0.5 text-[9.5px] font-semibold text-[var(--accent)]">
                            ✦ AI
                          </span>
                        )}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* ------------------------------ detail ------------------------------ */}
      <section className="min-h-0 overflow-y-auto">
        {!call ? (
          <EmptyState
            title="Select a call"
            body="Pick a call on the left. Recorded calls open with their transcript and AI verdict."
          />
        ) : !call.recordingUrl ? (
          <EmptyState
            title={titleForOutcome(call)}
            body={`This call produced no recording, so there is nothing to transcribe. ${
              call.durationSec === 0 ? 'It never connected.' : ''
            }`}
            meta={`${lead?.name ?? counterparty(call)} · ${fmtDuration(call.durationSec)} · ${fmtRelative(call.startedAt)}`}
          />
        ) : (
          <div className="flex flex-col gap-4">
            {/* header */}
            <div className="rounded-2xl border border-[var(--line)] bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="truncate text-[17px] font-bold tracking-tight">
                    {lead?.name ?? counterparty(call)}
                  </h2>
                  <p className="mt-0.5 text-[12.5px] text-[var(--muted)]">
                    {lead?.company ? `${lead.company} · ` : ''}
                    {fmtDuration(call.durationSec)} · {fmtRelative(call.startedAt)} ·{' '}
                    {titleForOutcome(call)}
                  </p>
                </div>

                {/* Deleting removes the audio from Plivo as well, so it asks first. */}
                {confirmDelete === call.callUuid ? (
                  <div className="flex shrink-0 items-center gap-1.5">
                    <span className="text-[11px] text-[var(--muted)]">Delete for good?</span>
                    <button
                      onClick={async () => {
                        setDeleting(true);
                        const ok = await onDelete(call.callUuid);
                        setDeleting(false);
                        setConfirmDelete(null);
                        if (ok) setSelected(null);
                      }}
                      disabled={deleting}
                      className="rounded-lg bg-[var(--bad)] px-2.5 py-1 text-[11px] font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
                    >
                      {deleting ? 'Deleting…' : 'Delete'}
                    </button>
                    <button
                      onClick={() => setConfirmDelete(null)}
                      className="rounded-lg border border-[var(--line)] px-2.5 py-1 text-[11px] font-semibold text-[var(--muted)] transition hover:text-[var(--text)]"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmDelete(call.callUuid)}
                    title="Delete this call, its transcript, its AI verdict and the recording"
                    className="shrink-0 rounded-lg border border-[var(--line)] px-2.5 py-1 text-[11px] font-semibold text-[var(--muted)] transition hover:border-[var(--bad)] hover:text-[var(--bad)]"
                  >
                    Delete
                  </button>
                )}
              </div>

              <audio
                ref={audioRef}
                controls
                preload="none"
                className="mt-3 w-full"
                src={`${API_BASE}/api/recordings/${encodeURIComponent(call.callUuid)}/audio`}
              >
                Your browser cannot play this audio.
              </audio>
            </div>

            <AnalysisPanel
              analysis={analyses[call.callUuid] ?? null}
              canAnalyse={call.transcriptStatus === 'ready'}
              enabled={analysisEnabled}
              busy={Boolean(analysing[call.callUuid])}
              onAnalyse={(force) => onAnalyse(call.callUuid, force)}
            />

            <Transcript
              transcript={transcripts[call.callUuid] ?? null}
              call={call}
              lead={lead}
              repName={repName}
              onSeek={seek}
              busy={Boolean(transcribing[call.callUuid])}
              languages={languages}
              language={language}
              onLanguageChange={setLanguage}
              // Always force when redoing: the point is to replace a transcript
              // that came out in the wrong language.
              onRetry={() =>
                onTranscribe(call.callUuid, call.transcriptStatus !== 'none', language)
              }
            />
          </div>
        )}
      </section>
    </div>
  );
}

/** The white-and-green resting state: nothing selected, or nothing recorded. */
function EmptyState({ title, body, meta }: { title: string; body: string; meta?: string }) {
  return (
    <div className="flex h-full min-h-[320px] items-center justify-center rounded-2xl border border-[var(--line)] bg-white px-6 py-12">
      <div className="max-w-sm text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--accent)]/10 text-2xl text-[var(--accent)]">
          ✦
        </div>
        <h3 className="text-[15px] font-bold">{title}</h3>
        {meta && <p className="mono mt-1 text-[11px] text-[var(--muted)]">{meta}</p>}
        <p className="mt-2 text-[13px] leading-relaxed text-[var(--muted)]">{body}</p>
      </div>
    </div>
  );
}
