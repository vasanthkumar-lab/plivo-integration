'use client';

import type { LeadStage } from '@/lib/types';

export function fmtDuration(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function fmtMoney(v: number) {
  if (v >= 100000) return `₹${(v / 100000).toFixed(1)}L`;
  return `₹${(v / 1000).toFixed(0)}k`;
}

export function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function fmtRelative(iso: string | null) {
  if (!iso) return 'never';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

const STAGE_STYLE: Record<LeadStage, { bg: string; fg: string; label: string }> = {
  new: { bg: '#eef2f0', fg: '#475a51', label: 'New' },
  contacted: { bg: '#e0f2f1', fg: '#0f766e', label: 'Contacted' },
  qualified: { bg: '#dcfce7', fg: '#15803d', label: 'Qualified' },
  negotiation: { bg: '#fef3c7', fg: '#b45309', label: 'Negotiation' },
  won: { bg: '#bbf7d0', fg: '#166534', label: 'Won' },
  lost: { bg: '#fee2e2', fg: '#b91c1c', label: 'Lost' },
};

export function StageChip({ stage }: { stage: LeadStage }) {
  const s = STAGE_STYLE[stage];
  return (
    <span
      className="rounded-full px-2.5 py-1 text-[11px] font-semibold tracking-wide"
      style={{ background: s.bg, color: s.fg }}
    >
      {s.label}
    </span>
  );
}

export function Avatar({ name, color, size = 34 }: { name: string; color: string; size?: number }) {
  const initials = name
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full font-bold text-white"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.38,
        background: `linear-gradient(135deg, ${color}, ${color}99)`,
      }}
    >
      {initials}
    </div>
  );
}

export function Dot({ color }: { color: string }) {
  return <span className="inline-block h-2 w-2 rounded-full" style={{ background: color }} />;
}

export function Section({
  title,
  action,
  children,
  className = '',
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel overflow-hidden ${className}`}>
      <header className="flex items-center justify-between border-b border-[var(--line)] px-4 py-3">
        <h2 className="text-[13px] font-semibold tracking-wide text-[var(--muted)] uppercase">{title}</h2>
        {action}
      </header>
      {children}
    </section>
  );
}
