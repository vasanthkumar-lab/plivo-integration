'use client';

import { useMemo, useState } from 'react';
import type {
  CallLog,
  Lead,
  Transcript as TranscriptData,
  TranscriptionLanguage,
} from '@/lib/types';
import { fmtDuration } from './ui';

/** Stable colours per speaker, so the eye can follow a thread down the page. */
const SPEAKER_COLORS = ['#15803d', '#0369a1', '#b45309', '#7c3aed'];

function speakerName(
  seg: { role: string; speaker: number },
  call: CallLog,
  lead: Lead | null,
  repName: string,
): string {
  if (seg.role === 'rep') return repName;
  if (seg.role === 'customer') return lead?.name ?? (call.direction === 'outbound' ? call.to : call.from);
  // Mono audio: Deepgram separated the voices but cannot say whose is whose.
  return `Speaker ${seg.speaker + 1}`;
}

function initials(name: string): string {
  const parts = name.replace(/^\+/, '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '??';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export function Transcript({
  transcript,
  call,
  lead,
  repName,
  onSeek,
  onRetry,
  busy,
  languages,
  language,
  onLanguageChange,
}: {
  transcript: TranscriptData | null;
  call: CallLog;
  lead: Lead | null;
  repName: string;
  onSeek: (seconds: number) => void;
  /** Re-runs transcription in the currently selected language. */
  onRetry: () => void;
  busy: boolean;
  /** Omitted by callers that do not offer a language choice. */
  languages?: TranscriptionLanguage[];
  language?: string;
  onLanguageChange?: (code: string) => void;
}) {
  const [query, setQuery] = useState('');

  /**
   * Picking the language matters more than it sounds: a Tamil call
   * transcribed as English comes back as a couple of "Hello?"s and looks like
   * a silent recording.
   */
  const picker = (languages?.length ?? 0) > 1 && (
    <label className="flex items-center gap-1.5 text-[10.5px] text-[var(--muted)]">
      <span className="sr-only">Transcription language</span>
      <select
        value={language ?? languages?.[0]?.code ?? "en"}
        onChange={(e) => onLanguageChange?.(e.target.value)}
        className="cursor-pointer rounded-lg border border-[var(--line)] bg-[var(--panel-2)] px-2 py-1 text-[11px] font-semibold outline-none focus:border-[var(--accent)]"
      >
        {(languages ?? []).map((l) => (
          <option key={l.code} value={l.code}>
            {l.label}
          </option>
        ))}
      </select>
    </label>
  );

  const segments = useMemo(() => {
    const all = transcript?.segments ?? [];
    const q = query.trim().toLowerCase();
    return q ? all.filter((s) => s.text.toLowerCase().includes(q)) : all;
  }, [transcript, query]);

  const status = transcript?.status ?? call.transcriptStatus ?? 'none';

  if (status === 'pending') {
    return (
      <div className="flex items-center gap-2 rounded-xl bg-[var(--panel-2)] px-3 py-3 text-[12px] text-[var(--muted)]">
        <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-[var(--line)] border-t-[var(--accent)]" />
        Transcribing this call with Deepgram…
      </div>
    );
  }

  if (status === 'failed') {
    return (
      <div className="rounded-xl border border-[var(--bad)]/35 bg-[rgba(185,28,28,.06)] px-3 py-3">
        <div className="text-[12px] font-semibold text-[var(--bad)]">Transcription failed</div>
        {transcript?.error && (
          <div className="mono mt-1 text-[10px] break-words text-[var(--muted)]">
            {transcript.error}
          </div>
        )}
        <div className="mt-2 flex items-center gap-2">
          {picker}
          <button
            onClick={onRetry}
            disabled={busy}
            className="rounded-lg border border-[var(--line)] px-3 py-1.5 text-[11px] font-semibold transition hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-50"
          >
            {busy ? 'Retrying…' : 'Try again'}
          </button>
        </div>
      </div>
    );
  }

  if (status === 'none' || !transcript || transcript.segments.length === 0) {
    const noSpeech = transcript && transcript.status === 'ready' && !transcript.segments.length;
    return (
      <div className="rounded-xl bg-[var(--panel-2)] px-3 py-3">
        <div className="text-[12px] text-[var(--muted)]">
          {noSpeech ? 'No speech was detected in this recording.' : 'This call has not been transcribed yet.'}
        </div>
        <div className="mt-2 flex items-center gap-2">
          {picker}
          <button
            onClick={onRetry}
            disabled={busy}
            className="rounded-lg border border-[var(--line)] px-3 py-1.5 text-[11px] font-semibold transition hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-50"
          >
            {busy ? 'Transcribing…' : 'Transcribe now'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-[var(--line)]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--line)] px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold tracking-wide text-[var(--muted)] uppercase">
            Transcript
          </span>
          <span className="mono text-[10px] text-[var(--muted)]">
            {transcript.segments.length}
          </span>
          {!transcript.rolesAreReliable && (
            <span
              title="This recording is mono, so Deepgram separated the voices but cannot tell which is the rep."
              className="rounded-full bg-[var(--panel-2)] px-2 py-0.5 text-[10px] text-[var(--muted)]"
            >
              speakers inferred
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {picker}
          <button
            onClick={onRetry}
            disabled={busy}
            title="Transcribe again in the selected language"
            className="rounded-lg border border-[var(--line)] px-2 py-1 text-[11px] font-semibold text-[var(--muted)] transition hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-50"
          >
            {busy ? '…' : 'Redo'}
          </button>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search transcript…"
            className="w-36 rounded-lg border border-[var(--line)] bg-[var(--panel-2)] px-2.5 py-1 text-[11px] outline-none placeholder:text-[var(--muted)] focus:border-[var(--accent)]"
          />
        </div>
      </div>

      {segments.length === 0 ? (
        <p className="px-3 py-4 text-center text-[11px] text-[var(--muted)]">
          No lines match “{query}”.
        </p>
      ) : (
        <ul className="max-h-[320px] overflow-y-auto px-3 py-2">
          {segments.map((seg, i) => {
            const name = speakerName(seg, call, lead, repName);
            const color = SPEAKER_COLORS[seg.speaker % SPEAKER_COLORS.length];
            return (
              <li key={`${seg.start}-${i}`} className="flex gap-2.5 py-1.5">
                <button
                  onClick={() => onSeek(seg.start)}
                  title="Jump to this moment"
                  className="mono shrink-0 pt-0.5 text-[10px] text-[var(--muted)] transition hover:text-[var(--accent)]"
                >
                  {fmtDuration(Math.floor(seg.start))}
                </button>
                <span
                  className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white"
                  style={{ background: color }}
                >
                  {initials(name)}
                </span>
                <div className="min-w-0">
                  <div className="text-[11px] font-semibold" style={{ color }}>
                    {name}
                  </div>
                  <p className="text-[12px] leading-relaxed break-words">{seg.text}</p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
