import { Controller, Get, HttpCode, NotFoundException, Param, Post, Query } from '@nestjs/common';
import { TranscriptionService } from './transcription.service';
import { DeepgramConfig } from './deepgram.config';
import { CrmService } from '../crm/crm.service';

@Controller('api')
export class TranscriptionController {
  constructor(
    private readonly transcription: TranscriptionService,
    private readonly config: DeepgramConfig,
    private readonly crm: CrmService,
  ) {}

  /** Whether transcription is configured, for the Integration Config panel. */
  @Get('transcription/config')
  describe() {
    return { ...this.config.describe(), blockers: this.config.blockers };
  }

  /** The stored transcript for one call. */
  @Get('calls/:callUuid/transcript')
  async get(@Param('callUuid') callUuid: string) {
    const transcript = await this.transcription.get(callUuid);
    if (transcript) return transcript;

    const call = this.crm.getCallByUuid(callUuid);
    if (!call) throw new NotFoundException('No such call');

    // Not an error: nothing has been transcribed yet.
    return {
      callUuid,
      status: call.recordingUrl ? 'none' : 'none',
      provider: 'deepgram',
      model: this.config.model,
      language: this.config.language,
      channels: 0,
      rolesAreReliable: false,
      durationSec: 0,
      text: '',
      segments: [],
      createdAt: null,
      error: call.recordingUrl ? null : 'This call has no recording to transcribe.',
    };
  }


  @Post('calls/:callUuid/transcript')
  @HttpCode(200)
  async create(
    @Param('callUuid') callUuid: string,
    @Query('force') force?: string,
    @Query('language') language?: string,
  ) {
    if (!this.config.enabled) {
      return { ok: false, error: 'DEEPGRAM_API_KEY is not set on the server.' };
    }

    const call = this.crm.getCallByUuid(callUuid);
    if (!call) throw new NotFoundException('No such call');
    if (!call.recordingUrl) {
      return { ok: false, error: 'This call has no recording to transcribe.' };
    }

    const transcript = await this.transcription.transcribeCall(callUuid, {
      force: force === 'true',
      language,
    });
    return { ok: transcript?.status === 'ready', transcript };
  }
}
