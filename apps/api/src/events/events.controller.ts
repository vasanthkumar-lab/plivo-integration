import { Body, Controller, Delete, Get, HttpCode, Post, Sse, MessageEvent } from '@nestjs/common';
import { map, Observable, startWith } from 'rxjs';
import { EventsService } from './events.service';

@Controller('api/events')
export class EventsController {
  constructor(private readonly events: EventsService) {}

  /** Server-sent events: the browser's live feed of ring / hangup / wire activity. */
  @Sse('stream')
  stream(): Observable<MessageEvent> {
    return this.events.subscribe().pipe(
      startWith({ type: 'crm-updated' as const, payload: { reason: 'connected' } }),
      map((event) => ({ data: event }) as MessageEvent),
    );
  }

  @Get('wire')
  wire() {
    return this.events.getWireLog();
  }

  @Post('client')
  @HttpCode(200)
  client(@Body() body: { label: string; detail?: string; body?: any; kind?: 'http' | 'xml' | 'sdk' | 'note' }) {
    return this.events.wire({
      actor: 'browser',
      kind: body.kind ?? 'sdk',
      label: String(body.label ?? 'sdk event'),
      detail: body.detail,
      body: body.body,
    });
  }

  @Delete('wire')
  clear() {
    this.events.clearWireLog();
    return { ok: true };
  }
}
