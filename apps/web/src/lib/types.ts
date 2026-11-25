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
  /** Where this call's Deepgram transcript has got to. */
  transcriptStatus: 'none' | 'pending' | 'ready' | 'failed';
  /** Where Gemini's verdict on the conversation has got to. */
  analysisStatus: 'none' | 'pending' | 'ready' | 'failed';
}

export type SpeakerRole = 'rep' | 'customer' | 'unknown';

export interface TranscriptSegment {
  start: number;
  end: number;
  speaker: number;
  role: SpeakerRole;
  text: string;
  confidence: number;
}

export interface Transcript {
  callUuid: string;
  status: 'none' | 'pending' | 'ready' | 'failed';
  provider: 'deepgram';
  model: string;
  language: string;
  channels: number;
  /** False when the audio was mono and speakers came from voice diarization. */
  rolesAreReliable: boolean;
  durationSec: number;
  text: string;
  segments: TranscriptSegment[];
  createdAt: string | null;
  error: string | null;
}

export interface TranscriptionLanguage {
  code: string;
  label: string;
}

export interface TranscriptionConfig {
  enabled: boolean;
  model: string;
  language: string;
  languages: TranscriptionLanguage[];
  autoTranscribe: boolean;
  keyMasked: string | null;
  blockers: string[];
}

export type CallOutcomeVerdict =
  | 'converted'
  | 'promising'
  | 'follow_up'
  | 'not_interested'
  | 'unclear';

export interface CallAnalysis {
  callUuid: string;
  status: 'none' | 'pending' | 'ready' | 'failed';
  provider: 'gemini';
  model: string;
  outcome: CallOutcomeVerdict | null;
  converted: boolean;
  /** 0-1, the model's own certainty. */
  confidence: number;
  summary: string;
  signals: string[];
  objections: string[];
  nextSteps: string[];
  sentiment: 'positive' | 'neutral' | 'negative' | null;
  createdAt: string | null;
  error: string | null;
}

export interface AnalysisConfig {
  enabled: boolean;
  model: string;
  autoAnalyse: boolean;
  keyMasked: string | null;
  blockers: string[];
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
