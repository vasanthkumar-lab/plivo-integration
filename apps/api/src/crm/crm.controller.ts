import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { CrmService } from './crm.service';
import { Disposition } from './crm.types';
import { EventsService } from '../events/events.service';
import { PlivoService } from '../plivo/plivo.service';

@Controller('api')
export class CrmController {
  constructor(
    private readonly crm: CrmService,
    private readonly events: EventsService,
    private readonly plivo: PlivoService,
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

  @Patch('reps/:id/presence')
  presence(@Param('id') id: string, @Body() body: { online: boolean }) {
    const rep = this.crm.setRepOnline(id, body.online);
    this.events.emit({ type: 'crm-updated', payload: { reason: 'presence', repId: id } });
    return rep;
  }
}
