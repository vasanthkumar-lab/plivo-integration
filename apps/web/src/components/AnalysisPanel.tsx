'use client';

import type { CallAnalysis, CallOutcomeVerdict } from '@/lib/types';

const VERDICT: Record<
  CallOutcomeVerdict,
  { label: string; bg: string; fg: string; ring: string }
> = {
  converted: { label: 'Converted', bg: '#dcfce7', fg: '#166534', ring: '#86efac' },
  promising: { label: 'Promising', bg: '#e0f2f1', fg: '#0f766e', ring: '#5eead4' },
  follow_up: { label: 'Follow-up needed', bg: '#fef3c7', fg: '#b45309', ring: '#fcd34d' },
  not_interested: { label: 'Not interested', bg: '#fee2e2', fg: '#b91c1c', ring: '#fca5a5' },
  unclear: { label: 'Unclear', bg: '#eef2f0', fg: '#475a51', ring: '#cbd5d0' },
};

function List({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div>
      <div className="mb-1.5 text-[10px] font-semibold tracking-wide text-[var(--muted)] uppercase">
        {title}
      </div>
      <ul className="flex flex-col gap-1.5">
        {items.map((item, i) => (
          <li key={i} className="flex gap-2 text-[12.5px] leading-relaxed">
            <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-[var(--muted)]" />
            <span className="min-w-0">{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function AnalysisPanel({
  analysis,
  canAnalyse,
  enabled,
  busy,
  onAnalyse,
}: {
  analysis: CallAnalysis | null;
  /** False until the call has a transcript to read. */
  canAnalyse: boolean;
  /** False when GEMINI_API_KEY is missing on the server. */
  enabled: boolean;
  busy: boolean;
  onAnalyse: (force: boolean) => void;
}) {
  const status = analysis?.status ?? 'none';

  const shell = (children: React.ReactNode) => (
    <section className="rounded-2xl border border-[var(--line)] bg-white p-4">
      <div className="mb-3 flex items-center gap-2">
        <span className="flex h-5 w-5 items-center justify-center rounded-md bg-[var(--accent)]/10 text-[11px]">
          ✦
        </span>
        <h3 className="text-[11px] font-semibold tracking-wide text-[var(--muted)] uppercase">
          AI analysis
        </h3>
      </div>
      {children}
    </section>
  );

  if (!enabled) {
    return shell(
      <p className="text-[12.5px] text-[var(--muted)]">
        Set <code className="mono text-[11px]">GEMINI_API_KEY</code> on the server to have each
        conversation read and scored automatically.
      </p>,
    );
  }

  if (status === 'pending' || busy) {
    return shell(
      <div className="flex items-center gap-2 text-[12.5px] text-[var(--muted)]">
        <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-[var(--line)] border-t-[var(--accent)]" />
        Reading the conversation…
      </div>,
    );
  }

  if (status === 'failed') {
    return shell(
      <div>
        <div className="text-[12.5px] font-semibold text-[var(--bad)]">Analysis failed</div>
        {analysis?.error && (
          <p className="mono mt-1 text-[10.5px] break-words text-[var(--muted)]">{analysis.error}</p>
        )}
        <button
          onClick={() => onAnalyse(true)}
          className="mt-2.5 rounded-lg border border-[var(--line)] px-3 py-1.5 text-[11.5px] font-semibold transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
        >
          Try again
        </button>
      </div>,
    );
  }

  if (status === 'none' || !analysis?.outcome) {
    return shell(
      <div>
        <p className="text-[12.5px] text-[var(--muted)]">
          {canAnalyse
            ? 'This call has not been analysed yet.'
            : analysis?.error ?? 'Transcribe this call first, then it can be analysed.'}
        </p>
        {canAnalyse && (
          <button
            onClick={() => onAnalyse(false)}
            className="mt-2.5 rounded-lg bg-[var(--accent)] px-3 py-1.5 text-[11.5px] font-semibold text-white transition hover:brightness-110"
          >
            Analyse this call
          </button>
        )}
      </div>,
    );
  }

  const v = VERDICT[analysis.outcome] ?? VERDICT.unclear;
  const pct = Math.round((analysis.confidence ?? 0) * 100);

  return shell(
    <div className="flex flex-col gap-3.5">
      {/* the headline answer */}
      <div className="flex flex-wrap items-center gap-2">
        <span
          className="rounded-full px-3 py-1 text-[12px] font-bold"
          style={{ background: v.bg, color: v.fg, boxShadow: `inset 0 0 0 1px ${v.ring}` }}
        >
          {v.label}
        </span>
        <span className="text-[11.5px] text-[var(--muted)]">{pct}% confident</span>
        {analysis.sentiment && (
          <span className="rounded-full bg-[var(--panel-2)] px-2.5 py-1 text-[10.5px] font-semibold text-[var(--muted)] capitalize">
            {analysis.sentiment}
          </span>
        )}
      </div>

      {/* confidence bar: a low number should look low */}
      <div
        className="h-1 w-full overflow-hidden rounded-full bg-[var(--panel-2)]"
        role="img"
        aria-label={`Confidence ${pct} percent`}
      >
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: v.fg }} />
      </div>

      {analysis.summary && (
        <p className="text-[13px] leading-relaxed">{analysis.summary}</p>
      )}

      <List title="Signals" items={analysis.signals} />
      <List title="Objections" items={analysis.objections} />
      <List title="Next steps" items={analysis.nextSteps} />

      <div className="flex items-center justify-between border-t border-[var(--line)] pt-2.5">
        <span className="mono text-[10px] text-[var(--muted)]">{analysis.model}</span>
        <button
          onClick={() => onAnalyse(true)}
          className="text-[11px] font-semibold text-[var(--muted)] transition hover:text-[var(--accent)]"
        >
          Re-analyse
        </button>
      </div>
    </div>,
  );
}
