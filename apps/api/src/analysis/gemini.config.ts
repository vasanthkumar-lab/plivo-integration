import { Injectable, Logger } from '@nestjs/common';

/**
 * Gemini credentials and model choice.
 *
 * Mirrors PlivoConfig and DeepgramConfig: the key stays on the server, and the
 * feature degrades to a readable blocker rather than throwing when it is absent.
 */
@Injectable()
export class GeminiConfig {
  private readonly log = new Logger('GeminiConfig');

  readonly apiKey = (process.env.GEMINI_API_KEY || '').trim();

  /**
   * Verified responsive from here. The flagship aliases (gemini-3.8-flash,
   * gemini-3.5-flash, gemini-flash-latest) currently accept the connection and
   * then never answer, so they are a poor default however new they are.
   * Override with GEMINI_MODEL once they settle.
   */
  readonly model = (process.env.GEMINI_MODEL || 'gemini-3-flash-preview').trim();

  /** Analyse automatically as soon as a transcript is ready. */
  readonly autoAnalyse = (process.env.GEMINI_AUTO || 'true').trim() !== 'false';

  /**
   * Gemini thinks before answering, which costs tokens and latency.
   * Classifying a short sales call does not need it, so it is off by default;
   * raise this for genuinely hard judgement calls.
   */
  readonly thinkingBudget = Number(process.env.GEMINI_THINKING_BUDGET || 0);

  /** Fail fast and retry rather than hanging: a stuck model answers never, not late. */
  readonly timeoutMs = Number(process.env.GEMINI_TIMEOUT_MS || 45_000);

  get enabled(): boolean {
    return Boolean(this.apiKey);
  }

  get blockers(): string[] {
    return this.enabled ? [] : ['GEMINI_API_KEY is not set - call analysis is disabled'];
  }

  describe() {
    return {
      enabled: this.enabled,
      model: this.model,
      autoAnalyse: this.autoAnalyse,
      thinkingBudget: this.thinkingBudget,
      timeoutMs: this.timeoutMs,
      keyMasked: this.apiKey ? `${this.apiKey.slice(0, 4)}...${this.apiKey.slice(-4)}` : null,
      blockers: this.blockers,
    };
  }

  report() {
    if (!this.enabled) {
      this.log.warn('No GEMINI_API_KEY - transcripts will not be analysed.');
      return;
    }
    this.log.log(`Call analysis ready - model ${this.model}`);
  }
}
