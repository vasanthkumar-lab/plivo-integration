import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../db/prisma.service';
import { Activity, CallLog, Lead } from './crm.types';

/**
 * Reads and writes the CRM tables through Prisma.
 *
 * CrmService keeps the working set in memory -- the Answer URL handler has to
 * decide who to ring synchronously, in the few hundred milliseconds Plivo
 * allows -- and this writes every change through to Postgres so nothing is
 * lost on restart. Single instance only: two processes would each hold their
 * own cache, which is already true of SSE and rep presence.
 */
@Injectable()
export class CrmRepository {
  private readonly log = new Logger('CrmRepo');

  constructor(private readonly prisma: PrismaService) {}

  get live(): boolean {
    return this.prisma.live;
  }

  /** Wait for the connection, however the provider order happened to fall. */
  async ensureReady(): Promise<boolean> {
    return this.prisma.ensureReady();
  }

  // ------------------------------------------------------------------ reads
  async loadAll(): Promise<{ leads: Lead[]; calls: CallLog[]; activities: Activity[] }> {
    const db = this.prisma.db;

    const [leads, calls, activities] = await Promise.all([
      db.lead.findMany({ orderBy: { createdAt: 'asc' } }),
      db.call.findMany({ orderBy: { startedAt: 'asc' } }),
      db.activity.findMany({ orderBy: { at: 'asc' } }),
    ]);

    return {
      leads: leads.map(toLead),
      calls: calls.map(toCall),
      activities: activities.map(toActivity),
    };
  }

  async isEmpty(): Promise<boolean> {
    const db = this.prisma.db;
    const [leads, calls] = await Promise.all([db.lead.count(), db.call.count()]);
    return leads + calls === 0;
  }

  // ----------------------------------------------------------------- writes
  async saveLead(lead: Lead) {
    const data = {
      name: lead.name,
      company: lead.company,
      phone: lead.phone,
      email: lead.email,
      stage: lead.stage,
      value: new Prisma.Decimal(lead.value ?? 0),
      ownerId: lead.ownerId,
      lastContactedAt: lead.lastContactedAt ? new Date(lead.lastContactedAt) : null,
    };
    await this.prisma.db.lead.upsert({
      where: { id: lead.id },
      create: { id: lead.id, ...data },
      update: data,
    });
  }

  async saveCall(call: CallLog) {
    const data = {
      leadId: call.leadId,
      repId: call.repId,
      direction: call.direction,
      from: call.from,
      to: call.to,
      status: call.status,
      startedAt: new Date(call.startedAt),
      endedAt: call.endedAt ? new Date(call.endedAt) : null,
      durationSec: Math.round(call.durationSec ?? 0),
      recordingUrl: call.recordingUrl,
      disposition: call.disposition,
      notes: call.notes,
      endedBy: call.endedBy,
      endReason: call.endReason,
      transcriptStatus: call.transcriptStatus,
      analysisStatus: call.analysisStatus,
    };
    await this.prisma.db.call.upsert({
      where: { callUuid: call.callUuid },
      create: { id: call.id, callUuid: call.callUuid, ...data },
      update: data,
    });
  }

  async saveActivity(a: Activity) {
    await this.prisma.db.activity.upsert({
      where: { id: a.id },
      create: {
        id: a.id,
        leadId: a.leadId,
        type: a.type,
        title: a.title,
        body: a.body ?? null,
        at: new Date(a.at),
        meta: (a.meta ?? null) as Prisma.InputJsonValue,
      },
      // An activity is an immutable timeline entry; re-saving must not rewrite it.
      update: {},
    });
  }

  /**
   * Delete a call and everything hanging off it, in one transaction.
   *
   * Activities are matched on meta->>'callUuid' because they belong to a lead
   * rather than to a call, so there is no column to join on.
   */
  async deleteCall(callUuid: string): Promise<void> {
    const db = this.prisma.db;
    await db.$transaction([
      db.transcript.deleteMany({ where: { callUuid } }),
      db.callAnalysis.deleteMany({ where: { callUuid } }),
      db.activity.deleteMany({ where: { meta: { path: ['callUuid'], equals: callUuid } } }),
      db.call.deleteMany({ where: { callUuid } }),
    ]);
  }

  /**
   * One-time import of the JSON store.
   * Leads go first so a call always has its contact available to join to.
   */
  async importSnapshot(data: { leads: Lead[]; calls: CallLog[]; activities: Activity[] }) {
    for (const lead of data.leads) await this.saveLead(lead);
    for (const call of data.calls) await this.saveCall(call);
    for (const activity of data.activities) await this.saveActivity(activity);
    this.log.log(
      `Imported ${data.leads.length} contacts, ${data.calls.length} calls, ` +
        `${data.activities.length} activities from the JSON store`,
    );
  }
}

// ------------------------------------------------------------- row mapping
const iso = (v: Date | null): string | null => (v ? v.toISOString() : null);

function toLead(r: any): Lead {
  return {
    id: r.id,
    name: r.name,
    company: r.company,
    phone: r.phone,
    email: r.email,
    stage: r.stage,
    // Decimal is an object, not a number; the UI does arithmetic on this.
    value: Number(r.value ?? 0),
    ownerId: r.ownerId,
    lastContactedAt: iso(r.lastContactedAt),
  };
}

function toCall(r: any): CallLog {
  return {
    id: r.id,
    callUuid: r.callUuid,
    leadId: r.leadId,
    repId: r.repId,
    direction: r.direction,
    from: r.from,
    to: r.to,
    status: r.status,
    startedAt: iso(r.startedAt) as string,
    endedAt: iso(r.endedAt),
    durationSec: Number(r.durationSec ?? 0),
    recordingUrl: r.recordingUrl,
    disposition: r.disposition,
    notes: r.notes,
    endedBy: r.endedBy,
    endReason: r.endReason,
    transcriptStatus: r.transcriptStatus ?? 'none',
    analysisStatus: r.analysisStatus ?? 'none',
  };
}

function toActivity(r: any): Activity {
  return {
    id: r.id,
    leadId: r.leadId,
    type: r.type,
    title: r.title,
    body: r.body ?? undefined,
    at: iso(r.at) as string,
    meta: r.meta ?? undefined,
  };
}
