import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CrmService } from './crm.service';
import { Disposition } from './crm.types';
import { EventsService } from '../events/events.service';
import { PlivoService } from '../plivo/plivo.service';
import { PrismaService } from '../db/prisma.service';

@Controller('api')
export class CrmController {
  constructor(
    private readonly crm: CrmService,
    private readonly events: EventsService,
    private readonly plivo: PlivoService,
    private readonly db: PrismaService,
  ) {}

  @Get('bootstrap')
  bootstrap(@Query('repId') repId?: string) {
    return {
      reps: this.crm.getReps(),
      leads: this.crm.getLeads(),
      calls: this.crm.getCalls(),
      activities: this.crm.getActivities(),
      currentRepId: repId || 'u_ravi',
    };
  }

  /** Is the CRM actually on Postgres, and if not, why not? */
  @Get('db/status')
  dbStatus() {
    return this.db.describe();
  }

  @Get('leads')
  leads() {
    return this.crm.getLeads();
  }

  /** Add a real contact to the pipeline. */
  @Post('leads')
  createLead(
    @Body()
    body: { name?: string; company?: string; phone: string; email?: string; value?: number; ownerId?: string },
  ) {
    if (!body?.phone?.trim()) return { error: 'A phone number is required' };
    const lead = this.crm.createLead(body);
    this.events.emit({ type: 'crm-updated', payload: { reason: 'lead-created', leadId: lead.id } });
    return lead;
  }

  @Get('leads/:id')
  lead(@Param('id') id: string) {
    return {
      lead: this.crm.getLead(id),
      activities: this.crm.getActivities(id),
      calls: this.crm.getCalls().filter((c) => c.leadId === id),
    };
  }

  @Get('calls')
  calls() {
    return this.crm.getCalls();
  }

  /** Calls that produced audio. Reconciles with Plivo before answering. */
  @Get('recordings')
  async recordings() {
    await this.plivo.syncRecordings();
    return this.crm.getRecordings();
  }

  @Get('activities')
  activities(@Query('leadId') leadId?: string) {
    return this.crm.getActivities(leadId);
  }

  @Post('calls/:callUuid/disposition')
  disposition(
    @Param('callUuid') callUuid: string,
    @Body() body: { disposition: Disposition; notes?: string },
  ) {
    const call = this.crm.setDisposition(callUuid, body.disposition, body.notes);
    // Returning 201 with a null body for a call we do not have makes the UI
    // report "Outcome saved" when nothing was saved at all.
    if (!call) throw new NotFoundException(`No call with UUID ${callUuid}`);
    this.events.wire({
      actor: 'browser',
      kind: 'http',
      label: 'POST /api/calls/:uuid/disposition',
      detail: `rep logged "${body.disposition}"`,
      body: { callUuid, ...body },
    });
    this.events.emit({ type: 'crm-updated', payload: { reason: 'disposition', callUuid } });
    return call;
  }

  /**
   * Delete a call and everything derived from it.
   *
   * Also removes the audio from Plivo by default -- leaving it there would let
   * the next recordings sync rebuild the row. Pass ?keepAudio=true to delete
   * only our records and leave the file in the Plivo account.
   */
  @Delete('calls/:callUuid')
  async deleteCall(@Param('callUuid') callUuid: string, @Query('keepAudio') keepAudio?: string) {
    const call = this.crm.getCallByUuid(callUuid);
    if (!call) throw new NotFoundException(`No call with UUID ${callUuid}`);

    let audioDeleted = false;
    if (keepAudio !== 'true' && call.recordingUrl) {
      audioDeleted = await this.plivo.deleteRecording(call.recordingUrl);
    }

    await this.crm.deleteCall(callUuid);

    this.events.wire({
      actor: 'backend',
      kind: 'note',
      label: 'Call deleted',
      detail: `${callUuid.slice(0, 8)} removed${audioDeleted ? ' with its recording' : ''}`,
    });
    this.events.emit({ type: 'crm-updated', payload: { reason: 'call-deleted', callUuid } });

    return { ok: true, callUuid, audioDeleted };
  }

  @Patch('reps/:id/presence')
  presence(@Param('id') id: string, @Body() body: { online: boolean }) {
    const rep = this.crm.setRepOnline(id, body.online);
    this.events.emit({ type: 'crm-updated', payload: { reason: 'presence', repId: id } });
    return rep;
  }
}
