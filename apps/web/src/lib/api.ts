import type { Activity, CallLog, Disposition, Lead, PlivoRuntimeConfig, Rep, WireEntry } from './types';

/**
 * Where the browser sends API calls.
 *
 * Set NEXT_PUBLIC_API_URL to an empty string to use relative paths. The browser
 * then calls the Next.js origin and next.config.mjs rewrites /api and /plivo to
 * the backend server-side. That is what makes the app work behind a public
 * tunnel: a remote visitor has no "localhost:4000" to reach.
 */
export const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`${init?.method || 'GET'} ${path} failed: ${res.status}`);
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

export interface Bootstrap {
  reps: Rep[];
  leads: Lead[];
  calls: CallLog[];
  activities: Activity[];
  currentRepId: string;
}

export const api = {
  bootstrap: (repId?: string) => req<Bootstrap>(`/api/bootstrap${repId ? `?repId=${repId}` : ''}`),
  plivoConfig: () => req<PlivoRuntimeConfig>('/api/plivo/config'),
  token: (repId: string) =>
    req<{ token: string; endpoint: string; expiresIn: number; simulated: boolean }>(
      `/api/plivo/token?repId=${encodeURIComponent(repId)}`,
    ),
  calls: () => req<CallLog[]>('/api/calls'),
  recordings: () => req<CallLog[]>('/api/recordings'),
  activities: (leadId?: string) =>
    req<Activity[]>(`/api/activities${leadId ? `?leadId=${encodeURIComponent(leadId)}` : ''}`),
  leads: () => req<Lead[]>('/api/leads'),
  createLead: (lead: { name?: string; company?: string; phone: string; email?: string; value?: number }) =>
    req<Lead>('/api/leads', { method: 'POST', body: JSON.stringify(lead) }),
  wireLog: () => req<WireEntry[]>('/api/events/wire'),

  /** Push a browser-side SDK event into the Inspector. Never throws. */
  clientEvent: (label: string, detail?: string, body?: any) =>
    fetch(`${API_BASE}/api/events/client`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label, detail, body }),
    }).catch(() => undefined),

  clearWire: () => req<{ ok: boolean }>('/api/events/wire', { method: 'DELETE' }),

  setDisposition: (callUuid: string, disposition: Disposition, notes?: string) =>
    req<CallLog>(`/api/calls/${callUuid}/disposition`, {
      method: 'POST',
      body: JSON.stringify({ disposition, notes }),
    }),

  setPresence: (repId: string, online: boolean) =>
    req<Rep>(`/api/reps/${repId}/presence`, { method: 'PATCH', body: JSON.stringify({ online }) }),

  // --- simulator ---
  simOutbound: (
    repId: string,
    target: { leadId?: string; to?: string },
    outcome: 'answer' | 'no-answer' | 'busy' = 'answer',
  ) =>
    req<{ callUuid: string; xml: string }>('/api/sim/outbound', {
      method: 'POST',
      body: JSON.stringify({ repId, ...target, outcome }),
    }),
  simInbound: (from: { leadId?: string; from?: string }) =>
    req<{ callUuid: string; xml: string; decision: string }>('/api/sim/inbound', {
      method: 'POST',
      body: JSON.stringify(from),
    }),
  simAnswerIncoming: (callUuid: string) =>
    req<{ ok: boolean }>('/api/sim/answer-incoming', { method: 'POST', body: JSON.stringify({ callUuid }) }),
  simHangup: (callUuid: string, durationSec: number, status = 'completed') =>
    req<{ ok: boolean; call: CallLog }>('/api/sim/hangup', {
      method: 'POST',
      body: JSON.stringify({ callUuid, durationSec, status }),
    }),
};
