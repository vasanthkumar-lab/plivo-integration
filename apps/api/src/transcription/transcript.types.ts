/** Who is speaking. 'unknown' when the audio is mono and we cannot prove it. */
export type SpeakerRole = 'rep' | 'customer' | 'unknown';

export interface TranscriptSegment {

  start: number;
  end: number;
  speaker: number;
  role: SpeakerRole;
  text: string;
  /** Deepgram's own 0-1 confidence for this utterance. */
  confidence: number;
}

export type TranscriptStatus = 'none' | 'pending' | 'ready' | 'failed';

export interface Transcript {
  callUuid: string;
  status: TranscriptStatus;
  provider: 'deepgram';
  model: string;
  language: string;
  /** Audio channels Deepgram found: 2 means speakers are proven, not guessed. */
  channels: number;
  /** True when roles come from the channel split rather than diarization. */
  rolesAreReliable: boolean;
  durationSec: number;
  /** The whole conversation as one block, for search and for an LLM. */
  text: string;
  segments: TranscriptSegment[];
  createdAt: string;
  error: string | null;
}
