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
}
