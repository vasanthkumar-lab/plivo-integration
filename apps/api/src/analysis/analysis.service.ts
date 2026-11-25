import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { GeminiConfig } from './gemini.config';
import { AnalysisStatus, CallAnalysis, CallOutcomeVerdict, emptyAnalysis } from './analysis.types';
import { PrismaService } from '../db/prisma.service';
import { CrmService } from '../crm/crm.service';
import { EventsService } from '../events/events.service';
import { TranscriptionService } from '../transcription/transcription.service';
import type { CallLog } from '../crm/crm.types';
import type { Transcript } from '../transcription/transcript.types';

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

/**
 * Structured output. Without a schema the model returns prose that parses
 * differently every time; with one, every reply is the same shape.
 */
const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    outcome: {
      type: 'STRING',
      enum: ['converted', 'promising', 'follow_up', 'not_interested', 'unclear'],
    },
    converted: { type: 'BOOLEAN' },
    confidence: { type: 'NUMBER' },
    summary: { type: 'STRING' },
    signals: { type: 'ARRAY', items: { type: 'STRING' } },
    objections: { type: 'ARRAY', items: { type: 'STRING' } },
    nextSteps: { type: 'ARRAY', items: { type: 'STRING' } },
    sentiment: { type: 'STRING', enum: ['positive', 'neutral', 'negative'] },
  },
  required: ['outcome', 'converted', 'confidence', 'summary', 'signals', 'nextSteps', 'sentiment'],
  propertyOrdering: [
    'outcome',
    'converted',
    'confidence',
    'summary',
    'signals',
    'objections',
    'nextSteps',
    'sentiment',
  ],
};

const SYSTEM_PROMPT = `You review recorded sales calls for a staffing-technology company and decide whether the lead converted.

"Converted" means the customer committed to a concrete next step that moves money or a trial forward: agreeing to a pilot, asking for a contract or invoice, confirming budget and a start date, or placing an order. Warm interest alone is NOT conversion.

Use these outcomes:
- converted: a clear commitment was made on this call.
- promising: real buying signals, but no commitment yet.
- follow_up: the customer asked to be contacted again, or a next call was scheduled.
- not_interested: the customer declined or ruled themselves out.
- unclear: too little was said to judge. Short calls, wrong numbers, voicemail and no-answers belong here.

Rules:
- Judge ONLY what is in the transcript. Never invent detail that is not there.
- Calls may be in Tamil, in English, or switch between the two mid-sentence. Read whichever is present, but always write your answer in English, and quote the customer in their original words.
- Transcripts come from automatic speech recognition and contain errors. If the text is too garbled or too short to support a verdict, answer "unclear" with low confidence rather than guessing.
- Quote the customer in "signals", using their actual words, so a human can check your reasoning.
- confidence is 0 to 1 and should be honest: below 0.4 when the transcript is thin.
- Keep summary to one or two plain sentences a sales manager can skim.`;

@Injectable()
export class AnalysisService implements OnModuleInit {
  private readonly log = new Logger('Analysis');

  /** Calls being analysed right now, so a retry click cannot double-bill. */
  private readonly inFlight = new Set<string>();

  /** Used only when there is no database, so the UI still works offline. */
  private readonly memory = new Map<string, CallAnalysis>();

  constructor(
    private readonly config: GeminiConfig,
    private readonly prisma: PrismaService,
    private readonly crm: CrmService,
    private readonly events: EventsService,
    private readonly transcription: TranscriptionService,
  ) {}

  async onModuleInit() {
    this.config.report();

    // Close the loop without a dependency cycle: the transcript pipeline calls
    // back here the moment it has text to read.
    this.transcription.onTranscriptReady = (callUuid) => {
      if (!this.config.enabled || !this.config.autoAnalyse) return;
      void this.analyseCall(callUuid).catch(() => undefined);
    };

    await this.prisma.ensureReady();
    await this.crm.whenLoaded();

    // Call rows and analyses are loaded separately, so reconcile the status
    // each call advertises with what actually exists.
    if (!this.prisma.live) return;
    try {
      const rows = await this.prisma.db.callAnalysis.findMany({
        select: { callUuid: true, status: true },
      });
      let restored = 0;
      for (const row of rows) {
        const call = this.crm.getCallByUuid(row.callUuid);
        if (call && call.analysisStatus !== row.status) {
          this.crm.setAnalysisStatus(row.callUuid, row.status as AnalysisStatus);
          restored++;
        }
      }
      if (restored) this.log.log(`Reattached ${restored} analysis record(s) to restored calls`);
    } catch (err) {
      this.log.warn(`could not reconcile analyses: ${(err as Error).message}`);
    }
  }

  async get(callUuid: string): Promise<CallAnalysis | null> {
    if (!this.prisma.live) return this.memory.get(callUuid) ?? null;
    try {
      const row = await this.prisma.db.callAnalysis.findUnique({ where: { callUuid } });
      return row ? toAnalysis(row) : null;
    } catch (err) {
      this.log.error(`could not read analysis ${callUuid}: ${(err as Error).message}`);
      return null;
    }
  }

  /**
   * Analyse one call's transcript.
   *
   * Fire-and-forget from the transcript pipeline: a webhook must not wait on a
   * model call, and nothing downstream depends on the verdict arriving fast.
   */
  async analyseCall(
    callUuid: string,
    opts: { force?: boolean } = {},
  ): Promise<CallAnalysis | null> {
    if (!this.config.enabled || !callUuid) return null;

    const call = this.crm.getCallByUuid(callUuid);
    if (!call) return null;

    const existing = await this.get(callUuid);

    /**
     * Every path out of this method must emit a terminal event. The client
     * starts a spinner the moment it asks for an analysis and only stops it on
     * one of these, so a silent early return leaves it spinning forever.
     */
    if (existing?.status === 'ready' && !opts.force) {
      this.events.emit({ type: 'analysis-ready', payload: { callUuid, status: 'ready' } });
      return existing;
    }

    // An analysis already running will emit for itself when it finishes.
    if (this.inFlight.has(callUuid)) return existing;

    const transcript = await this.transcription.get(callUuid);
    if (!transcript || transcript.status !== 'ready' || !transcript.text.trim()) {
      this.events.emit({ type: 'analysis-ready', payload: { callUuid, status: 'none' } });
      return emptyAnalysis(callUuid, this.config.model, 'No transcript to analyse yet.');
    }

    this.inFlight.add(callUuid);
    await this.setStatus(callUuid, 'pending');

    this.events.wire({
      actor: 'backend',
      kind: 'http',
      label: `POST generativelanguage.googleapis.com/${this.config.model}`,
      detail: `analysing ${callUuid.slice(0, 8)}`,
    });

    try {
      const analysis = await this.send(call, transcript);
      await this.save(analysis);
      await this.setStatus(callUuid, 'ready');
      this.attachActivity(call, analysis);

      this.events.wire({
        actor: 'backend',
        kind: 'note',
        label: `Analysis: ${analysis.outcome}`,
        detail: `${analysis.summary.slice(0, 120)} (confidence ${analysis.confidence.toFixed(2)})`,
      });
      this.events.emit({ type: 'analysis-ready', payload: { callUuid, status: 'ready' } });
      return analysis;
    } catch (err) {
      const message = (err as Error).message;
      this.log.error(`analysis failed for ${callUuid}: ${message}`);

      const failed: CallAnalysis = {
        ...emptyAnalysis(callUuid, this.config.model, message),
        status: 'failed',
        createdAt: new Date().toISOString(),
      };
      await this.save(failed);
      await this.setStatus(callUuid, 'failed');

      this.events.wire({
        actor: 'backend',
        kind: 'note',
        label: 'Analysis failed',
        detail: message.slice(0, 160),
      });
      this.events.emit({ type: 'analysis-ready', payload: { callUuid, status: 'failed' } });
      return failed;
    } finally {
      this.inFlight.delete(callUuid);
    }
  }

  // ----------------------------------------------------------------- Gemini
  private async send(call: CallLog, transcript: Transcript): Promise<CallAnalysis> {
    const url = `${GEMINI_URL}/${this.config.model}:generateContent`;

    const body: Record<string, unknown> = {
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: 'user', parts: [{ text: this.buildPrompt(call, transcript) }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: RESPONSE_SCHEMA,
        // A classification should not wander between runs.
        temperature: 0.2,
        thinkingConfig: { thinkingBudget: this.config.thinkingBudget },
      },
    };

    /**
     * Transient trouble, not a bad request:
     *   429 / 503  - a shared model under load.
     *   a timeout  - the flagship models sometimes accept the connection and
     *                then never answer, so an abort is a symptom of overload
     *                rather than of anything wrong with the request.
     * Failing on the first one would leave a permanent "failed" badge on a call
     * that is perfectly analysable.
     */
    const maxAttempts = 4;
    let res: Response | null = null;
    let lastTimeout: Error | null = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      lastTimeout = null;
      try {
        res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': this.config.apiKey,
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(this.config.timeoutMs),
        });
      } catch (err) {
        const e = err as Error;
        // Anything that is not an abort is a real network failure; let it out.
        if (e.name !== 'TimeoutError' && e.name !== 'AbortError') throw e;
        lastTimeout = new Error(
          `Gemini did not respond within ${this.config.timeoutMs / 1000}s ` +
            `(model ${this.config.model})`,
        );
        res = null;
      }

      if (res?.ok) break;

      const retryable = lastTimeout !== null || res?.status === 429 || res?.status === 503;
      if (!retryable || attempt === maxAttempts) break;

      // 2s, 4s, 8s. Enough for a demand spike to pass without stalling a queue.
      const waitMs = 2000 * 2 ** (attempt - 1);
      this.log.warn(
        `Gemini ${lastTimeout ? 'timeout' : res?.status} on attempt ` +
          `${attempt}/${maxAttempts}; retrying in ${waitMs / 1000}s`,
      );
      await new Promise((r) => setTimeout(r, waitMs));
    }

    // Every attempt timed out: report that plainly rather than as a bare abort.
    if (lastTimeout) throw lastTimeout;
    if (!res) throw new Error('Gemini request never completed');

    if (!res.ok) {
      const raw = await res.text().catch(() => '');
      let detail = raw.slice(0, 300);
      try {
        detail = JSON.parse(raw)?.error?.message || detail;
      } catch {
        /* keep the raw text */
      }
      throw new Error(`Gemini ${res.status}: ${detail}`);
    }

    const data = (await res.json()) as any;

    const blocked = data?.promptFeedback?.blockReason;
    if (blocked) throw new Error(`Gemini refused the prompt: ${blocked}`);

    const text = data?.candidates?.[0]?.content?.parts
      ?.map((p: any) => p?.text ?? '')
      .join('')
      .trim();
    if (!text) {
      const reason = data?.candidates?.[0]?.finishReason ?? 'no content';
      throw new Error(`Gemini returned nothing (${reason})`);
    }

    let parsed: any;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error(`Gemini returned text that is not JSON: ${text.slice(0, 160)}`);
    }

    return this.toAnalysisFromModel(call, parsed, data);
  }

  /**
   * The transcript, plus the facts the model cannot hear: who called whom, how
   * long it lasted, and who hung up. A 7-second call that the rep cancelled is
   * not a lost deal, and saying so stops the model reading drama into silence.
   */
  private buildPrompt(call: CallLog, transcript: Transcript): string {
    const lead = call.leadId ? this.crm.getLead(call.leadId) : null;
    const speaker = (role: string, i: number) =>
      role === 'rep' ? 'SALES REP' : role === 'customer' ? 'CUSTOMER' : `SPEAKER ${i + 1}`;

    const lines = transcript.segments.length
      ? transcript.segments
          .map((s) => `[${s.start.toFixed(0)}s] ${speaker(s.role, s.speaker)}: ${s.text}`)
          .join('\n')
      : transcript.text;

    const speakersKnown = transcript.rolesAreReliable
      ? 'Speaker labels are reliable (each party was recorded on its own channel).'
      : 'Speaker labels are NOT reliable: the recording is mono, so treat attribution with caution.';

    return [
      `CALL FACTS`,
      `- Direction: ${call.direction}`,
      `- Duration: ${call.durationSec}s`,
      `- Outcome reported by the phone system: ${call.status}${
        call.endedBy ? ` (ended by the ${call.endedBy})` : ''
      }`,
      lead ? `- Contact: ${lead.name}, ${lead.company}` : `- Contact: not in the CRM`,
      `- ${speakersKnown}`,
      ``,
      `TRANSCRIPT`,
      lines || '(no speech was detected)',
    ].join('\n');
  }

  private toAnalysisFromModel(call: CallLog, parsed: any, raw: any): CallAnalysis {
    const asList = (v: unknown): string[] =>
      Array.isArray(v) ? v.map((x) => String(x)).filter(Boolean) : [];

    const outcome = String(parsed?.outcome ?? 'unclear') as CallOutcomeVerdict;
    const confidence = Math.max(0, Math.min(1, Number(parsed?.confidence ?? 0)));

    return {
      callUuid: call.callUuid,
      status: 'ready',
      provider: 'gemini',
      model: String(raw?.modelVersion ?? this.config.model),
      outcome,
      // Trust the enum over the boolean: they are produced together and the
      // enum is constrained, so it is the one that cannot drift.
      converted: outcome === 'converted',
      confidence,
      summary: String(parsed?.summary ?? '').trim(),
      signals: asList(parsed?.signals),
      objections: asList(parsed?.objections),
      nextSteps: asList(parsed?.nextSteps),
      sentiment: ['positive', 'neutral', 'negative'].includes(parsed?.sentiment)
        ? parsed.sentiment
        : null,
      createdAt: new Date().toISOString(),
      error: null,
    };
  }

  // ---------------------------------------------------------------- storage
  private async save(a: CallAnalysis): Promise<void> {
    if (!this.prisma.live) {
      this.memory.set(a.callUuid, a);
      return;
    }
    const data = {
      status: a.status,
      provider: a.provider,
      model: a.model,
      outcome: a.outcome,
      converted: a.converted,
      confidence: new Prisma.Decimal(a.confidence ?? 0),
      summary: a.summary,
      signals: a.signals as unknown as Prisma.InputJsonValue,
      objections: a.objections as unknown as Prisma.InputJsonValue,
      nextSteps: a.nextSteps as unknown as Prisma.InputJsonValue,
      sentiment: a.sentiment,
      createdAt: a.createdAt ? new Date(a.createdAt) : new Date(),
      error: a.error,
    };
    try {
      await this.prisma.db.callAnalysis.upsert({
        where: { callUuid: a.callUuid },
        create: { callUuid: a.callUuid, ...data },
        update: data,
      });
    } catch (err) {
      this.log.error(`could not write analysis ${a.callUuid}: ${(err as Error).message}`);
    }
  }

  private async setStatus(callUuid: string, status: AnalysisStatus) {
    this.crm.setAnalysisStatus(callUuid, status);
    this.events.emit({ type: 'analysis-ready', payload: { callUuid, status } });
  }

  private attachActivity(call: CallLog, a: CallAnalysis) {
    if (!call.leadId) return;
    this.crm.addActivity({
      leadId: call.leadId,
      type: 'note',
      title: `AI verdict: ${labelFor(a.outcome)}`,
      body: a.summary || undefined,
      meta: {
        callUuid: call.callUuid,
        outcome: a.outcome,
        converted: a.converted,
        confidence: a.confidence,
      },
    });
  }
}

function labelFor(outcome: CallOutcomeVerdict | null): string {
  switch (outcome) {
    case 'converted':
      return 'Converted';
    case 'promising':
      return 'Promising';
    case 'follow_up':
      return 'Follow-up needed';
    case 'not_interested':
      return 'Not interested';
    default:
      return 'Unclear';
  }
}

function toAnalysis(r: any): CallAnalysis {
  const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);
  return {
    callUuid: r.callUuid,
    status: r.status,
    provider: 'gemini',
    model: r.model ?? '',
    outcome: r.outcome ?? null,
    converted: Boolean(r.converted),
    // Decimal is an object, not a number; the UI formats this as a percentage.
    confidence: Number(r.confidence ?? 0),
    summary: r.summary ?? '',
    signals: list(r.signals),
    objections: list(r.objections),
    nextSteps: list(r.nextSteps),
    sentiment: r.sentiment ?? null,
    createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
    error: r.error ?? null,
  };
}
