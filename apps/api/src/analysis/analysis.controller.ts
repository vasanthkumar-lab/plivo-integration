import { Controller, Get, HttpCode, NotFoundException, Param, Post, Query } from '@nestjs/common';
import { AnalysisService } from './analysis.service';
import { GeminiConfig } from './gemini.config';
import { CrmService } from '../crm/crm.service';
import { emptyAnalysis } from './analysis.types';

@Controller('api')
export class AnalysisController {
  constructor(
    private readonly analysis: AnalysisService,
    private readonly config: GeminiConfig,
    private readonly crm: CrmService,
  ) {}

  /** Whether analysis is configured, for the Integration panel. */
  @Get('analysis/config')
  describe() {
    return this.config.describe();
  }

  @Get('calls/:callUuid/analysis')
  async get(@Param('callUuid') callUuid: string) {
    const found = await this.analysis.get(callUuid);
    if (found) return found;

    const call = this.crm.getCallByUuid(callUuid);
    if (!call) throw new NotFoundException('No such call');

    // Not an error: nothing has been analysed yet.
    return emptyAnalysis(
      callUuid,
      this.config.model,
      call.transcriptStatus === 'ready' ? null : 'This call has no transcript to analyse.',
    );
  }

  /** Analyse on demand, or re-run a finished one with ?force=true. */
  @Post('calls/:callUuid/analysis')
  @HttpCode(200)
  async create(@Param('callUuid') callUuid: string, @Query('force') force?: string) {
    if (!this.config.enabled) {
      return { ok: false, error: 'GEMINI_API_KEY is not set on the server.' };
    }

    const call = this.crm.getCallByUuid(callUuid);
    if (!call) throw new NotFoundException('No such call');
    if (call.transcriptStatus !== 'ready') {
      return { ok: false, error: 'Transcribe this call first.' };
    }

    /**
     * Deliberately not awaited. A model call plus retries can run past a
     * minute, and the Next dev proxy (like most reverse proxies) gives up long
     * before that and hands the browser a 500 for work that is still running.
     * The UI picks the result up from the analysis-ready SSE event instead.
     */
    void this.analysis.analyseCall(callUuid, { force: force === 'true' }).catch(() => undefined);
    return { ok: true, status: 'pending', analysis: null };
  }
}
