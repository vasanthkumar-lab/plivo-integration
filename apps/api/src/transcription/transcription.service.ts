import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DeepgramConfig } from './deepgram.config';
import { TranscriptStore } from './transcript.store';
import { SpeakerRole, Transcript, TranscriptSegment } from './transcript.types';
import { CrmService } from '../crm/crm.service';
import { EventsService } from '../events/events.service';
import { PlivoConfig } from '../plivo/plivo.config';
import { PrismaService } from '../db/prisma.service';
import type { CallLog } from '../crm/crm.types';

const DEEPGRAM_URL = 'https://api.deepgram.com/v1/listen';

/** The bits of Deepgram's response we actually read. */
interface DeepgramUtterance {
  start?: number;
  end?: number;
  speaker?: number;
  channel?: number;
  transcript?: string;
  confidence?: number;
}

@Injectable()
export class TranscriptionService implements OnModuleInit {
  private readonly log = new Logger('Transcription');

  /** Calls being transcribed right now, so a retry click cannot double-bill. */
  private readonly inFlight = new Set<string>();

  constructor(
    private readonly config: DeepgramConfig,
    private readonly store: TranscriptStore,
    private readonly crm: CrmService,
    private readonly events: EventsService,
    private readonly plivoConfig: PlivoConfig,
    private readonly db: PrismaService,
  ) {}

  
  async onModuleInit() {
    this.config.report();

    // The database may not have finished connecting yet, and CrmService has to
    // have loaded its calls before statuses can be matched to them.
    await this.db.ensureReady();
    // CrmService must have finished swapping in its Postgres rows, or the
    // statuses set below land on call objects that are about to be replaced.
    await this.crm.whenLoaded();
    await this.store.importFiles();

    let restored = 0;
    for (const callUuid of await this.store.knownCallUuids()) {
      const call = this.crm.getCallByUuid(callUuid);
      if (!call) continue;
      const stored = await this.store.get(callUuid);
      if (!stored) continue;
      if (call.transcriptStatus !== stored.status) {
        this.crm.setTranscriptStatus(callUuid, stored.status);
        restored++;
      }
    }
    if (restored) this.log.log(`Reattached ${restored} transcript(s) to restored calls`);
  }


  onTranscriptReady: ((callUuid: string) => void) | null = null;

  get(callUuid: string): Promise<Transcript | null> {
    return this.store.get(callUuid);
  }


  async transcribeCall(
    callUuid: string,
    opts: { force?: boolean; language?: string } = {},
  ): Promise<Transcript | null> {
    if (!this.config.enabled || !callUuid) return null;

    const call = this.crm.getCallByUuid(callUuid);
    if (!call?.recordingUrl) return null;

    const existing = await this.store.get(callUuid);
    if (existing?.status === 'ready' && !opts.force) return existing;
    if (this.inFlight.has(callUuid)) return existing;

    this.inFlight.add(callUuid);
    this.crm.setTranscriptStatus(callUuid, 'pending');
    this.emitStatus(callUuid, 'pending');

    this.events.wire({
      actor: 'backend',
      kind: 'http',
      label: 'POST api.deepgram.com/v1/listen',
      detail: `transcribing ${callUuid.slice(0, 8)} with ${this.config.model}`,
    });

    try {
      const language = opts.language
        ? DeepgramConfig.normalizeLanguage(opts.language)
        : this.config.language;

      const audio = await this.fetchRecording(call);
      const transcript = await this.send(call, audio, language);

      await this.store.save(transcript);
      this.crm.setTranscriptStatus(callUuid, 'ready');
      this.attachActivity(call, transcript);

      this.events.wire({
        actor: 'backend',
        kind: 'note',
        label: 'Transcript ready',
        detail:
          `${transcript.segments.length} segments, ${transcript.channels} channel(s)` +
          `${transcript.rolesAreReliable ? '' : ' - speakers inferred'}`,
      });
      this.events.emit({ type: 'transcript-ready', payload: { callUuid, status: 'ready' } });

      // The verdict needs the transcript, so it can only start now. Not awaited:
      // the caller is often a Plivo webhook that must answer promptly.
      this.onTranscriptReady?.(callUuid);
      return transcript;
    } catch (err) {
      const message = (err as Error).message;
      this.log.error(`transcription failed for ${callUuid}: ${message}`);

      const failed: Transcript = {
        callUuid,
        status: 'failed',
        provider: 'deepgram',
        model: this.config.model,
        language: opts.language ?? this.config.language,
        channels: 0,
        rolesAreReliable: false,
        durationSec: 0,
        text: '',
        segments: [],
        createdAt: new Date().toISOString(),
        error: message,
      };
      await this.store.save(failed);
      this.crm.setTranscriptStatus(callUuid, 'failed');

      this.events.wire({
        actor: 'backend',
        kind: 'note',
        label: 'Transcript failed',
        detail: message.slice(0, 160),
      });
      this.emitStatus(callUuid, 'failed');
      return failed;
    } finally {
      this.inFlight.delete(callUuid);
    }
  }

  private emitStatus(callUuid: string, status: string) {
    this.events.emit({ type: 'transcript-ready', payload: { callUuid, status } });
  }

  /** Plivo's media URLs need Basic Auth, so this cannot be a plain fetch. */
  private async fetchRecording(call: CallLog): Promise<Buffer> {
    const res = await fetch(call.recordingUrl as string, {
      headers: this.plivoConfig.live
        ? {
            Authorization: `Basic ${Buffer.from(
              `${this.plivoConfig.authId}:${this.plivoConfig.authToken}`,
            ).toString('base64')}`,
          }
        : {},
    });
    if (!res.ok) throw new Error(`Plivo returned ${res.status} for the recording`);

    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length) throw new Error('Plivo returned an empty recording');
    return buf;
  }

  private async send(call: CallLog, audio: Buffer, language: string): Promise<Transcript> {
    /**
     * multichannel and diarize are mutually exclusive at Deepgram: asking for
     * multichannel on a mono file silently turns diarization OFF, and every
     * utterance comes back as speaker 0. So inspect the audio and ask for
     * exactly one of them.
     */
    const stereo = audioIsStereo(audio);

    const params = new URLSearchParams({
      model: this.config.model,
      language,
      smart_format: 'true',
      punctuate: 'true',
      utterances: 'true',
    });

    if (stereo) {
      // Each leg is its own channel, so the speaker split is a fact.
      params.set('multichannel', 'true');
    } else {
      // One mixed track: separate the voices by sound, and admit we cannot
      // prove which one is the rep.
      params.set('diarize', 'true');
    }

    this.log.log(
      `sending ${Math.round(audio.length / 1024)}KB to Deepgram ` +
        `(${language}, ${stereo ? 'multichannel' : 'diarize'})`,
    );

    const res = await fetch(`${DEEPGRAM_URL}?${params}`, {
      method: 'POST',
      headers: {
        Authorization: `Token ${this.config.apiKey}`,
        'Content-Type': 'audio/mpeg',
      },
      body: new Uint8Array(audio),
      signal: AbortSignal.timeout(this.config.timeoutMs),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      let detail = body.slice(0, 300);
      try {
        const parsed = JSON.parse(body);
        // Deepgram puts the useful part in err_msg.
        detail = parsed.err_msg || parsed.message || detail;
      } catch {
        /* keep the raw text */
      }
      throw new Error(`Deepgram ${res.status}: ${detail}`);
    }

    return this.toTranscript(call, await res.json(), language);
  }

  /** Flatten Deepgram's response into the shape the UI renders. */
  private toTranscript(call: CallLog, data: any, language: string): Transcript {
    const channelCount = Array.isArray(data?.results?.channels)
      ? data.results.channels.length
      : 1;
    const utterances: DeepgramUtterance[] = data?.results?.utterances ?? [];
    const rolesAreReliable = channelCount > 1;

    const segments: TranscriptSegment[] = utterances
      .filter((u) => (u.transcript ?? '').trim().length > 0)
      .map((u) => {
        const channel = Number(u.channel ?? 0);
        return {
          start: Number(u.start ?? 0),
          end: Number(u.end ?? 0),
          speaker: rolesAreReliable ? channel : Number(u.speaker ?? 0),
          role: this.roleFor(call, channel, rolesAreReliable),
          text: (u.transcript ?? '').trim(),
          confidence: Number(u.confidence ?? 0),
        };
      })
      .sort((a, b) => a.start - b.start);

    // utterances is the good path; fall back to the flat transcript when
    // Deepgram returns none, which happens on very short or silent audio.
    const flat =
      segments
        .map((s) => s.text)
        .join(' ')
        .trim() ||
      String(data?.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? '').trim();

    return {
      callUuid: call.callUuid,
      status: 'ready',
      provider: 'deepgram',
      model: modelName(data) ?? this.config.model,
      language,
      channels: channelCount,
      rolesAreReliable,
      durationSec: Number(data?.metadata?.duration ?? call.durationSec ?? 0),
      text: flat,
      segments,
      createdAt: new Date().toISOString(),
      error: null,
    };
  }

  /**
   * Channel 0 is the A leg, the party Plivo bridged *from*. On an outbound call
   * that is the rep; on an inbound call it is the customer who dialled in.
   * Mono audio gives nothing to key off, so say "unknown" rather than guess.
   */
  private roleFor(call: CallLog, channel: number, reliable: boolean): SpeakerRole {
    if (!reliable) return 'unknown';
    if (call.direction === 'outbound') return channel === 0 ? 'rep' : 'customer';
    return channel === 0 ? 'customer' : 'rep';
  }

  private attachActivity(call: CallLog, transcript: Transcript) {
    if (!call.leadId) return;
    const preview = transcript.text.slice(0, 180);
    this.crm.addActivity({
      leadId: call.leadId,
      type: 'system',
      title: 'Transcript ready',
      body: preview
        ? `${preview}${transcript.text.length > 180 ? '…' : ''}`
        : 'No speech detected.',
      meta: { callUuid: call.callUuid, segments: transcript.segments.length },
    });
  }
}

/**
 * Is this MP3 stereo or mono?
 *
 * Plivo is asked to record in dual channel, but older recordings are mono and
 * some accounts refuse dual, so the file itself is the only trustworthy
 * source. Reads the first MPEG frame header: byte 3, bits 7-6 hold the channel
 * mode, where 3 means single channel.
 */
function audioIsStereo(buf: Buffer): boolean {
  let i = 0;

  // Skip an ID3v2 tag if present; its size is four syncsafe bytes.
  if (buf.length > 10 && buf.toString('ascii', 0, 3) === 'ID3') {
    const size =
      ((buf[6] & 0x7f) << 21) |
      ((buf[7] & 0x7f) << 14) |
      ((buf[8] & 0x7f) << 7) |
      (buf[9] & 0x7f);
    i = 10 + size;
  }

  // Find the first frame sync: eleven set bits.
  for (; i + 3 < buf.length && i < 200_000; i++) {
    if (buf[i] !== 0xff || (buf[i + 1] & 0xe0) !== 0xe0) continue;
    return ((buf[i + 3] >> 6) & 0x03) !== 3; // 3 = single channel
  }

  // No readable header: assume mono, which asks for diarization. Guessing
  // stereo would disable it and collapse every speaker into one.
  return false;
}

/** Deepgram reports a model UUID; model_info carries the human name. */
function modelName(data: any): string | null {
  const uuid = data?.metadata?.models?.[0];
  const name = uuid ? data?.metadata?.model_info?.[uuid]?.name : null;
  return typeof name === 'string' && name ? name : null;
}
