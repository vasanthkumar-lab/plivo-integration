export type LeadStage = 'new' | 'contacted' | 'qualified' | 'negotiation' | 'won' | 'lost';
export type Disposition = 'interested' | 'callback' | 'not_interested' | 'no_answer';

export interface Rep {
  id: string;
  name: string;
  endpoint: string;
  avatarColor: string;
  online: boolean;
}

export interface Lead {
  id: string;
  name: string;
  company: string;
  phone: string;
  email: string;
  stage: LeadStage;
  value: number;
  ownerId: string;
  lastContactedAt: string | null;
}

/** Who put the phone down. Plivo reports this on the dial + hangup webhooks. */
export type EndedBy = 'rep' | 'customer' | 'system';

export interface CallLog {
  id: string;
  callUuid: string;
  leadId: string | null;
  repId: string | null;
  direction: 'outbound' | 'inbound';
  from: string;
  to: string;
  status:
    | 'ringing'
    | 'in-progress'
    | 'completed'
    | 'canceled'
    | 'declined'
    | 'no-answer'
    | 'busy'
    | 'failed';
  startedAt: string;
  endedAt: string | null;
  durationSec: number;
  recordingUrl: string | null;
  disposition: Disposition | null;
  notes: string | null;
  /** Null until the call ends and Plivo tells us who ended it. */
  endedBy: EndedBy | null;
  /** Plivo's own words, e.g. "Normal Hangup" / "ORIGINATOR_CANCEL". Kept for the Inspector. */
  endReason: string | null;
}

export interface Activity {
  id: string;
  leadId: string;
  type: 'call' | 'note' | 'stage' | 'system';
  title: string;
  body?: string;
  at: string;
  meta?: Record<string, unknown>;
}

export interface WireEntry {
  id: string;
  at: string;
  actor: 'browser' | 'plivo' | 'backend' | 'carrier';
  label: string;
  kind: 'http' | 'xml' | 'sdk' | 'note';
  detail?: string;
  body?: Record<string, unknown> | string;
}

/** Whether Plivo can actually reach PUBLIC_BASE_URL right now. */
export interface TunnelStatus {
  /** null until the backend has run its first probe. */
  ok: boolean | null;
  checkedAt: string | null;
  detail: string | null;
}

export interface PlivoRuntimeConfig {
  mode: 'live' | 'simulator';
  live: boolean;
  phoneNumber: string;
  answerUrl: string;
  hangupUrl: string;
  recordCalls: boolean;
  tokenTtlSec: number;
  authIdMasked: string | null;
  publiclyReachable: boolean;
  blockers: string[];
  tunnel: TunnelStatus;
}

/** What the softphone is doing right now. */
export type PhoneState =
  | { kind: 'offline' }
  | { kind: 'registering' }
  | { kind: 'ready' }
  | { kind: 'dialing'; lead: Lead; callUuid: string }
  | { kind: 'ringing-in'; lead: Lead | null; from: string; callUuid: string }
  | { kind: 'in-call'; lead: Lead | null; callUuid: string; startedAt: number; direction: 'outbound' | 'inbound' }
  | {
      kind: 'wrap-up';
      lead: Lead | null;
      callUuid: string;
      durationSec: number;
      /** Headline + sentence describing how the call actually ended. */
      title?: string;
      summary?: string;
    };
