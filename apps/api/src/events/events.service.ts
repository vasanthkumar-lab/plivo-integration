import { Injectable } from '@nestjs/common';
import { Subject, Observable } from 'rxjs';
import { randomUUID } from 'crypto';

export type ServerEvent =
  | { type: 'incoming-call'; payload: any }
  | { type: 'call-answered'; payload: any }
  | { type: 'call-ended'; payload: any }
  | { type: 'crm-updated'; payload: any }
  | { type: 'plivo-config'; payload: any }
  | { type: 'transcript-ready'; payload: any }
  | { type: 'analysis-ready'; payload: any }
  | { type: 'wire'; payload: WireEntry };

/** One line in the Integration Inspector: a real request/response on the Plivo boundary. */
export interface WireEntry {
  id: string;
  at: string;
  /** Who sent it. */
  actor: 'browser' | 'plivo' | 'backend' | 'carrier';
  /** Short label, e.g. "POST /plivo/answer". */
  label: string;
  /** http | xml | sdk | note */
  kind: 'http' | 'xml' | 'sdk' | 'note';
  detail?: string;
  body?: Record<string, unknown> | string;
}

@Injectable()
export class EventsService {
  private readonly stream$ = new Subject<ServerEvent>();
  private readonly wireLog: WireEntry[] = [];

  subscribe(): Observable<ServerEvent> {
    return this.stream$.asObservable();
  }

  emit(event: ServerEvent) {
    this.stream$.next(event);
  }

  /** Record a hop on the Plivo boundary and push it to every open inspector. */
  wire(entry: Omit<WireEntry, 'id' | 'at'>): WireEntry {
    const full: WireEntry = { id: randomUUID().slice(0, 8), at: new Date().toISOString(), ...entry };
    this.wireLog.push(full);
    if (this.wireLog.length > 200) this.wireLog.shift();
    this.emit({ type: 'wire', payload: full });
    return full;
  }

  getWireLog() {
    return this.wireLog;
  }

  clearWireLog() {
    this.wireLog.length = 0;
  }
}
