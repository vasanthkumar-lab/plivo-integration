export type LeadStage = 'new' | 'contacted' | 'qualified' | 'negotiation' | 'won' | 'lost';
export type Disposition = 'interested' | 'callback' | 'not_interested' | 'no_answer';

export interface Rep {
  id: string;
  name: string;
  /** Plivo endpoint username, e.g. "repravi" -> sip:repravi@phone.plivo.com */
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
