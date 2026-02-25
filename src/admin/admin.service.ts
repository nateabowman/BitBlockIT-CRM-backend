import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AdminService {
  constructor(private prisma: PrismaService) {}

  async getStats() {
    const [
      leadsCount,
      contactsCount,
      organizationsCount,
      activitiesCount,
      campaignsCount,
      segmentsCount,
      recentAudit,
    ] = await Promise.all([
      this.prisma.lead.count({ where: { deletedAt: null } }),
      this.prisma.contact.count(),
      this.prisma.organization.count(),
      this.prisma.activity.count(),
      this.prisma.campaign.count(),
      this.prisma.segment.count(),
      this.prisma.auditLog.findMany({
        take: 20,
        orderBy: { createdAt: 'desc' },
        include: { user: { select: { email: true, name: true } } },
      }),
    ]);

    const defaultPipeline = await this.prisma.pipeline.findFirst({
      where: { isDefault: true },
      include: {
        stages: { orderBy: { order: 'asc' }, select: { id: true, name: true } },
      },
    });

    let leadsByStage: { stageName: string; count: number }[] = [];
    if (defaultPipeline?.stages.length) {
      const stageCounts = await this.prisma.lead.groupBy({
        by: ['currentStageId'],
        where: { pipelineId: defaultPipeline.id, deletedAt: null },
        _count: { id: true },
      });
      const stageMap = new Map(defaultPipeline.stages.map((s) => [s.id, s.name]));
      leadsByStage = stageCounts.map((s) => ({
        stageName: stageMap.get(s.currentStageId) ?? s.currentStageId,
        count: s._count.id,
      }));
    }

    return {
      leadsCount,
      contactsCount,
      organizationsCount,
      activitiesCount,
      campaignsCount,
      segmentsCount,
      recentActivity: recentAudit.map((a) => ({
        id: a.id,
        resourceType: a.resourceType,
        resourceId: a.resourceId,
        action: a.action,
        user: a.user?.email ?? a.user?.name ?? 'System',
        createdAt: a.createdAt,
      })),
      leadsByStage,
    };
  }

  async getHealth(): Promise<{ connected: boolean; message: string }> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { connected: true, message: 'PostgreSQL database connected successfully.' };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return { connected: false, message: `Database connection failed: ${message}` };
    }
  }

  async getCampaignsAbSummary() {
    const campaigns = await this.prisma.campaign.findMany({
      where: { abConfig: { not: Prisma.DbNull } },
      orderBy: { createdAt: 'desc' },
      include: {
        segment: { select: { id: true, name: true } },
        _count: { select: { sends: true } },
      },
    });

    const withVariants = await Promise.all(
      campaigns.map(async (c) => {
        const byVariant = await this.prisma.campaignSend.groupBy({
          by: ['variant'],
          where: { campaignId: c.id },
          _count: { id: true },
        });
        const seg = c.segment;
        const totalSends = c._count?.sends ?? 0;
        return {
          id: c.id,
          name: c.name,
          status: c.status,
          segment: seg,
          totalSends,
          byVariant: byVariant.map((v) => ({
            variant: v.variant ?? 'default',
            count: v._count.id,
          })),
        };
      }),
    );

    return { data: withVariants };
  }

  async exportContactsCsv(): Promise<string> {
    const contacts = await this.prisma.contact.findMany({
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      include: { organization: { select: { name: true } } },
    });
    const header = 'id,firstName,lastName,email,phone,title,organization,createdAt';
    const escape = (v: string | null | undefined) => {
      if (v == null) return '';
      const s = String(v);
      return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const rows = contacts.map(
      (c) =>
        [c.id, c.firstName, c.lastName, c.email, c.phone ?? '', c.title ?? '', c.organization?.name ?? '', c.createdAt.toISOString()].map(escape).join(',')
    );
    return [header, ...rows].join('\n');
  }

  async getCalls(opts: {
    userId?: string;
    fromDate?: string;
    toDate?: string;
    page?: number;
    limit?: number;
  }) {
    const page = Math.max(1, opts.page ?? 1);
    const limit = Math.min(100, Math.max(1, opts.limit ?? 20));
    const skip = (page - 1) * limit;

    const where: { userId?: string; startedAt?: { gte?: Date; lte?: Date } } = {};
    if (opts.userId) where.userId = opts.userId;
    if (opts.fromDate || opts.toDate) {
      const dateFilter: { gte?: Date; lte?: Date } = {};
      if (opts.fromDate) dateFilter.gte = new Date(opts.fromDate);
      if (opts.toDate) dateFilter.lte = new Date(opts.toDate);
      where.startedAt = dateFilter;
    }

    const [data, total] = await Promise.all([
      this.prisma.callRecord.findMany({
        where,
        orderBy: { startedAt: 'desc' },
        skip,
        take: limit,
        include: {
          user: { select: { id: true, name: true, email: true } },
          lead: { select: { id: true, title: true } },
          contact: { select: { id: true, firstName: true, lastName: true, phone: true } },
          scriptPlaybook: { select: { id: true, name: true, slug: true } },
        },
      }),
      this.prisma.callRecord.count({ where }),
    ]);

    return {
      data: data.map((r) => ({
        id: r.id,
        userId: r.userId,
        user: r.user,
        leadId: r.leadId,
        lead: r.lead,
        contactId: r.contactId,
        contact: r.contact,
        direction: r.direction,
        fromNumber: r.fromNumber,
        toNumber: r.toNumber,
        status: r.status,
        durationSeconds: r.durationSeconds,
        startedAt: r.startedAt?.toISOString() ?? null,
        endedAt: r.endedAt?.toISOString() ?? null,
        disposition: r.disposition,
        outcomeScore: r.outcomeScore,
        scriptPlaybookId: r.scriptPlaybookId,
        scriptPlaybook: r.scriptPlaybook,
        notes: r.notes,
        sentiment: r.sentiment,
      })),
      meta: { total, page, limit },
    };
  }

  async getCallIntelligence(opts: { userId?: string; fromDate?: string; toDate?: string }) {
    const where: { userId?: string; startedAt?: { gte?: Date; lte?: Date } } = {};
    if (opts.userId) where.userId = opts.userId;
    if (opts.fromDate || opts.toDate) {
      const dateFilter: { gte?: Date; lte?: Date } = {};
      if (opts.fromDate) dateFilter.gte = new Date(opts.fromDate);
      if (opts.toDate) dateFilter.lte = new Date(opts.toDate);
      where.startedAt = dateFilter;
    }

    const records = await this.prisma.callRecord.findMany({
      where,
      select: {
        id: true,
        userId: true,
        leadId: true,
        disposition: true,
        durationSeconds: true,
        lead: { select: { status: true, currentStageId: true, pipeline: { select: { stages: { where: { isWon: true }, select: { id: true } } } } } },
      },
    });

    const byUser = new Map<
      string,
      { calls: number; connected: number; leadsWon: number; leadIds: Set<string> }
    >();
    for (const r of records) {
      const uid = r.userId;
      if (uid == null) continue;
      if (!byUser.has(uid)) {
        byUser.set(uid, { calls: 0, connected: 0, leadsWon: 0, leadIds: new Set() });
      }
      const u = byUser.get(uid)!;
      u.calls += 1;
      if (r.disposition === 'Connected' || (r.durationSeconds != null && r.durationSeconds > 0)) {
        u.connected += 1;
      }
      if (r.leadId != null) u.leadIds.add(r.leadId);
    }

    const wonStageIds = await this.prisma.pipelineStage.findMany({
      where: { isWon: true },
      select: { id: true },
    }).then((s) => s.map((x) => x.id));

    for (const [, u] of byUser) {
      u.leadsWon = [...u.leadIds].filter((leadId) => {
        const rec = records.find((r) => r.leadId === leadId);
        const lead = rec?.lead as { currentStageId?: string } | null;
        return lead != null && wonStageIds.includes(lead.currentStageId ?? '');
      }).length;
    }

    const userIds = [...byUser.keys()];
    const users = userIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, name: true, email: true },
        })
      : [];

    const data = userIds.map((uid) => {
      const u = byUser.get(uid)!;
      const user = users.find((x) => x.id === uid);
      return {
        userId: uid,
        userName: user?.name ?? user?.email ?? 'Unknown',
        calls: u.calls,
        connected: u.connected,
        connectRate: u.calls ? Math.round((u.connected / u.calls) * 100) : 0,
        uniqueLeads: u.leadIds.size,
        leadsWon: u.leadsWon,
        closeRate: u.leadIds.size ? Math.round((u.leadsWon / u.leadIds.size) * 100) : 0,
      };
    });

    const totals = records.length;
    const totalConnected = records.filter(
      (r) => r.disposition === 'Connected' || (r.durationSeconds != null && r.durationSeconds > 0),
    ).length;
    const totalWon = [...new Set(records.map((r) => r.leadId))].filter((leadId) => {
      const rec = records.find((r) => r.leadId === leadId);
      const lead = rec?.lead as { currentStageId?: string } | null;
      return lead && wonStageIds.includes(lead.currentStageId ?? '');
    }).length;
    const uniqueLeads = new Set(records.map((r) => r.leadId)).size;

    return {
      data,
      meta: {
        totalCalls: totals,
        totalConnected,
        connectRate: totals ? Math.round((totalConnected / totals) * 100) : 0,
        uniqueLeads,
        totalWon,
        closeRate: uniqueLeads ? Math.round((totalWon / uniqueLeads) * 100) : 0,
        fromDate: opts.fromDate,
        toDate: opts.toDate,
      },
    };
  }

  async getSms(opts: {
    userId?: string;
    fromDate?: string;
    toDate?: string;
    page?: number;
    limit?: number;
  }) {
    const page = Math.max(1, opts.page ?? 1);
    const limit = Math.min(100, Math.max(1, opts.limit ?? 20));
    const skip = (page - 1) * limit;

    const where: { userId?: string | null; createdAt?: { gte?: Date; lte?: Date } } = {};
    if (opts.userId) where.userId = opts.userId;
    if (opts.fromDate || opts.toDate) {
      const dateFilter: { gte?: Date; lte?: Date } = {};
      if (opts.fromDate) dateFilter.gte = new Date(opts.fromDate);
      if (opts.toDate) dateFilter.lte = new Date(opts.toDate);
      where.createdAt = dateFilter;
    }

    const [data, total] = await Promise.all([
      this.prisma.smsMessage.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          user: { select: { id: true, name: true, email: true } },
          lead: { select: { id: true, title: true } },
          contact: { select: { id: true, firstName: true, lastName: true, phone: true } },
        },
      }),
      this.prisma.smsMessage.count({ where }),
    ]);

    return {
      data: data.map((m) => ({
        id: m.id,
        userId: m.userId,
        user: m.user,
        leadId: m.leadId,
        lead: m.lead,
        contactId: m.contactId,
        contact: m.contact,
        direction: m.direction,
        body: m.body,
        fromNumber: m.fromNumber,
        toNumber: m.toNumber,
        status: m.status,
        createdAt: m.createdAt.toISOString(),
      })),
      meta: { total, page, limit },
    };
  }
}
