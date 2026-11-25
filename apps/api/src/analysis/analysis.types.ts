/** How the call ended up, from the model's reading of the conversation. */
export type CallOutcomeVerdict =
  | 'converted'
  | 'promising'
  | 'follow_up'
  | 'not_interested'
  | 'unclear';

export type AnalysisStatus = 'none' | 'pending' | 'ready' | 'failed';

export interface CallAnalysis {
  callUuid: string;
  status: AnalysisStatus;
  provider: 'gemini';
  model: string;
  outcome: CallOutcomeVerdict | null;
  /** The headline answer: did this lead convert? */
  converted: boolean;
  /** 0-1, the model's own certainty. */
  confidence: number;
  summary: string;
  /** Quotes and moments that justify the verdict, so a rep can check its work. */
  signals: string[];
  objections: string[];
  nextSteps: string[];
  sentiment: 'positive' | 'neutral' | 'negative' | null;
  createdAt: string | null;
  error: string | null;
}


export function emptyAnalysis(callUuid: string, model: string, error?: string): CallAnalysis {
  return {
    callUuid,
    status: 'none',
    provider: 'gemini',
    model,
    outcome: null,
    converted: false,
    confidence: 0,
    summary: '',
    signals: [],
    objections: [],
    nextSteps: [],
    sentiment: null,
    createdAt: null,
    error: error ?? null,
  };
}
