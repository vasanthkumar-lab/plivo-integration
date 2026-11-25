import 'reflect-metadata';
import { loadEnv } from './load-env';

// Must run before Nest instantiates PlivoConfig, which reads process.env.
const envFiles = loadEnv();

import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { PlivoConfig } from './plivo/plivo.config';
import { PlivoService } from './plivo/plivo.service';
import { DeepgramConfig } from './transcription/deepgram.config';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });

  // Plivo posts form-encoded webhooks by default.
  app.useBodyParser('urlencoded', { extended: true });
  app.useBodyParser('json');

  app.enableCors({ origin: true, credentials: true });

  // Lets TunnelMonitor clear its heartbeat on shutdown.
  app.enableShutdownHooks();

  const config = app.get(PlivoConfig);
  const port = Number(process.env.PORT || 4000);
  await app.listen(port);

  const log = new Logger('Bootstrap');
  log.log(envFiles.length ? `Loaded env from: ${envFiles.join(', ')}` : 'No .env file found');
  log.log(`API on http://localhost:${port}  [mode: ${config.mode}]`);
  log.log(`Answer URL: ${config.describe().answerUrl}`);
  log.log(`Hangup URL: ${config.describe().hangupUrl}`);
  config.reportReadiness();
  app.get(DeepgramConfig).report();

  // Pull anything Plivo holds that we do not, before the first browser asks.
  // Otherwise the dashboard renders an empty pipeline and fills in late.
  app
    .get(PlivoService)
    .syncRecordings()
    .catch((err) => log.warn(`startup recording sync failed: ${err.message}`));
}
bootstrap();













