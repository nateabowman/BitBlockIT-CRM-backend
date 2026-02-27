import { Injectable, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

type Access = { role?: string; teamId?: string | null };

@Injectable()
export class ReportsService {
  constructor(private prisma: PrismaService) {}

  private leadAccessFilter(access?: Access): Record<string, unknown> {
    if (access?.role === 'sales_manager' && access?.teamId) {
      return { assignedTo: { teamId: access.teamId } };
    }
    return {};
  }

  private validatePipelineId(pipelineId: string | undefined): void {
    if (pipelineId && !/^[a-z0-9]{20,30}$/i.test(pipelineId)) {
      throw new BadRequestException('Invalid pipelineId format');
    }
  }

  async getFunnel(pipelineId: string, dateFrom?: string, dateTo?: string, access?: Access) {
    this.validatePipelineId(pipelineId);
    const where: Record<string, unknown> = {
      pipelineId,
      deletedAt: null,
      ...this.leadAccessFilter(access),
    };
    if (dateFrom || dateTo) {
      (where as Record<string, Record<string, Date>>).createdAt = {};
      if (dateFrom) (where as Record<string, Record<string, Date>>).createdAt.gte = new Date(dateFrom);
      if (dateTo) (where as Record<string, Record<string, Date>>).createdAt.lte = new Date(dateTo);
    }
    const stages = await this.prisma.pipelineStage.findMany({
      where: { pipelineId },
      orderBy: { order: 'asc' },
    });
    const counts = await Promise.all(
      stages.map(async (stage) => {
        const count = await this.prisma.lead.count({
          where: { ...where, currentStageId: stage.id, deletedAt: null },
        });
        return { stageId: stage.id, stageName: stage.name, count };
      }),
    );
    const total = counts.reduce((s, c) => s + c.count, 0);
    return {
      data: counts.map((c) => ({
        ...c,
        percentage: total ? Math.round((c.count / total) * 100) : 0,
      })),
      meta: { pipelineId, dateFrom, dateTo },
    };
  }

  async getActivitiesReport(userId?: string, dateFrom?: string, dateTo?: string, groupBy: 'user' | 'type' | 'day' = 'type', access?: Access) {
    if (access?.role === 'sales_manager' && access?.teamId && userId) {
      const targetUser = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { teamId: true },
      });
      if (!targetUser || targetUser.teamId !== access.teamId) {
        throw new ForbiddenException('You cannot view activities for users outside your team');
      }
    }
    const where: { userId?: string; createdAt?: { gte?: Date; lte?: Date }; user?: { teamId?: string } } = {};
    if (userId) where.userId = userId;
    if (access?.role === 'sales_manager' && access?.teamId) {
      where.user = { teamId: access.teamId };
    }
    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) where.createdAt.gte = new Date(dateFrom);
      if (dateTo) where.createdAt.lte = new Date(dateTo);
    }
    if (groupBy === 'type') {
      const byType = await this.prisma.activity.groupBy({
        by: ['type'],
        where,
        _count: true,
      });
      return { data: byType.map((r) => ({ type: r.type, count: r._count })) };
    }
    if (groupBy === 'user') {
      const byUser = await this.prisma.activity.groupBy({
        by: ['userId'],
        where,
        _count: true,
      });
      const userIds = byUser.map((r) => r.userId).filter(Boolean);
      const users = userIds.length
        ? await this.prisma.user.findMany({
            where: { id: { in: userIds } },
            select: { id: true, name: true },
          })
        : [];
      const nameMap = Object.fromEntries(users.map((u) => [u.id, u.name ?? 'Unknown']));
      return {
        data: byUser.map((r) => ({
          userId: r.userId,
          userName: nameMap[r.userId] ?? 'Unknown',
          count: r._count,
        })),
      };
    }
    const activities = await this.prisma.activity.findMany({
      where,
      select: { createdAt: true },
      take: 50000,
    });
    const byDay = activities.reduce((acc, a) => {
      const day = a.createdAt.toISOString().slice(0, 10);
      acc[day] = (acc[day] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    return { data: Object.entries(byDay).map(([day, count]) => ({ day, count })).sort((a, b) => a.day.localeCompare(b.day)) };
  }

  async getLeadsSummary(dateFrom?: string, dateTo?: string, access?: Access) {
    const where: Record<string, unknown> = { deletedAt: null, ...this.leadAccessFilter(access) };
    if (dateFrom || dateTo) {
      (where as Record<string, Record<string, Date>>).createdAt = {};
      if (dateFrom) (where as Record<string, Record<string, Date>>).createdAt.gte = new Date(dateFrom);
      if (dateTo) (where as Record<string, Record<string, Date>>).createdAt.lte = new Date(dateTo);
    }
    const [total, byStatus, bySource, won, lost] = await Promise.all([
      this.prisma.lead.count({ where }),
      this.prisma.lead.groupBy({ by: ['status'], where, _count: true }),
      this.prisma.lead.groupBy({ by: ['source'], where, _count: true }),
      this.prisma.lead.count({ where: { ...where, status: 'won' } }),
      this.prisma.lead.count({ where: { ...where, status: 'lost' } }),
    ]);
    const avgScore = await this.prisma.lead.aggregate({
      where,
      _avg: { score: true },
    });
    return {
      data: {
        total,
        won,
        lost,
        averageScore: avgScore._avg.score ? Math.round(avgScore._avg.score) : 0,
        byStatus: byStatus.map((s) => ({ status: s.status, count: s._count })),
        bySource: (bySource.filter((s) => s.source) as { source: string; _count: number }[]).map((s) => ({ source: s.source, count: s._count })),
      },
    };
  }

  /** Funnel for two date ranges (e.g. this month vs last month) */
  async getFunnelComparison(pipelineId: string, range1: { from: string; to: string }, range2: { from: string; to: string }, access?: Access) {
    const [funnel1, funnel2] = await Promise.all([
      this.getFunnel(pipelineId, range1.from, range1.to, access),
      this.getFunnel(pipelineId, range2.from, range2.to, access),
    ]);
    return {
      data: {
        range1: { label: `${range1.from} to ${range1.to}`, data: funnel1.data },
        range2: { label: `${range2.from} to ${range2.to}`, data: funnel2.data },
      },
    };
  }

  /** New leads per week (lead velocity) - uses raw SQL for DB-side aggregation */
  async getLeadVelocity(dateFrom?: string, dateTo?: string, pipelineId?: string, access?: Access) {
    this.validatePipelineId(pipelineId);
    const teamId = access?.role === 'sales_manager' ? access?.teamId : null;
    const conditions: string[] = ['l.deleted_at IS NULL'];
    const params: (string | Date)[] = [];
    let i = 1;
    if (dateFrom) {
      conditions.push(`l.created_at >= $${i}`);
      params.push(new Date(dateFrom));
      i++;
    }
    if (dateTo) {
      conditions.push(`l.created_at <= $${i}`);
      params.push(new Date(dateTo));
      i++;
    }
    if (pipelineId) {
      conditions.push(`l.pipeline_id = $${i}`);
      params.push(pipelineId);
      i++;
    }
    if (teamId) {
      conditions.push(`l.assigned_to_id IN (SELECT id FROM users WHERE team_id = $${i})`);
      params.push(teamId);
      i++;
    }
    const whereClause = conditions.join(' AND ');
    const rows = await this.prisma.$queryRawUnsafe<
      { week: string; count: bigint }[]
    >(
      `SELECT date_trunc('week', l.created_at AT TIME ZONE 'UTC')::date::text as week, COUNT(*)::bigint as count
       FROM leads l WHERE ${whereClause}
       GROUP BY date_trunc('week', l.created_at AT TIME ZONE 'UTC')
       ORDER BY week`,
      ...params,
    );
    const data = rows
      .map((r) => ({ week: r.week, count: Number(r.count) }))
      .sort((a, b) => a.week.localeCompare(b.week));
    return { data };
  }

  /** Win rate and count by source */
  async getWinRateBySource(dateFrom?: string, dateTo?: string, pipelineId?: string, access?: Access) {
    this.validatePipelineId(pipelineId);
    const where: Record<string, unknown> = { deletedAt: null, ...this.leadAccessFilter(access) };
    if (dateFrom || dateTo) {
      (where as Record<string, Record<string, Date>>).createdAt = {};
      if (dateFrom) (where as Record<string, Record<string, Date>>).createdAt.gte = new Date(dateFrom);
      if (dateTo) (where as Record<string, Record<string, Date>>).createdAt.lte = new Date(dateTo);
    }
    if (pipelineId) where.pipelineId = pipelineId;
    const rows = await this.prisma.lead.groupBy({
      by: ['source', 'status'],
      where,
      _count: true,
    });
    const bySource: Record<string, { total: number; won: number; lost: number }> = {};
    for (const r of rows) {
      const src = r.source ?? '_unknown';
      if (!bySource[src]) bySource[src] = { total: 0, won: 0, lost: 0 };
      bySource[src].total += r._count;
      if (r.status === 'won') bySource[src].won += r._count;
      if (r.status === 'lost') bySource[src].lost += r._count;
    }
    const data = Object.entries(bySource).map(([source, v]) => ({
      source: source === '_unknown' ? null : source,
      total: v.total,
      won: v.won,
      lost: v.lost,
      winRate: v.total ? Math.round((v.won / v.total) * 100) : 0,
    }));
    return { data };
  }

  /** Average days from created to won/lost by pipeline - uses raw SQL for DB-side aggregation */
  async getAvgTimeToClose(pipelineId?: string, dateFrom?: string, dateTo?: string, access?: Access) {
    this.validatePipelineId(pipelineId);
    const teamId = access?.role === 'sales_manager' ? access?.teamId : null;
    const conditions: string[] = [
      'l.deleted_at IS NULL',
      "l.status IN ('won', 'lost')",
      'l.closed_at IS NOT NULL',
    ];
    const params: (string | Date)[] = [];
    let i = 1;
    if (dateFrom) {
      conditions.push(`l.closed_at >= $${i}`);
      params.push(new Date(dateFrom));
      i++;
    }
    if (dateTo) {
      conditions.push(`l.closed_at <= $${i}`);
      params.push(new Date(dateTo));
      i++;
    }
    if (pipelineId) {
      conditions.push(`l.pipeline_id = $${i}`);
      params.push(pipelineId);
      i++;
    }
    if (teamId) {
      conditions.push(`l.assigned_to_id IN (SELECT id FROM users WHERE team_id = $${i})`);
      params.push(teamId);
      i++;
    }
    const whereClause = conditions.join(' AND ');
    const rows = await this.prisma.$queryRawUnsafe<
      { pipeline_id: string; pipeline_name: string; avg_days: number; count: bigint }[]
    >(
      `SELECT l.pipeline_id, p.name as pipeline_name,
              ROUND(AVG(EXTRACT(EPOCH FROM (l.closed_at - l.created_at)) / 86400))::int as avg_days,
              COUNT(*)::bigint as count
       FROM leads l JOIN pipelines p ON l.pipeline_id = p.id
       WHERE ${whereClause}
       GROUP BY l.pipeline_id, p.name`,
      ...params,
    );
    return {
      data: rows.map((r) => ({
        pipelineId: r.pipeline_id,
        pipelineName: r.pipeline_name,
        avgDays: r.avg_days ?? 0,
        count: Number(r.count),
      })),
    };
  }

  /** Cohort: leads created by week, how many won/lost over time - uses raw SQL for DB-side aggregation */
  async getCohortReport(dateFrom?: string, dateTo?: string, pipelineId?: string, access?: Access) {
    this.validatePipelineId(pipelineId);
    const teamId = access?.role === 'sales_manager' ? access?.teamId : null;
    const conditions: string[] = ['l.deleted_at IS NULL'];
    const params: (string | Date)[] = [];
    let i = 1;
    if (dateFrom) {
      conditions.push(`l.created_at >= $${i}`);
      params.push(new Date(dateFrom));
      i++;
    }
    if (dateTo) {
      conditions.push(`l.created_at <= $${i}`);
      params.push(new Date(dateTo));
      i++;
    }
    if (pipelineId) {
      conditions.push(`l.pipeline_id = $${i}`);
      params.push(pipelineId);
      i++;
    }
    if (teamId) {
      conditions.push(`l.assigned_to_id IN (SELECT id FROM users WHERE team_id = $${i})`);
      params.push(teamId);
      i++;
    }
    const whereClause = conditions.join(' AND ');
    const rows = await this.prisma.$queryRawUnsafe<
      { week: string; created: bigint; won: bigint; lost: bigint }[]
    >(
      `SELECT date_trunc('week', l.created_at AT TIME ZONE 'UTC')::date::text as week,
              COUNT(*)::bigint as created,
              COUNT(*) FILTER (WHERE l.status = 'won')::bigint as won,
              COUNT(*) FILTER (WHERE l.status = 'lost')::bigint as lost
       FROM leads l WHERE ${whereClause}
       GROUP BY date_trunc('week', l.created_at AT TIME ZONE 'UTC')
       ORDER BY week`,
      ...params,
    );
    const data = rows
      .map((r) => ({
        week: r.week,
        created: Number(r.created),
        won: Number(r.won),
        lost: Number(r.lost),
      }))
      .sort((a, b) => a.week.localeCompare(b.week));
    return { data };
  }

  /** Renewal forecast: pipelines with type=renewal, sum of lead amounts by stage and total */
  async getRenewalForecast(access?: Access) {
    const pipelines = await this.prisma.pipeline.findMany({
      where: { type: 'renewal' },
      include: { stages: { orderBy: { order: 'asc' } } },
    });
    const result = await Promise.all(
      pipelines.map(async (pipeline) => {
        const byStage = await Promise.all(
          pipeline.stages.map(async (stage) => {
            const agg = await this.prisma.lead.aggregate({
              where: { pipelineId: pipeline.id, currentStageId: stage.id, deletedAt: null, ...this.leadAccessFilter(access) },
              _sum: { amount: true },
              _count: true,
            });
            const sum = agg._sum.amount ? Number(agg._sum.amount) : 0;
            return { stageId: stage.id, stageName: stage.name, count: agg._count, totalAmount: sum };
          }),
        );
        const totalAmount = byStage.reduce((s, r) => s + r.totalAmount, 0);
        const totalCount = byStage.reduce((s, r) => s + r.count, 0);
        return {
          pipelineId: pipeline.id,
          pipelineName: pipeline.name,
          byStage,
          totalAmount,
          totalCount,
        };
      }),
    );
    const grandTotal = result.reduce((s, r) => s + r.totalAmount, 0);
    return { data: result, meta: { grandTotal } };
  }

  /** Attribution: leads by source with total and won counts (first-touch style) */
  async getAttributionReport(dateFrom?: string, dateTo?: string, pipelineId?: string, access?: Access) {
    this.validatePipelineId(pipelineId);
    const where: Record<string, unknown> = { deletedAt: null, ...this.leadAccessFilter(access) };
    if (dateFrom || dateTo) {
      (where as Record<string, Record<string, Date>>).createdAt = {};
      if (dateFrom) (where as Record<string, Record<string, Date>>).createdAt.gte = new Date(dateFrom);
      if (dateTo) (where as Record<string, Record<string, Date>>).createdAt.lte = new Date(dateTo);
    }
    if (pipelineId) where.pipelineId = pipelineId;
    const rows = await this.prisma.lead.groupBy({
      by: ['source'],
      where,
      _count: true,
    });
    const wonCounts = await Promise.all(
      rows.map((r) =>
        this.prisma.lead.count({
          where: { ...where, source: r.source ?? undefined, status: 'won' },
        }),
      ),
    );
    const data = rows.map((r, i) => ({
      source: r.source ?? '(none)',
      leadCount: r._count,
      wonCount: wonCounts[i] ?? 0,
    }));
    return { data, meta: { dateFrom, dateTo, pipelineId } };
  }

  /** UTM report: leads grouped by utm_source, utm_medium, utm_campaign */
  async getUtmReport(dateFrom?: string, dateTo?: string, access?: Access) {
    const where: Record<string, unknown> = { deletedAt: null, ...this.leadAccessFilter(access) };
    if (dateFrom || dateTo) {
      (where as Record<string, Record<string, Date>>).createdAt = {};
      if (dateFrom) (where as Record<string, Record<string, Date>>).createdAt.gte = new Date(dateFrom);
      if (dateTo) (where as Record<string, Record<string, Date>>).createdAt.lte = new Date(dateTo);
    }
    const rows = await this.prisma.lead.groupBy({
      by: ['utmSource', 'utmMedium', 'utmCampaign'],
      where,
      _count: true,
    });
    const data = rows.map((r) => ({
      utmSource: r.utmSource ?? '(none)',
      utmMedium: r.utmMedium ?? '(none)',
      utmCampaign: r.utmCampaign ?? '(none)',
      leadCount: r._count,
    }));
    return { data, meta: { dateFrom, dateTo } };
  }

  /** Source attribution: leads by source with conversion (won) count */
  async getSourceAttributionReport(dateFrom?: string, dateTo?: string, pipelineId?: string, access?: Access) {
    const where: Record<string, unknown> = { deletedAt: null, ...this.leadAccessFilter(access) };
    if (dateFrom || dateTo) {
      const createdAt: { gte?: Date; lte?: Date } = {};
      if (dateFrom) createdAt.gte = new Date(dateFrom);
      if (dateTo) createdAt.lte = new Date(dateTo);
      (where as Record<string, unknown>).createdAt = createdAt;
    }
    if (pipelineId) (where as Record<string, unknown>).pipelineId = pipelineId;
    const bySource = await this.prisma.lead.groupBy({
      by: ['source'],
      where,
      _count: true,
    });
    const wonStageIds = await this.prisma.pipelineStage.findMany({
      where: { isWon: true },
      select: { id: true },
    }).then((s) => s.map((x) => x.id));
    const wonCounts = await Promise.all(
      bySource.map((r) =>
        this.prisma.lead.count({
          where: {
            ...where,
            source: r.source,
            currentStageId: { in: wonStageIds },
          },
        }),
      ),
    );
    const data = bySource.map((r, i) => ({
      source: r.source ?? '(none)',
      leadCount: r._count,
      wonCount: wonCounts[i] ?? 0,
    }));
    return { data, meta: { dateFrom, dateTo, pipelineId } };
  }

  /** Campaign comparison: open rate, click rate for two campaigns side-by-side */
  async getCampaignComparison(campaignIdA: string, campaignIdB: string) {
    if (!campaignIdA?.trim() || !campaignIdB?.trim()) {
      throw new BadRequestException('campaignIdA and campaignIdB are required');
    }
    const [campA, campB] = await Promise.all([
      this.prisma.campaign.findUnique({ where: { id: campaignIdA }, include: { sends: { where: { sentAt: { not: null } }, select: { id: true } } } }),
      this.prisma.campaign.findUnique({ where: { id: campaignIdB }, include: { sends: { where: { sentAt: { not: null } }, select: { id: true } } } }),
    ]);
    if (!campA) throw new BadRequestException('Campaign A not found');
    if (!campB) throw new BadRequestException('Campaign B not found');
    const sendIdsA = campA.sends.map((s) => s.id);
    const sendIdsB = campB.sends.map((s) => s.id);
    const [opensA, clicksA, opensB, clicksB] = await Promise.all([
      this.prisma.emailTrackingEvent.count({ where: { campaignSendId: { in: sendIdsA }, type: 'open' } }),
      this.prisma.emailTrackingEvent.count({ where: { campaignSendId: { in: sendIdsA }, type: 'click' } }),
      this.prisma.emailTrackingEvent.count({ where: { campaignSendId: { in: sendIdsB }, type: 'open' } }),
      this.prisma.emailTrackingEvent.count({ where: { campaignSendId: { in: sendIdsB }, type: 'click' } }),
    ]);
    const sentA = sendIdsA.length;
    const sentB = sendIdsB.length;
    const build = (name: string, sent: number, opens: number, clicks: number) => ({
      name,
      sent,
      opened: opens,
      clicked: clicks,
      openRate: sent ? Math.round((opens / sent) * 100) : 0,
      clickRate: sent ? Math.round((clicks / sent) * 100) : 0,
    });
    return {
      data: {
        campaignA: build(campA.name, sentA, opensA, clicksA),
        campaignB: build(campB.name, sentB, opensB, clicksB),
      },
      meta: { campaignIdA, campaignIdB },
    };
  }

  /** Marketing dashboard widgets: sends, opens, clicks, form submissions, bounce count */
  async getMarketingDashboard(days = 30) {
    const since = new Date();
    since.setDate(since.getDate() - days);
    const [
      sendsCount,
      openCount,
      clickCount,
      campaignsSent,
      contactCount,
      bouncedCount,
      formSubmissionsCount,
    ] = await Promise.all([
      this.prisma.campaignSend.count({ where: { sentAt: { gte: since } } }),
      this.prisma.emailTrackingEvent.count({
        where: { type: 'open', createdAt: { gte: since } },
      }),
      this.prisma.emailTrackingEvent.count({
        where: { type: 'click', createdAt: { gte: since } },
      }),
      this.prisma.campaign.count({ where: { status: 'sent', sentAt: { gte: since } } }),
      this.prisma.contact.count({ where: { unsubscribedAt: null, bouncedAt: null, dncAt: null } }),
      this.prisma.contact.count({ where: { bouncedAt: { not: null } } }),
      this.prisma.lead.count({
        where: { source: 'Form', createdAt: { gte: since } },
      }),
    ]);
    const totalContacts = await this.prisma.contact.count();
    return {
      data: {
        sendsLastNDays: sendsCount,
        opensLastNDays: openCount,
        clicksLastNDays: clickCount,
        campaignsSentLastNDays: campaignsSent,
        activeContacts: contactCount,
        bouncedContacts: bouncedCount,
        formSubmissionsLastNDays: formSubmissionsCount,
        totalContacts,
        openRate: sendsCount > 0 ? Math.round((openCount / sendsCount) * 100) : 0,
        clickRate: sendsCount > 0 ? Math.round((clickCount / sendsCount) * 100) : 0,
      },
      meta: { days, since: since.toISOString() },
    };
  }

  /** Export tracking events (open/click) for BI; optional filters, pagination, CSV or JSON */
  async getTrackingEventsExport(
    opts: { campaignId?: string; type?: string; dateFrom?: string; dateTo?: string; page?: number; limit?: number; format?: 'json' | 'csv' },
  ) {
    const page = Math.max(1, opts.page ?? 1);
    const limit = Math.min(1000, Math.max(1, opts.limit ?? 100));
    const skip = (page - 1) * limit;
    const where: Record<string, unknown> = {};
    if (opts.campaignId) {
      (where as Record<string, unknown>).campaignSend = { campaignId: opts.campaignId };
    }
    if (opts.type === 'open' || opts.type === 'click') {
      (where as Record<string, unknown>).type = opts.type;
    }
    if (opts.dateFrom || opts.dateTo) {
      const createdAt: { gte?: Date; lte?: Date } = {};
      if (opts.dateFrom) createdAt.gte = new Date(opts.dateFrom);
      if (opts.dateTo) createdAt.lte = new Date(opts.dateTo);
      (where as Record<string, unknown>).createdAt = createdAt;
    }
    const [events, total] = await Promise.all([
      this.prisma.emailTrackingEvent.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          campaignSend: {
            select: {
              email: true,
              campaignId: true,
              campaign: { select: { name: true } },
            },
          },
          trackingLink: { select: { url: true } },
        },
      }),
      this.prisma.emailTrackingEvent.count({ where }),
    ]);
    const rows = events.map((e) => ({
      id: e.id,
      type: e.type,
      campaignId: e.campaignSend?.campaignId ?? '',
      campaignName: e.campaignSend?.campaign?.name ?? '',
      email: e.campaignSend?.email ?? '',
      url: e.trackingLink?.url ?? '',
      createdAt: e.createdAt.toISOString(),
    }));
    if (opts.format === 'csv') {
      const headers = ['id', 'type', 'campaignId', 'campaignName', 'email', 'url', 'createdAt'];
      const lines = [
        headers.join(','),
        ...rows.map((r) =>
          headers.map((h) => `"${String((r as Record<string, string>)[h] ?? '').replace(/"/g, '""')}"`).join(','),
        ),
      ];
      return { data: lines.join('\n'), contentType: 'text/csv', total };
    }
    return {
      data: { items: rows, total, page, limit },
    };
  }

  /**
   * Aggregate dashboard for Revenue Intelligence (e.g. bitblockit.com admin).
   * No PII; safe to expose via API key.
   */
  async getRevenueIntelligenceDashboard() {
    const defaultPipeline = await this.prisma.pipeline.findFirst({
      where: { isDefault: true, type: 'lead' },
      include: { stages: { orderBy: { order: 'asc' }, select: { id: true, name: true, order: true } } },
    });

    let funnel: { stageId: string; stageName: string; count: number; order: number }[] = [];
    if (defaultPipeline?.stages.length) {
      const stageIds = defaultPipeline.stages.map((s) => s.id);
      const counts = await Promise.all(
        stageIds.map(async (stageId) => {
          const count = await this.prisma.lead.count({
            where: { pipelineId: defaultPipeline.id, currentStageId: stageId, deletedAt: null },
          });
          const stage = defaultPipeline.stages.find((s) => s.id === stageId);
          return { stageId, stageName: stage?.name ?? stageId, count, order: stage?.order ?? 0 };
        }),
      );
      funnel = counts.sort((a, b) => a.order - b.order);
    }

    const sourceAttribution = await this.getSourceAttributionReport(undefined, undefined, defaultPipeline?.id);
    const marketing = await this.getMarketingDashboard(30);
    const wonStageIds = await this.prisma.pipelineStage.findMany({
      where: { isWon: true },
      select: { id: true },
    }).then((s) => s.map((x) => x.id));
    const totalWon = defaultPipeline
      ? await this.prisma.lead.count({
          where: { pipelineId: defaultPipeline.id, currentStageId: { in: wonStageIds }, deletedAt: null },
        })
      : 0;
    const totalLeads = defaultPipeline
      ? await this.prisma.lead.count({ where: { pipelineId: defaultPipeline.id, deletedAt: null } })
      : 0;

    const callRecords = await this.prisma.callRecord.findMany({
      where: { createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } },
      select: {
        userId: true,
        leadId: true,
        disposition: true,
        durationSeconds: true,
        lead: { select: { currentStageId: true } },
      },
    });
    const byUser = new Map<string, { calls: number; connected: number; leadIds: Set<string> }>();
    for (const r of callRecords) {
      if (r.userId == null) continue;
      const u = byUser.get(r.userId) ?? { calls: 0, connected: 0, leadIds: new Set<string>() };
      u.calls += 1;
      if (r.disposition === 'Connected' || (r.durationSeconds != null && r.durationSeconds > 0)) u.connected += 1;
      if (r.leadId != null) u.leadIds.add(r.leadId);
      byUser.set(r.userId, u);
    }
    const callStatsByRep = await Promise.all(
      [...byUser.entries()].map(async ([uid, u]) => {
        const user = await this.prisma.user.findUnique({
          where: { id: uid },
          select: { name: true, email: true },
        });
        const leadsWon = [...u.leadIds].filter((leadId) => {
          const rec = callRecords.find((r) => r.leadId === leadId);
          const lead = rec?.lead as { currentStageId?: string } | null;
          return lead != null && wonStageIds.includes(lead.currentStageId ?? '');
        }).length;
        return {
          userId: uid,
          userName: user?.name ?? user?.email ?? 'Unknown',
          calls: u.calls,
          connected: u.connected,
          connectRate: u.calls ? Math.round((u.connected / u.calls) * 100) : 0,
          uniqueLeads: u.leadIds.size,
          leadsWon,
          closeRate: u.leadIds.size ? Math.round((leadsWon / u.leadIds.size) * 100) : 0,
        };
      }),
    );
    const totalCalls = callRecords.length;
    const totalConnected = callRecords.filter(
      (r) => r.disposition === 'Connected' || (r.durationSeconds != null && r.durationSeconds > 0),
    ).length;
    const uniqueLeadsCalled = new Set(callRecords.map((r) => r.leadId).filter((id): id is string => id != null)).size;
    const totalWonFromCalls = [...new Set(callRecords.map((r) => r.leadId).filter((id): id is string => id != null))].filter((leadId) => {
      const rec = callRecords.find((r) => r.leadId === leadId);
      const lead = rec?.lead as { currentStageId?: string } | null;
      return lead != null && wonStageIds.includes(lead.currentStageId ?? '');
    }).length;

    const campaigns = await this.prisma.campaign.findMany({
      where: { status: 'sent' },
      orderBy: { sentAt: 'desc' },
      take: 20,
      select: {
        id: true,
        name: true,
        status: true,
        sentAt: true,
        _count: { select: { sends: true } },
      },
    });
    const campaignSummaries = await Promise.all(
      campaigns.map(async (c) => {
        const sent = c._count.sends;
        const sends = await this.prisma.campaignSend.findMany({
          where: { campaignId: c.id, sentAt: { not: null } },
          select: { id: true },
        });
        const sendIds = sends.map((s) => s.id);
        const [opens, clicks] = await Promise.all([
          this.prisma.emailTrackingEvent.count({ where: { campaignSendId: { in: sendIds }, type: 'open' } }),
          this.prisma.emailTrackingEvent.count({ where: { campaignSendId: { in: sendIds }, type: 'click' } }),
        ]);
        return {
          id: c.id,
          name: c.name,
          status: c.status,
          sentAt: c.sentAt?.toISOString() ?? null,
          sent,
          opens,
          clicks,
          openRate: sent ? Math.round((opens / sent) * 100) : 0,
          clickRate: sent ? Math.round((clicks / sent) * 100) : 0,
        };
      }),
    );

    return {
      funnel: { pipelineId: defaultPipeline?.id ?? null, pipelineName: defaultPipeline?.name ?? null, stages: funnel },
      conversion: {
        totalLeads,
        totalWon,
        conversionRate: totalLeads ? Math.round((totalWon / totalLeads) * 100) : 0,
      },
      leadSources: sourceAttribution.data,
      marketing: (marketing as { data?: Record<string, unknown> }).data ?? {},
      callStats: {
        totalCalls,
        totalConnected,
        connectRate: totalCalls ? Math.round((totalConnected / totalCalls) * 100) : 0,
        uniqueLeadsCalled,
        totalWonFromCalls,
        closeRate: uniqueLeadsCalled ? Math.round((totalWonFromCalls / uniqueLeadsCalled) * 100) : 0,
        byRep: callStatsByRep,
      },
      campaigns: campaignSummaries,
      meta: { generatedAt: new Date().toISOString() },
    };
  }

  async getRepScorecard(params: { dateFrom?: string; dateTo?: string }, access?: Access) {
    const where: Record<string, unknown> = { deletedAt: null };
    if (access?.role === 'sales_manager' && access?.teamId) {
      where.assignedTo = { teamId: access.teamId };
    }
    if (params.dateFrom || params.dateTo) {
      where.createdAt = {
        ...(params.dateFrom ? { gte: new Date(params.dateFrom) } : {}),
        ...(params.dateTo ? { lte: new Date(params.dateTo) } : {}),
      };
    }

    const users = await this.prisma.user.findMany({
      where: { isActive: true },
      select: { id: true, name: true, email: true },
    });

    const scorecard = await Promise.all(
      users.map(async (user) => {
        const [total, won, lost, activityCount] = await Promise.all([
          this.prisma.lead.count({ where: { ...where, assignedToId: user.id } }),
          this.prisma.lead.count({ where: { ...where, assignedToId: user.id, status: 'won' } }),
          this.prisma.lead.count({ where: { ...where, assignedToId: user.id, status: 'lost' } }),
          this.prisma.activity.count({
            where: {
              userId: user.id,
              ...(params.dateFrom || params.dateTo ? {
                createdAt: {
                  ...(params.dateFrom ? { gte: new Date(params.dateFrom) } : {}),
                  ...(params.dateTo ? { lte: new Date(params.dateTo) } : {}),
                },
              } : {}),
            },
          }),
        ]);

        const avgDealSize = await this.prisma.lead.aggregate({
          where: { ...where, assignedToId: user.id, status: 'won', amount: { not: null } },
          _avg: { amount: true },
        });

        return {
          userId: user.id,
          userName: user.name ?? user.email,
          total,
          won,
          lost,
          winRate: total > 0 ? Math.round((won / total) * 100) : 0,
          activityCount,
          avgDealSize: avgDealSize._avg.amount ? Number(avgDealSize._avg.amount) : 0,
        };
      })
    );

    return scorecard.filter((r) => r.total > 0 || r.activityCount > 0).sort((a, b) => b.winRate - a.winRate);
  }

  async getDealSlippage(params: { dateFrom?: string }, access?: Access) {
    const cutoff = params.dateFrom ? new Date(params.dateFrom) : new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const where: Record<string, unknown> = {
      deletedAt: null,
      status: { notIn: ['won', 'lost'] },
      expectedCloseAt: { lt: new Date() },
    };
    if (access?.role === 'sales_manager' && access?.teamId) {
      (where as Record<string, unknown>).assignedTo = { teamId: access.teamId };
    }

    const slipped = await this.prisma.lead.findMany({
      where: where as Parameters<typeof this.prisma.lead.findMany>[0]['where'],
      take: 50,
      orderBy: { expectedCloseAt: 'asc' },
      include: {
        currentStage: true,
        organization: true,
        assignedTo: { select: { id: true, name: true } },
      },
    });

    return slipped.map((l) => ({
      id: l.id,
      title: l.title,
      expectedCloseAt: l.expectedCloseAt,
      daysOverdue: l.expectedCloseAt ? Math.floor((Date.now() - l.expectedCloseAt.getTime()) / 86400000) : 0,
      amount: l.amount ? Number(l.amount) : null,
      currency: l.currency,
      stage: l.currentStage?.name,
      organization: l.organization?.name,
      assignedTo: l.assignedTo?.name,
    }));
  }

  async getPipelineCoverage(pipelineId?: string, access?: Access) {
    const where: Record<string, unknown> = {
      deletedAt: null,
      status: { notIn: ['won', 'lost'] },
    };
    if (pipelineId) where.pipelineId = pipelineId;
    if (access?.role === 'sales_manager' && access?.teamId) {
      (where as Record<string, unknown>).assignedTo = { teamId: access.teamId };
    }

    const result = await this.prisma.lead.aggregate({
      where: where as Parameters<typeof this.prisma.lead.aggregate>[0]['where'],
      _sum: { amount: true },
      _count: { id: true },
    });

    return {
      openPipelineValue: result._sum.amount ? Number(result._sum.amount) : 0,
      openLeadCount: result._count.id,
    };
  }

  async getLeadsByAssignee(params: { dateFrom?: string; dateTo?: string }, access?: Access) {
    const where: Record<string, unknown> = { deletedAt: null };
    if (access?.role === 'sales_manager' && access?.teamId) {
      where.assignedTo = { teamId: access.teamId };
    }
    if (params.dateFrom || params.dateTo) {
      where.createdAt = {
        ...(params.dateFrom ? { gte: new Date(params.dateFrom) } : {}),
        ...(params.dateTo ? { lte: new Date(params.dateTo) } : {}),
      };
    }

    const grouped = await this.prisma.lead.groupBy({
      by: ['assignedToId'],
      where: where as Parameters<typeof this.prisma.lead.groupBy>[0]['where'],
      _count: { id: true },
    });

    const userIds = grouped.map((g) => g.assignedToId).filter(Boolean) as string[];
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, name: true },
    });

    const wonGroups = await this.prisma.lead.groupBy({
      by: ['assignedToId'],
      where: { ...where, status: 'won' } as Parameters<typeof this.prisma.lead.groupBy>[0]['where'],
      _count: { id: true },
    });

    return grouped.map((g) => {
      const user = users.find((u) => u.id === g.assignedToId);
      const wonCount = wonGroups.find((w) => w.assignedToId === g.assignedToId)?._count.id ?? 0;
      return {
        userId: g.assignedToId,
        userName: user?.name ?? 'Unassigned',
        total: g._count.id,
        won: wonCount,
        lost: 0,
      };
    }).sort((a, b) => b.total - a.total);
  }

  async getEmailFatigue(windowDays = 7, threshold = 3) {
    const cutoff = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
    const sends = await this.prisma.campaignSend.groupBy({
      by: ['contactId'],
      where: { sentAt: { gte: cutoff }, contactId: { not: null } },
      _count: { id: true },
    });
    const fatigued = sends.filter((s) => s._count.id >= threshold);
    const contactIds = fatigued.map((s) => s.contactId).filter(Boolean) as string[];
    const contacts = await this.prisma.contact.findMany({
      where: { id: { in: contactIds } },
      select: { id: true, firstName: true, lastName: true, email: true },
    });
    return {
      windowDays,
      threshold,
      total: sends.length,
      fatigued: fatigued.length,
      fatiguedRate: sends.length > 0 ? parseFloat(((fatigued.length / sends.length) * 100).toFixed(1)) : 0,
      contacts: contacts.map((c) => ({
        id: c.id,
        name: `${c.firstName} ${c.lastName}`.trim(),
        email: c.email,
        emailsReceived: fatigued.find((f) => f.contactId === c.id)?._count.id ?? 0,
      })).sort((a, b) => b.emailsReceived - a.emailsReceived),
    };
  }

  async getMarketingAttribution(model: string, params: { dateFrom?: string; dateTo?: string }, access?: Access) {
    const where: Record<string, unknown> = { deletedAt: null };
    if (params.dateFrom || params.dateTo) {
      where.createdAt = {
        ...(params.dateFrom ? { gte: new Date(params.dateFrom) } : {}),
        ...(params.dateTo ? { lte: new Date(params.dateTo) } : {}),
      };
    }
    const leads = await this.prisma.lead.findMany({
      where: where as Parameters<typeof this.prisma.lead.findMany>[0]['where'],
      select: { id: true, source: true, status: true, amount: true, utmSource: true, utmMedium: true, utmCampaign: true },
    });

    const bySource: Record<string, { source: string; leads: number; won: number; revenue: number }> = {};
    for (const lead of leads) {
      const key = lead.utmSource ?? lead.source ?? 'Direct';
      if (!bySource[key]) bySource[key] = { source: key, leads: 0, won: 0, revenue: 0 };
      bySource[key].leads++;
      if (lead.status === 'won') {
        bySource[key].won++;
        bySource[key].revenue += lead.amount ? Number(lead.amount) : 0;
      }
    }

    return {
      model,
      attribution: Object.values(bySource)
        .sort((a, b) => b.revenue - a.revenue)
        .map((s) => ({
          ...s,
          winRate: s.leads > 0 ? Math.round((s.won / s.leads) * 100) : 0,
          revenueShare: leads.filter((l) => l.status === 'won').length > 0
            ? Math.round((s.won / leads.filter((l) => l.status === 'won').length) * 100)
            : 0,
        })),
    };
  }

  async getAbSignificance(campaignId: string) {
    const sends = await this.prisma.campaignSend.findMany({
      where: { campaignId, sentAt: { not: null } },
      select: { id: true, variant: true },
    });
    const events = await this.prisma.emailTrackingEvent.findMany({
      where: { campaignSendId: { in: sends.map((s) => s.id) }, type: 'open' },
      select: { campaignSendId: true },
    });
    const openedIds = new Set(events.map((e) => e.campaignSendId));

    const variants: Record<string, { sent: number; opens: number }> = {};
    for (const s of sends) {
      const v = s.variant ?? 'A';
      if (!variants[v]) variants[v] = { sent: 0, opens: 0 };
      variants[v].sent++;
      if (openedIds.has(s.id)) variants[v].opens++;
    }

    const variantList = Object.entries(variants).map(([name, data]) => ({
      name,
      sent: data.sent,
      opens: data.opens,
      openRate: data.sent > 0 ? parseFloat(((data.opens / data.sent) * 100).toFixed(1)) : 0,
    }));

    // Chi-squared test for significance (2-variant)
    let chiSquared: number | null = null;
    let pValue: number | null = null;
    let significant = false;
    if (variantList.length === 2) {
      const [a, b] = variantList;
      const total = a.sent + b.sent;
      const totalOpens = a.opens + b.opens;
      const expectedA = (a.sent / total) * totalOpens;
      const expectedB = (b.sent / total) * totalOpens;
      if (expectedA > 0 && expectedB > 0) {
        chiSquared = Math.pow(a.opens - expectedA, 2) / expectedA + Math.pow(b.opens - expectedB, 2) / expectedB;
        // Approximate p-value (chi-squared with 1 df)
        pValue = Math.exp(-chiSquared / 2);
        significant = chiSquared > 3.841; // p < 0.05
      }
    }

    return {
      campaignId,
      variants: variantList,
      chiSquared,
      pValue,
      significant,
      confidence: pValue ? Math.round((1 - pValue) * 100) : null,
      winner: significant && variantList.length === 2 ? (variantList[0].openRate > variantList[1].openRate ? variantList[0].name : variantList[1].name) : null,
    };
  }

  async getCompetitiveWinLoss(access?: Access) {
    const where: Record<string, unknown> = { deletedAt: null, status: { in: ['won', 'lost'] } };
    if (access?.role === 'sales_manager' && access?.teamId) {
      where.assignedTo = { teamId: access.teamId };
    }
    const leads = await this.prisma.lead.findMany({
      where: where as Parameters<typeof this.prisma.lead.findMany>[0]['where'],
      select: { id: true, status: true, amount: true, customFields: true },
    });

    const byCompetitor: Record<string, { name: string; mentioned: number; won: number; lost: number }> = {};
    for (const lead of leads) {
      const cf = lead.customFields as Record<string, unknown> | null;
      const competitors = (cf?.competitors as { name: string; status: string }[] | undefined) ?? [];
      for (const c of competitors) {
        if (!byCompetitor[c.name]) byCompetitor[c.name] = { name: c.name, mentioned: 0, won: 0, lost: 0 };
        byCompetitor[c.name].mentioned++;
        if (lead.status === 'won') byCompetitor[c.name].won++;
        if (lead.status === 'lost' && c.status === 'lost_to') byCompetitor[c.name].lost++;
      }
    }

    return Object.values(byCompetitor)
      .sort((a, b) => b.mentioned - a.mentioned)
      .map((c) => ({
        ...c,
        winRate: c.won + c.lost > 0 ? Math.round((c.won / (c.won + c.lost)) * 100) : 0,
      }));
  }

  async getGoalVsActual(period: string, access?: Access) {
    const now = new Date();
    let start: Date, end: Date;
    if (period === 'quarterly') {
      const q = Math.floor(now.getMonth() / 3);
      start = new Date(now.getFullYear(), q * 3, 1);
      end = new Date(now.getFullYear(), q * 3 + 3, 0);
    } else {
      start = new Date(now.getFullYear(), now.getMonth(), 1);
      end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    }

    const where: Record<string, unknown> = {
      deletedAt: null,
      status: 'won',
      closedAt: { gte: start, lte: end },
    };
    if (access?.role === 'sales_manager' && access?.teamId) {
      where.assignedTo = { teamId: access.teamId };
    }

    const [wonLeads, totalLeads] = await Promise.all([
      this.prisma.lead.findMany({
        where: where as Parameters<typeof this.prisma.lead.findMany>[0]['where'],
        select: { amount: true },
      }),
      this.prisma.lead.count({
        where: { ...where, status: undefined, closedAt: undefined, createdAt: { gte: start, lte: end } } as Parameters<typeof this.prisma.lead.count>[0]['where'],
      }),
    ]);

    const actualRevenue = wonLeads.reduce((s, l) => s + (l.amount ? Number(l.amount) : 0), 0);
    const wonCount = wonLeads.length;

    return {
      period,
      start: start.toISOString().slice(0, 10),
      end: end.toISOString().slice(0, 10),
      actual: { revenue: actualRevenue, deals: wonCount, leads: totalLeads },
    };
  }

  async getActivityCompletionRate(params: { dateFrom?: string; dateTo?: string }, access?: Access) {
    const where: Record<string, unknown> = {};
    if (params.dateFrom || params.dateTo) {
      where.scheduledAt = {
        ...(params.dateFrom ? { gte: new Date(params.dateFrom) } : {}),
        ...(params.dateTo ? { lte: new Date(params.dateTo) } : {}),
      };
    }
    const [total, completed] = await Promise.all([
      this.prisma.activity.count({ where: where as Parameters<typeof this.prisma.activity.count>[0]['where'] }),
      this.prisma.activity.count({ where: { ...(where as Parameters<typeof this.prisma.activity.count>[0]['where']), completedAt: { not: null } } }),
    ]);
    const byUser = await this.prisma.activity.groupBy({
      by: ['userId'],
      where: where as Parameters<typeof this.prisma.activity.groupBy>[0]['where'],
      _count: { id: true },
    });
    const completedByUser = await this.prisma.activity.groupBy({
      by: ['userId'],
      where: { ...(where as Parameters<typeof this.prisma.activity.groupBy>[0]['where']), completedAt: { not: null } },
      _count: { id: true },
    });
    const userIds = byUser.map((u) => u.userId);
    const users = await this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } });
    const byUserStats = byUser.map((u) => {
      const comp = completedByUser.find((c) => c.userId === u.userId)?._count.id ?? 0;
      const user = users.find((usr) => usr.id === u.userId);
      return {
        userId: u.userId,
        userName: user?.name ?? 'Unknown',
        total: u._count.id,
        completed: comp,
        rate: u._count.id > 0 ? Math.round((comp / u._count.id) * 100) : 0,
      };
    }).sort((a, b) => b.rate - a.rate);
    return {
      total,
      completed,
      completionRate: total > 0 ? Math.round((completed / total) * 100) : 0,
      byUser: byUserStats,
    };
  }

  async getEmailEngagementTrend(days = 90) {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const sends = await this.prisma.campaignSend.findMany({
      where: { sentAt: { gte: cutoff } },
      select: { sentAt: true, id: true },
    });
    const events = await this.prisma.emailTrackingEvent.findMany({
      where: { createdAt: { gte: cutoff } },
      select: { type: true, campaignSendId: true, createdAt: true },
    });
    const byWeek: Record<string, { sent: number; opens: number; clicks: number }> = {};
    for (const s of sends) {
      const week = s.sentAt!.toISOString().slice(0, 10).slice(0, 7);
      if (!byWeek[week]) byWeek[week] = { sent: 0, opens: 0, clicks: 0 };
      byWeek[week].sent++;
    }
    for (const e of events) {
      const week = e.createdAt.toISOString().slice(0, 7);
      if (!byWeek[week]) byWeek[week] = { sent: 0, opens: 0, clicks: 0 };
      if (e.type === 'open') byWeek[week].opens++;
      if (e.type === 'click') byWeek[week].clicks++;
    }
    return Object.entries(byWeek)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([week, stats]) => ({
        week,
        ...stats,
        openRate: stats.sent > 0 ? parseFloat(((stats.opens / stats.sent) * 100).toFixed(1)) : 0,
        clickRate: stats.sent > 0 ? parseFloat(((stats.clicks / stats.sent) * 100).toFixed(1)) : 0,
      }));
  }

  async getForecastAccuracy(access?: Access) {
    const now = new Date();
    const lastQuarter = new Date(now);
    lastQuarter.setMonth(lastQuarter.getMonth() - 3);
    const where: Record<string, unknown> = {
      deletedAt: null,
      expectedCloseAt: { gte: lastQuarter, lte: now },
    };
    if (access?.role === 'sales_manager' && access?.teamId) {
      where.assignedTo = { teamId: access.teamId };
    }
    const leads = await this.prisma.lead.findMany({
      where: where as Parameters<typeof this.prisma.lead.findMany>[0]['where'],
      select: { status: true, amount: true, expectedCloseAt: true, closedAt: true },
    });
    const forecasted = leads.length;
    const closedOnTime = leads.filter((l) => l.status === 'won' && l.closedAt && l.expectedCloseAt && l.closedAt <= l.expectedCloseAt).length;
    const wonTotal = leads.filter((l) => l.status === 'won').length;
    const forecastedRevenue = leads.reduce((s, l) => s + (l.amount ? Number(l.amount) : 0), 0);
    const actualRevenue = leads.filter((l) => l.status === 'won').reduce((s, l) => s + (l.amount ? Number(l.amount) : 0), 0);
    return {
      forecasted,
      wonTotal,
      winRate: forecasted > 0 ? Math.round((wonTotal / forecasted) * 100) : 0,
      closedOnTime,
      onTimeRate: wonTotal > 0 ? Math.round((closedOnTime / wonTotal) * 100) : 0,
      forecastedRevenue,
      actualRevenue,
      accuracy: forecastedRevenue > 0 ? Math.round((actualRevenue / forecastedRevenue) * 100) : 0,
    };
  }

  async getRevenueLeak(params: { dateFrom?: string; dateTo?: string }, access?: Access) {
    const where: Record<string, unknown> = { deletedAt: null, status: 'lost' };
    if (access?.role === 'sales_manager' && access?.teamId) {
      where.assignedTo = { teamId: access.teamId };
    }
    if (params.dateFrom || params.dateTo) {
      where.closedAt = {
        ...(params.dateFrom ? { gte: new Date(params.dateFrom) } : {}),
        ...(params.dateTo ? { lte: new Date(params.dateTo) } : {}),
      };
    }
    const lostLeads = await this.prisma.lead.findMany({
      where: where as Parameters<typeof this.prisma.lead.findMany>[0]['where'],
      include: {
        currentStage: true,
        organization: true,
        assignedTo: { select: { id: true, name: true } },
      },
    });
    const totalLost = lostLeads.reduce((s, l) => s + (l.amount ? Number(l.amount) : 0), 0);
    const byStage = lostLeads.reduce((acc, l) => {
      const stage = l.currentStage?.name ?? 'Unknown';
      if (!acc[stage]) acc[stage] = { stage, count: 0, totalAmount: 0 };
      acc[stage].count++;
      acc[stage].totalAmount += l.amount ? Number(l.amount) : 0;
      return acc;
    }, {} as Record<string, { stage: string; count: number; totalAmount: number }>);
    return {
      totalLost,
      count: lostLeads.length,
      byStage: Object.values(byStage).sort((a, b) => b.totalAmount - a.totalAmount),
    };
  }

  async getLostDealAnalysis(params: { dateFrom?: string; dateTo?: string }, access?: Access) {
    const where: Record<string, unknown> = { deletedAt: null, status: 'lost' };
    if (access?.role === 'sales_manager' && access?.teamId) {
      where.assignedTo = { teamId: access.teamId };
    }
    if (params.dateFrom || params.dateTo) {
      where.closedAt = {
        ...(params.dateFrom ? { gte: new Date(params.dateFrom) } : {}),
        ...(params.dateTo ? { lte: new Date(params.dateTo) } : {}),
      };
    }
    const leads = await this.prisma.lead.findMany({
      where: where as Parameters<typeof this.prisma.lead.findMany>[0]['where'],
      select: { id: true, lostReason: true, amount: true, source: true },
    });
    const byReason = leads.reduce((acc, l) => {
      const reason = l.lostReason ?? 'No reason specified';
      if (!acc[reason]) acc[reason] = { reason, count: 0, totalAmount: 0 };
      acc[reason].count++;
      acc[reason].totalAmount += l.amount ? Number(l.amount) : 0;
      return acc;
    }, {} as Record<string, { reason: string; count: number; totalAmount: number }>);
    const bySource = leads.reduce((acc, l) => {
      const source = l.source ?? 'Unknown';
      if (!acc[source]) acc[source] = { source, lost: 0 };
      acc[source].lost++;
      return acc;
    }, {} as Record<string, { source: string; lost: number }>);
    return {
      total: leads.length,
      totalValue: leads.reduce((s, l) => s + (l.amount ? Number(l.amount) : 0), 0),
      byReason: Object.values(byReason).sort((a, b) => b.count - a.count),
      bySource: Object.values(bySource).sort((a, b) => b.lost - a.lost),
    };
  }

  async getRevenueByDimension(dimension: 'industry' | 'companySize', access?: Access) {
    const where: Record<string, unknown> = { deletedAt: null, status: 'won' };
    if (access?.role === 'sales_manager' && access?.teamId) {
      where.assignedTo = { teamId: access.teamId };
    }
    const leads = await this.prisma.lead.findMany({
      where: where as Parameters<typeof this.prisma.lead.findMany>[0]['where'],
      select: { amount: true, organization: { select: { industry: true, type: true } }, customFields: true },
    });
    const grouped: Record<string, number> = {};
    for (const lead of leads) {
      let key = 'Unknown';
      if (dimension === 'industry') key = lead.organization?.industry ?? 'Unknown';
      else {
        const cf = lead.customFields as Record<string, unknown> | null;
        key = (cf?.companySize as string) ?? 'Unknown';
      }
      grouped[key] = (grouped[key] ?? 0) + (lead.amount ? Number(lead.amount) : 0);
    }
    return Object.entries(grouped)
      .map(([name, revenue]) => ({ name, revenue }))
      .sort((a, b) => b.revenue - a.revenue)
      .filter((d) => d.name !== 'Unknown' || d.revenue > 0);
  }

  async getTimeToFirstContact(params: { dateFrom?: string; dateTo?: string }, access?: Access) {
    const where: Record<string, unknown> = { deletedAt: null };
    if (params.dateFrom || params.dateTo) {
      where.createdAt = {
        ...(params.dateFrom ? { gte: new Date(params.dateFrom) } : {}),
        ...(params.dateTo ? { lte: new Date(params.dateTo) } : {}),
      };
    }
    if (access?.role === 'sales_manager' && access?.teamId) {
      where.assignedTo = { teamId: access.teamId };
    }

    const leads = await this.prisma.lead.findMany({
      where: where as Parameters<typeof this.prisma.lead.findMany>[0]['where'],
      take: 200,
      orderBy: { createdAt: 'desc' },
      include: {
        activities: {
          orderBy: { createdAt: 'asc' },
          take: 1,
          select: { createdAt: true },
        },
      },
    });

    const withContact = leads
      .filter((l) => l.activities.length > 0)
      .map((l) => {
        const hoursToContact = (l.activities[0].createdAt.getTime() - l.createdAt.getTime()) / 3600000;
        return Math.round(hoursToContact * 10) / 10;
      });

    const avg = withContact.length > 0
      ? Math.round((withContact.reduce((s, h) => s + h, 0) / withContact.length) * 10) / 10
      : 0;

    const p90 = withContact.length > 0
      ? withContact.sort((a, b) => a - b)[Math.floor(withContact.length * 0.9)]
      : 0;

    return {
      averageHours: avg,
      p90Hours: p90 ?? 0,
      leadsWithContact: withContact.length,
      leadsWithoutContact: leads.length - withContact.length,
      total: leads.length,
    };
  }

  async getPipelineVelocityTrend(weeks = 12, access?: Access) {
    const data: { week: string; avgDays: number; count: number }[] = [];
    for (let w = weeks - 1; w >= 0; w--) {
      const end = new Date(Date.now() - w * 7 * 24 * 60 * 60 * 1000);
      const start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
      const where: Record<string, unknown> = {
        deletedAt: null, status: 'won',
        closedAt: { gte: start, lte: end },
      };
      if (access?.role === 'sales_manager' && access?.teamId) where.assignedTo = { teamId: access.teamId };
      const won = await this.prisma.lead.findMany({
        where: where as Parameters<typeof this.prisma.lead.findMany>[0]['where'],
        select: { createdAt: true, closedAt: true },
      });
      const avgDays = won.length > 0
        ? won.reduce((s, l) => s + (l.closedAt!.getTime() - l.createdAt.getTime()) / 86400000, 0) / won.length
        : 0;
      data.push({ week: start.toISOString().slice(0, 10), avgDays: parseFloat(avgDays.toFixed(1)), count: won.length });
    }
    return data;
  }

  async getStageConversionMatrix(pipelineId?: string, weeks = 8, access?: Access) {
    const pipelines = pipelineId ? [{ id: pipelineId }] : await this.prisma.pipeline.findMany({ select: { id: true, name: true }, take: 1 });
    const pid = pipelines[0]?.id;
    if (!pid) return { stages: [], weeks: [], matrix: [] };
    const stages = await this.prisma.pipelineStage.findMany({ where: { pipelineId: pid }, orderBy: { order: 'asc' }, select: { id: true, name: true } });
    const weekLabels: string[] = [];
    const matrix: Record<string, Record<string, number>> = {};
    for (let w = weeks - 1; w >= 0; w--) {
      const end = new Date(Date.now() - w * 7 * 24 * 60 * 60 * 1000);
      const start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
      const weekLabel = start.toISOString().slice(0, 10);
      weekLabels.push(weekLabel);
      const histories = await this.prisma.leadStageHistory.groupBy({
        by: ['toStageId'],
        where: { enteredAt: { gte: start, lte: end }, lead: { pipelineId: pid, deletedAt: null } },
        _count: { id: true },
      });
      for (const h of histories) {
        if (!matrix[h.toStageId]) matrix[h.toStageId] = {};
        matrix[h.toStageId][weekLabel] = h._count.id;
      }
    }
    return {
      stages: stages.map((s) => s.name),
      weeks: weekLabels,
      matrix: stages.map((s) => ({
        stage: s.name,
        values: weekLabels.map((w) => matrix[s.id]?.[w] ?? 0),
      })),
    };
  }

  async getLeadSourceTrend(weeks = 12, access?: Access) {
    const trend: Record<string, { source: string; weeks: { week: string; count: number }[] }> = {};
    for (let w = weeks - 1; w >= 0; w--) {
      const end = new Date(Date.now() - w * 7 * 24 * 60 * 60 * 1000);
      const start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
      const weekLabel = start.toISOString().slice(0, 10);
      const where: Record<string, unknown> = { deletedAt: null, createdAt: { gte: start, lte: end } };
      if (access?.role === 'sales_manager' && access?.teamId) where.assignedTo = { teamId: access.teamId };
      const grouped = await this.prisma.lead.groupBy({
        by: ['source'],
        where: where as Parameters<typeof this.prisma.lead.groupBy>[0]['where'],
        _count: { id: true },
      });
      for (const g of grouped) {
        const src = g.source ?? 'Direct';
        if (!trend[src]) trend[src] = { source: src, weeks: [] };
        trend[src].weeks.push({ week: weekLabel, count: g._count.id });
      }
    }
    return Object.values(trend).sort((a, b) => {
      const totalA = a.weeks.reduce((s, w) => s + w.count, 0);
      const totalB = b.weeks.reduce((s, w) => s + w.count, 0);
      return totalB - totalA;
    }).slice(0, 6);
  }

  async getContactGrowthTrend(weeks = 12) {
    const data: { week: string; new: number; cumulative: number }[] = [];
    let cumulative = 0;
    const existingBefore = await this.prisma.contact.count({
      where: { createdAt: { lt: new Date(Date.now() - weeks * 7 * 24 * 60 * 60 * 1000) } },
    });
    cumulative = existingBefore;
    for (let w = weeks - 1; w >= 0; w--) {
      const end = new Date(Date.now() - w * 7 * 24 * 60 * 60 * 1000);
      const start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
      const newContacts = await this.prisma.contact.count({ where: { createdAt: { gte: start, lte: end } } });
      cumulative += newContacts;
      data.push({ week: start.toISOString().slice(0, 10), new: newContacts, cumulative });
    }
    return data;
  }

  async getPipelineCoverageRatio(pipelineId?: string, access?: Access) {
    const where: Record<string, unknown> = { deletedAt: null, status: { notIn: ['won', 'lost'] } };
    if (pipelineId) where.pipelineId = pipelineId;
    if (access?.role === 'sales_manager' && access?.teamId) where.assignedTo = { teamId: access.teamId };
    const [pipeline, wonPrev] = await Promise.all([
      this.prisma.lead.aggregate({
        where: where as Parameters<typeof this.prisma.lead.aggregate>[0]['where'],
        _sum: { amount: true }, _count: { id: true },
      }),
      this.prisma.lead.aggregate({
        where: { ...where, status: 'won', closedAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } } as Parameters<typeof this.prisma.lead.aggregate>[0]['where'],
        _sum: { amount: true },
      }),
    ]);
    const pipelineValue = pipeline._sum.amount ? Number(pipeline._sum.amount) : 0;
    const revenueLastMonth = wonPrev._sum.amount ? Number(wonPrev._sum.amount) : 0;
    const coverageRatio = revenueLastMonth > 0 ? pipelineValue / revenueLastMonth : null;
    return { pipelineValue, openLeads: pipeline._count.id, revenueLastMonth, coverageRatio, coverageRatioFormatted: coverageRatio ? `${coverageRatio.toFixed(1)}x` : 'N/A' };
  }
}
