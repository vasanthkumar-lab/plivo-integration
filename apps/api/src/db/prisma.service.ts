import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

/**
 * The Prisma connection.
 *
 * Optional on purpose: with no DATABASE_URL the app falls back to the JSON
 * store, so a laptop without Docker running still works.
 *
 * Prisma 7 no longer reads the connection string from schema.prisma, so the
 * client is constructed with a pg driver adapter. The CLI gets the same URL
 * from prisma.config.ts.
 */
@Injectable()
export class PrismaService implements OnModuleInit, OnApplicationShutdown {
  private readonly log = new Logger('Prisma');

  readonly url = (process.env.DATABASE_URL || '').trim();

  private client: PrismaClient | null = null;
  private ready = false;
  private lastError: string | null = null;
  /** Set on the first connect attempt so every caller awaits the same one. */
  private initPromise: Promise<void> | null = null;

  get enabled(): boolean {
    return Boolean(this.url);
  }

  /** True only once the connection has been proven with a real query. */
  get live(): boolean {
    return this.ready;
  }

  /** The generated client. Only touch this after ensureReady() returns true. */
  get db(): PrismaClient {
    if (!this.client) throw new Error('Prisma is not connected');
    return this.client;
  }

  async onModuleInit() {
    await this.ensureReady();
  }

  /**
   * Connect, once.
   *
   * Anything that needs the database awaits this rather than trusting Nest to
   * have run this provider's onModuleInit first -- that ordering is an
   * implementation detail, and getting it wrong silently skips the import.
   */
  async ensureReady(): Promise<boolean> {
    if (!this.enabled) return false;
    if (!this.initPromise) this.initPromise = this.connect();
    await this.initPromise;
    return this.ready;
  }

  private async connect(): Promise<void> {
    if (!this.enabled) {
      this.log.warn('No DATABASE_URL - using the JSON store at .data/crm.json');
      return;
    }

    try {
      const adapter = new PrismaPg({
        connectionString: this.url,
        max: Number(process.env.DATABASE_POOL_MAX || 10),
        connectionTimeoutMillis: 8000,
        // Managed Postgres (Railway, Neon, Supabase) terminates TLS with a cert
        // this client has no root for; the connection is still encrypted.
        ssl: /sslmode=require|\.railway\.app|\.neon\.tech|supabase/.test(this.url)
          ? { rejectUnauthorized: false }
          : undefined,
      });

      this.client = new PrismaClient({ adapter });

      // A connection that has not run a query has not been proven to work.
      await this.client.$queryRaw`SELECT 1`;

      this.ready = true;
      this.log.log(`Connected to ${this.safeUrl}`);
    } catch (err) {
      this.ready = false;
      this.lastError = (err as Error).message;
      this.log.error(
        `Could not connect to Postgres: ${this.lastError}. ` +
          'Falling back to the JSON store so calls keep working.',
      );
    }
  }

  async onApplicationShutdown() {
    await this.client?.$disconnect().catch(() => undefined);
    this.client = null;
  }

  private get safeUrl(): string | null {
    return this.url ? this.url.replace(/\/\/[^@]*@/, '//***@') : null;
  }

  /** Connection health, for diagnosing a silent fallback to the JSON store. */
  describe() {
    return {
      orm: 'prisma',
      enabled: this.enabled,
      live: this.ready,
      url: this.safeUrl,
      lastError: this.lastError,
    };
  }
}
