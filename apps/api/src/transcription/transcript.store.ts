import { Injectable, Logger } from '@nestjs/common';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { Transcript } from './transcript.types';
import { PrismaService } from '../db/prisma.service';
import { Prisma } from '@prisma/client';


@Injectable()
export class TranscriptStore {
  private readonly log = new Logger('TranscriptStore');

  private readonly dir = process.env.TRANSCRIPT_DIR
    ? resolve(process.env.TRANSCRIPT_DIR)
    : resolve(__dirname, '..', '..', '.data', 'transcripts');

  /** Hot cache so re-opening a call does not re-query. */
  private readonly cache = new Map<string, Transcript>();

  private imported = false;

  constructor(private readonly prisma: PrismaService) {}

  private get usingDb(): boolean {
    return this.prisma.live;
  }

  /** Call UUIDs become filenames, so refuse anything path-like. */
  private fileFor(callUuid: string): string | null {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(callUuid)) {
      this.log.warn(`refusing suspicious callUuid "${callUuid}"`);
      return null;
    }
    return resolve(this.dir, `${callUuid}.json`);
  }

  async get(callUuid: string): Promise<Transcript | null> {
    const cached = this.cache.get(callUuid);
    if (cached) return cached;

    if (this.usingDb) {
      try {
        const row = await this.prisma.db.transcript.findUnique({ where: { callUuid } });
        if (!row) return null;
        const parsed = toTranscript(row);
        this.cache.set(callUuid, parsed);
        return parsed;
      } catch (err) {
        this.log.error(`could not read transcript ${callUuid}: ${(err as Error).message}`);
        return null;
      }
    }

    return this.readFile(callUuid);
  }

  async save(transcript: Transcript): Promise<Transcript> {
    this.cache.set(transcript.callUuid, transcript);

    if (this.usingDb) {
      try {
        const data = {
          status: transcript.status,
          provider: transcript.provider,
          model: transcript.model,
          language: transcript.language,
          channels: transcript.channels,
          rolesAreReliable: transcript.rolesAreReliable,
          durationSec: new Prisma.Decimal(transcript.durationSec ?? 0),
          text: transcript.text,
          segments: (transcript.segments ?? []) as unknown as Prisma.InputJsonValue,
          createdAt: new Date(transcript.createdAt),
          error: transcript.error,
        };
        await this.prisma.db.transcript.upsert({
          where: { callUuid: transcript.callUuid },
          create: { callUuid: transcript.callUuid, ...data },
          update: data,
        });
      } catch (err) {
        this.log.error(
          `could not write transcript ${transcript.callUuid}: ${(err as Error).message}`,
        );
      }
      return transcript;
    }

    this.writeFile(transcript);
    return transcript;
  }

  /** Which calls already have a transcript -- used to restore status after a restart. */
  async knownCallUuids(): Promise<string[]> {
    if (this.usingDb) {
      try {
        const rows = await this.prisma.db.transcript.findMany({ select: { callUuid: true } });
        return rows.map((r) => r.callUuid);
      } catch {
        return [];
      }
    }
    return this.fileCallUuids();
  }

  /**
   * One-time move of any transcripts still on disk into Postgres.
   * Files are left in place: a copy costs nothing and makes this reversible.
   */
  async importFiles(): Promise<number> {
    if (!this.usingDb || this.imported) return 0;
    this.imported = true;

    const onDisk = this.fileCallUuids();
    if (!onDisk.length) return 0;

    let moved = 0;
    for (const callUuid of onDisk) {
      try {
        const already = await this.prisma.db.transcript.findUnique({
          where: { callUuid },
          select: { callUuid: true },
        });
        if (already) continue;

        const fromFile = this.readFile(callUuid);
        if (!fromFile) continue;

        await this.save(fromFile);
        moved++;
      } catch (err) {
        this.log.warn(`could not import transcript ${callUuid}: ${(err as Error).message}`);
      }
    }

    if (moved) this.log.log(`Imported ${moved} transcript(s) from disk into Postgres`);
    return moved;
  }

  // ------------------------------------------------------------ file store
  private readFile(callUuid: string): Transcript | null {
    const file = this.fileFor(callUuid);
    if (!file || !existsSync(file)) return null;
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as Transcript;
      this.cache.set(callUuid, parsed);
      return parsed;
    } catch (err) {
      this.log.error(`could not read transcript ${callUuid}: ${(err as Error).message}`);
      return null;
    }
  }

  private writeFile(transcript: Transcript) {
    const file = this.fileFor(transcript.callUuid);
    if (!file) return;
    try {
      mkdirSync(this.dir, { recursive: true });
      const tmp = `${file}.tmp`;
      writeFileSync(tmp, JSON.stringify(transcript, null, 2), 'utf8');
      renameSync(tmp, file);
    } catch (err) {
      this.log.error(
        `could not write transcript ${transcript.callUuid}: ${(err as Error).message}`,
      );
    }
  }

  private fileCallUuids(): string[] {
    try {
      if (!existsSync(this.dir)) return [];
      return readdirSync(this.dir)
        .filter((f) => f.endsWith('.json'))
        .map((f) => f.slice(0, -'.json'.length));
    } catch {
      return [];
    }
  }
}

function toTranscript(r: any): Transcript {
  return {
    callUuid: r.callUuid,
    status: r.status,
    provider: r.provider ?? 'deepgram',
    model: r.model ?? '',
    language: r.language ?? '',
    channels: Number(r.channels ?? 0),
    rolesAreReliable: Boolean(r.rolesAreReliable),
    // Decimal is an object, not a number; the UI does arithmetic on this.
    durationSec: Number(r.durationSec ?? 0),
    text: r.text ?? '',
    segments: Array.isArray(r.segments) ? r.segments : [],
    createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
    error: r.error ?? null,
  };
}
