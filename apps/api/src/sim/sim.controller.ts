import { Body, Controller, Logger, Post } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PlivoService } from '../plivo/plivo.service';
import { PlivoConfig } from '../plivo/plivo.config';
import { CrmService } from '../crm/crm.service';
import { EventsService } from '../events/events.service';


@Controller('api/sim')
export class SimController {
  private readonly log = new Logger('Simulator');

  constructor(
    private readonly plivo: PlivoService,
    private readonly config: PlivoConfig,
    private readonly crm: CrmService,
    private readonly events: EventsService,
  ) {}

  /** Rep dials a number (or a lead, if one is given). */
  @Post('outbound')
  outbound(
    @Body() body: { repId: string; leadId?: string; to?: string; outcome?: 'answer' | 'no-answer' | 'busy' },
  ) {
    const rep = this.crm.getRep(body.repId);
    if (!rep) return { error: 'Unknown rep' };

    const lead = body.leadId ? this.crm.getLead(body.leadId) : null;
    const to = (lead?.phone ?? body.to ?? '').trim();
    if (!to) return { error: 'No number to dial' };
    if (!this.plivo.isDialable(to)) {
      return { error: `"${to}" is not a complete phone number` };
    }

    const callUuid = randomUUID();
    const outcome = body.outcome ?? 'answer';

    this.events.wire({
      actor: 'browser',
      kind: 'sdk',
      label: 'plivo.client.call()',
      detail: `${rep.name} dials ${lead?.name ?? to}`,
      body: { to, 'X-PH-LeadId': lead?.id ?? null, 'X-PH-RepId': rep.id },
    });

    // Exactly the form-encoded fields Plivo posts to the Answer URL.
    const { xml } = this.plivo.handleAnswer({
      From: `sip:${rep.endpoint}@phone.plivo.com`,
      To: to,
      CallUUID: callUuid,
      Direction: 'inbound', // a browser call reaches Plivo as inbound
      CallStatus: 'ringing',
      'X-PH-LeadId': lead?.id ?? '',
      'X-PH-RepId': rep.id,
    });

    this.events.wire({
      actor: 'carrier',
      kind: 'note',
      label: `Ringing ${to}`,
      detail: `caller ID shown: ${this.config.phoneNumber}`,
    });

    if (outcome === 'answer') {
      setTimeout(() => {
        this.events.wire({ actor: 'carrier', kind: 'note', label: 'Customer answered', detail: 'audio path established (WebRTC <-> PSTN)' });
        this.events.emit({ type: 'call-answered', payload: { callUuid, leadId: lead?.id ?? null } });
      }, 2200);
    } else {
      setTimeout(() => {
        this.events.wire({ actor: 'carrier', kind: 'note', label: outcome === 'busy' ? 'Line busy' : 'No answer', detail: 'carrier released the call' });
        this.plivo.handleHangup({ CallUUID: callUuid, Duration: 0, CallStatus: outcome });
      }, 3000);
    }

    return { callUuid, xml, lead, rep, outcome, to };
  }

  /** A lead dials your Plivo number. */
  @Post('inbound')
  inbound(@Body() body: { leadId?: string; from?: string }) {
    const lead = body.leadId ? this.crm.getLead(body.leadId) : null;
    const from = lead?.phone ?? body.from ?? '+919000000000';
    const callUuid = randomUUID();

    this.events.wire({
      actor: 'carrier',
      kind: 'note',
      label: `Incoming call to ${this.config.phoneNumber}`,
      detail: `from ${from}`,
    });

    const { xml, decision } = this.plivo.handleAnswer({
      From: from,
      To: this.config.phoneNumber,
      CallUUID: callUuid,
      Direction: 'inbound',
      CallStatus: 'ringing',
    });

    return { callUuid, xml, decision, from, lead };
  }

  /** The rep (or the customer) hangs up. */
  @Post('hangup')
  hangup(@Body() body: { callUuid: string; durationSec?: number; status?: string }) {
    const call = this.crm.getCallByUuid(body.callUuid);
    const recordUrl =
      this.config.recordCalls && (body.status ?? 'completed') === 'completed'
        ? `https://media.plivo.com/v1/Account/DEMO/Recording/${body.callUuid}.mp3`
        : null;

    this.events.wire({
      actor: 'browser',
      kind: 'sdk',
      label: 'plivo.client.hangup()',
      detail: `call ended after ${body.durationSec ?? 0}s`,
    });

    const updated = this.plivo.handleHangup({
      CallUUID: body.callUuid,
      Duration: body.durationSec ?? 0,
      BillDuration: body.durationSec ?? 0,
      CallStatus: body.status ?? 'completed',
      RecordUrl: recordUrl,
      From: call?.from,
      To: call?.to,
    });

    return { ok: true, call: updated };
  }

  /** The rep clicks Answer on an incoming call. */
  @Post('answer-incoming')
  answerIncoming(@Body() body: { callUuid: string }) {
    this.events.wire({
      actor: 'browser',
      kind: 'sdk',
      label: 'plivo.client.answer()',
      detail: 'rep accepted the incoming call',
    });
    this.events.emit({ type: 'call-answered', payload: { callUuid: body.callUuid } });
    return { ok: true };
  }
}
