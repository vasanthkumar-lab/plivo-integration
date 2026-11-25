import { Controller, Injectable, Logger } from '@nestjs/common';

/**
 * Deepgram credentials and model choice.
 *
 * Mirrors how PlivoConfig works: the key lives on the server, and the feature
 * degrades to a clear blocker rather than throwing when it is absent.
 */
@Injectable()
export class DeepgramConfig {
  private readonly log = new Logger('DeepgramConfig');

  readonly apiKey = (process.env.DEEPGRAM_API_KEY || '').trim();

  /** nova-3 is Deepgram's current best general model. */
  readonly model = (process.env.DEEPGRAM_MODEL || 'nova-3').trim();


  static readonly LANGUAGES = [
    { code: 'en', label: 'English' },
    { code: 'ta', label: 'Tamil' },
  ] as const;

  /** Default for automatic transcription. A per-call choice overrides it. */
  readonly language = DeepgramConfig.normalizeLanguage(process.env.DEEPGRAM_LANGUAGE);

  /** Anything unsupported falls back to English rather than failing the call. */
  static normalizeLanguage(value: unknown): string {
    const code = String(value ?? '')
      .trim()
      .toLowerCase();
    return DeepgramConfig.LANGUAGES.some((l) => l.code === code) ? code : 'en';
  }

  /** Transcribe automatically as soon as a recording lands. */
  readonly autoTranscribe = (process.env.DEEPGRAM_AUTO || 'true').trim() !== 'false';

  /** A long call is a big upload; 10 minutes of headroom is plenty. */
  readonly timeoutMs = Number(process.env.DEEPGRAM_TIMEOUT_MS || 600_000);

  get enabled(): boolean {
    return Boolean(this.apiKey);
  }

  get blockers(): string[] {
    return this.enabled ? [] : ['DEEPGRAM_API_KEY is not set - call transcripts are disabled'];
  }

  describe() {
    return {
      enabled: this.enabled,
      model: this.model,
      language: this.language,
      languages: DeepgramConfig.LANGUAGES,
      autoTranscribe: this.autoTranscribe,
      keyMasked: this.apiKey ? `${this.apiKey.slice(0, 4)}...${this.apiKey.slice(-4)}` : null,
    };
  }

  report() {
    if (!this.enabled) {
      this.log.warn('No DEEPGRAM_API_KEY - recordings will not be transcribed.');
      return;
    }
    this.log.log(`Transcription ready - model ${this.model}, language ${this.language}`);
  }
}