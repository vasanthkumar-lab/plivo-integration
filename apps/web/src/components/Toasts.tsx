'use client';

import { useEffect } from 'react';

export type ToastKind = 'info' | 'success' | 'warn' | 'error';

export interface Toast {
  id: string;
  kind: ToastKind;
  title: string;
  body?: string;
}

const STYLE: Record<ToastKind, { accent: string; icon: string }> = {
  info: { accent: 'var(--accent-2)', icon: 'ℹ' },
  success: { accent: 'var(--good)', icon: '✓' },
  warn: { accent: 'var(--warn)', icon: '!' },
  error: { accent: 'var(--bad)', icon: '✕' },
};

function ToastRow({ toast, onDismiss }: { toast: Toast; onDismiss: (id: string) => void }) {
  const style = STYLE[toast.kind];

  useEffect(() => {
    const ms = toast.kind === 'error' ? 8000 : 4500;
    const id = setTimeout(() => onDismiss(toast.id), ms);
    return () => clearTimeout(id);
  }, [toast.id, toast.kind, onDismiss]);

  return (
    <div
      role="status"
      className="slide-up panel flex w-[min(92vw,340px)] items-start gap-3 px-3.5 py-3 shadow-lg"
      style={{ borderLeft: `3px solid ${style.accent}` }}
    >
      <span
        className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold"
        style={{ background: `color-mix(in oklab, ${style.accent} 20%, transparent)`, color: style.accent }}
      >
        {style.icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-semibold">{toast.title}</div>
        {toast.body && <div className="text-[12px] text-[var(--muted)]">{toast.body}</div>}
      </div>
      <button
        onClick={() => onDismiss(toast.id)}
        aria-label="Dismiss notification"
        className="shrink-0 text-[var(--muted)] transition hover:text-[var(--text)]"
      >
        ×
      </button>
    </div>
  );
}

export function Toasts({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: string) => void }) {
  if (!toasts.length) return null;

  return (
    <div
      className="pointer-events-none fixed right-0 bottom-0 z-[60] flex flex-col-reverse items-end gap-2 p-4"
      style={{
        paddingRight: 'max(16px, env(safe-area-inset-right, 0px))',
        paddingBottom: 'max(16px, env(safe-area-inset-bottom, 0px))',
      }}
    >
      {toasts.map((t) => (
        <div key={t.id} className="pointer-events-auto">
          <ToastRow toast={t} onDismiss={onDismiss} />
        </div>
      ))}
    </div>
  );
}
