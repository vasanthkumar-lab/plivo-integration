import { Module } from '@nestjs/common';
import { CrmService } from './crm/crm.service';
import { CrmRepository } from './crm/crm.repository';
import { PrismaService } from './db/prisma.service';
import { CrmController } from './crm/crm.controller';
import { EventsService } from './events/events.service';
import { EventsController } from './events/events.controller';
import { PlivoConfig } from './plivo/plivo.config';
import { PlivoService } from './plivo/plivo.service';
import { PlivoController } from './plivo/plivo.controller';
import { SimController } from './sim/sim.controller';
import { TunnelMonitor } from './plivo/tunnel.monitor';
import { DeepgramConfig } from './transcription/deepgram.config';
import { TranscriptStore } from './transcription/transcript.store';
import { TranscriptionService } from './transcription/transcription.service';
import { TranscriptionController } from './transcription/transcription.controller';
import { GeminiConfig } from './analysis/gemini.config';
import { AnalysisService } from './analysis/analysis.service';
import { AnalysisController } from './analysis/analysis.controller';

@Module({
  controllers: [
    CrmController,
    EventsController,
    PlivoController,
    SimController,
    TranscriptionController,
    AnalysisController,
  ],
  providers: [
    PrismaService,
    CrmRepository,
    CrmService,
    EventsService,
    PlivoConfig,
    PlivoService,
    TunnelMonitor,
    DeepgramConfig,
    TranscriptStore,
    TranscriptionService,
    GeminiConfig,
    AnalysisService,
  ],
})
export class AppModule {}
