import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { LeadAssignmentRulesService } from '../lead-assignment-rules/lead-assignment-rules.service';
import { LeadScoringRulesService } from '../lead-scoring-rules/lead-scoring-rules.service';
import { ScoreTriggersService } from '../lead-scoring-rules/score-triggers.service';
import { EmailService } from '../email/email.service';
import { EmailTemplatesService } from '../email/email-templates.service';
import { EmailAutomationService } from '../email/email-automation.service';
import { WebhookOutboundService } from '../webhooks/webhook-outbound.service';
import { CreateLeadDto } from './dto/create-lead.dto';
import { UpdateLeadDto } from './dto/update-lead.dto';
import { ListLeadsQueryDto } from './dto/list-leads-query.dto';
import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/client';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';

@Injectable()
export class LeadsService {
  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private audit: AuditService,
    private assignmentRules: LeadAssignmentRulesService,
    private scoringRules: LeadScoringRulesService,
    private scoreTriggers: ScoreTriggersService,
    private emailService: EmailService,
    private emailTemplatesService: EmailTemplatesService,
    private emailAutomationService: EmailAutomationService,
    private webhookOutbound: WebhookOutboundService,
  ) {}

  async create(dto: CreateLeadDto) {
    let assignedToId = dto.assignedToId;
    if (!assignedToId) {
      const fromRule = await this.assignmentRules.getAssigneeForNewLead(dto.source);
      if (fromRule) assignedToId = fromRule;
    }
    const lead = await this.prisma.lead.create({
      data: {
        title: dto.title,
        pipelineId: dto.pipelineId,
        currentStageId: dto.stageId,
        organizationId: dto.organizationId,
        primaryContactId: dto.primaryContactId,
        source: dto.source,
        sourceDetail: dto.sourceDetail,
        assignedToId,
        customFields: (dto.customFields ?? undefined) as object | undefined,
        nextStep: dto.nextStep,
        expectedCloseAt: dto.expectedCloseAt ? new Date(dto.expectedCloseAt) : null,
        amount: dto.amount != null ? new Decimal(dto.amount) : null,
        currency: dto.currency ?? 'USD',
        status: 'new',
      },
      include: {
        currentStage: true,
        organization: true,
        primaryContact: true,
        assignedTo: { select: { id: true, name: true, email: true } },
        tags: { include: { tag: true } },
      },
    });
    this.webhookOutbound.dispatch('lead.created', this.leadToWebhookPayload(lead)).catch(() => {});
    return lead;
  }

  private leadToWebhookPayload(lead: {
    id: string;
    title: string;
    status: string | null;
    source: string | null;
    sourceDetail: string | null;
    currentStageId: string;
    pipelineId: string;
    organizationId: string | null;
    primaryContactId: string | null;
    amount: unknown;
    currency: string | null;
    nextStep: string | null;
    expectedCloseAt: Date | null;
    currentStage?: { id: string; name: string } | null;
    organization?: { id: string; name: string } | null;
    primaryContact?: { id: string; email: string; firstName: string; lastName: string } | null;
    assignedTo?: { id: string; name: string | null; email: string } | null;
    [key: string]: unknown;
  }): Record<string, unknown> {
    return {
      id: lead.id,
      title: lead.title,
      status: lead.status,
      source: lead.source,
      sourceDetail: lead.sourceDetail,
      currentStageId: lead.currentStageId,
      pipelineId: lead.pipelineId,
      organizationId: lead.organizationId,
      primaryContactId: lead.primaryContactId,
      amount: lead.amount != null ? Number(lead.amount) : null,
      currency: lead.currency,
      nextStep: lead.nextStep,
      expectedCloseAt: lead.expectedCloseAt?.toISOString() ?? null,
      currentStage: lead.currentStage,
      organization: lead.organization,
      primaryContact: lead.primaryContact,
      assignedTo: lead.assignedTo,
      ip: lead.ip ?? undefined,
      userAgent: lead.userAgent ?? undefined,
      referrer: lead.referrer ?? undefined,
      submissionMeta: lead.submissionMeta ?? undefined,
    };
  }

  async findAll(query: ListLeadsQueryDto, access?: { role?: string; teamId?: string | null; userId?: string }) {
    const where: Prisma.LeadWhereInput = { deletedAt: null };
    if (access?.role === 'sales_manager' && access?.teamId) {
      where.assignedTo = { teamId: access.teamId };
    }
    // salesperson and sales_rep see only their assigned leads by default (unless assignedToId filter overrides)
    if ((access?.role === 'salesperson' || access?.role === 'sales_rep') && !query.assignedToId && access?.userId) {
      where.assignedToId = access.userId;
    }
    if (query.status) where.status = query.status;
    if (query.pipelineId) where.pipelineId = query.pipelineId;
    if (query.stageId) where.currentStageId = query.stageId;
    if (query.assignedToId) where.assignedToId = query.assignedToId;
    if (query.source) where.source = query.source;
    if (query.organizationType) where.organization = { type: query.organizationType };
    if (query.untagged) {
      where.tags = { none: {} };
    } else if (query.tagIds?.length) {
      where.tags = { some: { tagId: { in: query.tagIds } } };
    }
    if (query.search?.trim()) {
      const q = query.search.trim();
      where.OR = [
        { title: { contains: q, mode: 'insensitive' } },
        { organization: { name: { contains: q, mode: 'insensitive' } } },
        { primaryContact: { firstName: { contains: q, mode: 'insensitive' } } },
        { primaryContact: { lastName: { contains: q, mode: 'insensitive' } } },
        { primaryContact: { email: { contains: q, mode: 'insensitive' } } },
      ];
    }
    if (query.dateFrom || query.dateTo) {
      where.createdAt = {};
      if (query.dateFrom) (where.createdAt as Prisma.DateTimeFilter).gte = new Date(query.dateFrom);
      if (query.dateTo) (where.createdAt as Prisma.DateTimeFilter).lte = new Date(query.dateTo);
    }
    const limit = Math.min(query.limit ?? 20, 100);
    const orderBy: Prisma.LeadOrderByWithRelationInput =
      query.sort === 'score' ? { score: 'desc' } : { createdAt: 'desc' };
    const include = {
      currentStage: true,
      organization: true,
      primaryContact: true,
      assignedTo: { select: { id: true, name: true, email: true } },
      tags: { include: { tag: true } },
    };

    if (query.cursor) {
      const take = limit + 1;
      const data = await this.prisma.lead.findMany({
        where,
        cursor: { id: query.cursor },
        skip: 1,
        take,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        include,
      });
      const hasMore = data.length > limit;
      const items = hasMore ? data.slice(0, limit) : data;
      const nextCursor = hasMore ? items[items.length - 1].id : undefined;
      return { data: items, nextCursor, limit };
    }

    const page = query.page ?? 1;
    const [data, total] = await Promise.all([
      this.prisma.lead.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy,
        include,
      }),
      this.prisma.lead.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  private assertLeadAccess(lead: { assignedTo?: { teamId?: string | null } | null }, access?: { role?: string; teamId?: string | null }) {
    if (!access || access.role !== 'sales_manager' || !access.teamId) return;
    const assigneeTeamId = lead.assignedTo?.teamId ?? null;
    if (assigneeTeamId !== access.teamId) throw new ForbiddenException('You do not have access to this lead');
  }

  async findOne(id: string, access?: { role?: string; teamId?: string | null }) {
    const lead = await this.prisma.lead.findFirst({
      where: { id, deletedAt: null },
      include: {
        currentStage: true,
        pipeline: { include: { stages: true } },
        organization: true,
        primaryContact: true,
        assignedTo: { select: { id: true, name: true, email: true, teamId: true } },
        tags: { include: { tag: true } },
        activities: { take: 20, orderBy: { createdAt: 'desc' }, include: { user: { select: { id: true, name: true } } } },
        stageHistory: { take: 10, orderBy: { enteredAt: 'desc' }, include: { stage: true } },
      },
    });
    if (!lead) throw new NotFoundException('Lead not found');
    this.assertLeadAccess(lead, access);
    const { assignedTo, ...rest } = lead;
    return { ...rest, assignedTo: assignedTo ? { id: assignedTo.id, name: assignedTo.name, email: assignedTo.email } : null };
  }

  /** Email timeline: all campaign sends for this lead with sent at, open, and click events */
  async getEmailTimeline(id: string, access?: { role?: string; teamId?: string | null }) {
    const lead = await this.prisma.lead.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, assignedTo: { select: { teamId: true } } },
    });
    if (!lead) throw new NotFoundException('Lead not found');
    this.assertLeadAccess(lead as { id: string; assignedTo?: { teamId: string | null } | null }, access);
    const sends = await this.prisma.campaignSend.findMany({
      where: { leadId: id },
      orderBy: { sentAt: 'desc' },
      include: {
        campaign: { select: { id: true, name: true } },
        trackingEvents: { orderBy: { createdAt: 'asc' }, include: { trackingLink: { select: { url: true } } } },
      },
    });
    const items = sends.map((s) => {
      const openEv = s.trackingEvents.find((e) => e.type === 'open');
      const clickEvs = s.trackingEvents.filter((e) => e.type === 'click');
      return {
        campaignId: s.campaign.id,
        campaignName: s.campaign.name,
        sentAt: s.sentAt?.toISOString() ?? null,
        openedAt: openEv?.createdAt.toISOString() ?? null,
        clicks: clickEvs.map((e) => ({ url: e.trackingLink?.url ?? null, clickedAt: e.createdAt.toISOString() })),
      };
    });
    return { data: { items } };
  }

  async update(id: string, dto: UpdateLeadDto, userId?: string, access?: { role?: string; teamId?: string | null }) {
    const previous = await this.findOne(id, access);
    const updated = await this.prisma.lead.update({
      where: { id },
      data: {
        title: dto.title,
        organizationId: dto.organizationId,
        primaryContactId: dto.primaryContactId,
        source: dto.source,
        sourceDetail: dto.sourceDetail,
        assignedToId: dto.assignedToId,
        customFields: dto.customFields as object | undefined,
        lostReason: dto.lostReason,
        nextStep: dto.nextStep,
        expectedCloseAt: dto.expectedCloseAt ? new Date(dto.expectedCloseAt) : undefined,
        amount: dto.amount != null ? new Decimal(dto.amount) : undefined,
        currency: dto.currency,
      },
      include: {
        currentStage: true,
        organization: true,
        primaryContact: true,
        assignedTo: { select: { id: true, name: true, email: true } },
        tags: { include: { tag: true } },
      },
    });
    await this.audit.log({
      userId,
      resourceType: 'lead',
      resourceId: id,
      action: 'update',
      oldValue: { title: previous.title, assignedToId: previous.assignedToId },
      newValue: { title: updated.title, assignedToId: updated.assignedToId },
    });
    this.webhookOutbound.dispatch('lead.updated', this.leadToWebhookPayload(updated)).catch(() => {});
    return updated;
  }

  async moveStage(id: string, stageId: string, userId?: string, access?: { role?: string; teamId?: string | null }) {
    const lead = await this.findOne(id, access);
    const newStage = await this.prisma.pipelineStage.findFirst({
      where: { id: stageId, pipelineId: lead.pipelineId },
    });
    if (!newStage) throw new NotFoundException('Stage not found');
    const requiredKeys = (newStage.requiredFieldKeys as string[] | null) ?? [];
    for (const key of requiredKeys) {
      const val = (lead as Record<string, unknown>)[key];
      if (val === undefined || val === null || (typeof val === 'string' && val.trim() === '')) {
        throw new BadRequestException(`Required field "${key}" must be set before moving to this stage`);
      }
    }
    const stagePoints = await this.scoringRules.evaluateForStageChange(stageId);
    const newScore = (lead.score ?? 0) + stagePoints;
    await this.prisma.$transaction([
      this.prisma.leadStageHistory.create({
        data: {
          leadId: id,
          stageId,
          fromStageId: lead.currentStageId,
          userId,
        },
      }),
      this.prisma.lead.update({
        where: { id },
        data: {
          currentStageId: stageId,
          status: newStage.isWon ? 'won' : newStage.isLost ? 'lost' : lead.status,
          closedAt: newStage.isWon || newStage.isLost ? new Date() : null,
          score: newScore,
          scoreUpdatedAt: new Date(),
        },
      }),
      ...(stagePoints !== 0
        ? [
            this.prisma.leadScoreLog.create({
              data: {
                leadId: id,
                previousScore: lead.score ?? 0,
                newScore,
                reason: `Stage change to ${newStage.name}`,
              },
            }),
          ]
        : []),
    ]);
    const updatedLead = await this.findOne(id, access);
    this.webhookOutbound.dispatch('lead.stage_changed', {
      lead: this.leadToWebhookPayload(updatedLead as Parameters<typeof this.leadToWebhookPayload>[0]),
      fromStageId: lead.currentStageId,
      toStageId: stageId,
      fromStageName: lead.currentStage?.name ?? null,
      toStageName: newStage.name,
    }).catch(() => {});
    if (stagePoints !== 0) {
      this.scoreTriggers.evaluateForLead(id, newScore).catch(() => {});
    }
    // Fire stage_entry (toStageId) and stage_exit (fromStageId) automations
    const leadForAutomation = updatedLead as {
      id: string;
      title: string;
      organization?: { name: string } | null;
      primaryContact?: { firstName?: string; lastName?: string; email: string } | null;
      assignedTo?: { name: string | null } | null;
      nextStep?: string | null;
      amount?: unknown;
      currency?: string | null;
      source?: string | null;
      customFields?: Record<string, unknown> | null;
    };
    this.emailAutomationService.runForStageChange(leadForAutomation, lead.currentStageId, stageId).catch(() => {});

    return updatedLead;
  }

  async getActivities(id: string, limit = 50, access?: { role?: string; teamId?: string | null }) {
    await this.findOne(id, access);
    return this.prisma.activity.findMany({
      where: { leadId: id },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { user: { select: { id: true, name: true, email: true } }, contact: true },
    });
  }

  async getNotes(id: string, access?: { role?: string; teamId?: string | null }) {
    await this.findOne(id, access);
    return this.prisma.leadNote.findMany({
      where: { leadId: id },
      orderBy: { createdAt: 'desc' },
      include: { author: { select: { id: true, name: true } } },
    });
  }

  async createNote(
    leadId: string,
    body: string,
    authorId: string,
    access?: { role?: string; teamId?: string | null },
  ) {
    await this.findOne(leadId, access);
    return this.prisma.leadNote.create({
      data: { leadId, body: body.trim(), authorId },
      include: { author: { select: { id: true, name: true } } },
    });
  }

  async updateNote(
    leadId: string,
    noteId: string,
    body: string,
    userId: string,
    access?: { role?: string; teamId?: string | null },
  ) {
    await this.findOne(leadId, access);
    const note = await this.prisma.leadNote.findFirst({
      where: { id: noteId, leadId },
    });
    if (!note) throw new NotFoundException('Note not found');
    return this.prisma.leadNote.update({
      where: { id: noteId },
      data: { body: body.trim(), updatedAt: new Date() },
      include: { author: { select: { id: true, name: true } } },
    });
  }

  private getUploadDir(): string {
    return this.config.get<string>('UPLOAD_DIR') ?? path.join(process.cwd(), 'uploads');
  }

  async getDocuments(leadId: string, access?: { role?: string; teamId?: string | null }) {
    await this.findOne(leadId, access);
    return this.prisma.leadDocument.findMany({
      where: { leadId },
      orderBy: { createdAt: 'desc' },
      include: { uploadedBy: { select: { id: true, name: true } } },
    });
  }

  async createDocument(
    leadId: string,
    file: { buffer: Buffer; mimetype: string; originalname: string; size: number },
    userId: string | null,
    access?: { role?: string; teamId?: string | null },
  ) {
    await this.findOne(leadId, access);
    const baseDir = this.getUploadDir();
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 200) || 'file';
    const unique = crypto.randomBytes(8).toString('hex');
    const storageKey = `leads/${leadId}/${unique}_${safeName}`;
    const fullPath = path.join(baseDir, storageKey);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, file.buffer);
    return this.prisma.leadDocument.create({
      data: {
        leadId,
        storageKey,
        fileName: file.originalname,
        mimeType: file.mimetype,
        sizeBytes: file.size,
        uploadedById: userId,
      },
      include: { uploadedBy: { select: { id: true, name: true } } },
    });
  }

  async getDocumentForDownload(
    leadId: string,
    documentId: string,
    access?: { role?: string; teamId?: string | null },
  ): Promise<{ filePath: string; fileName: string; mimeType: string | null }> {
    await this.findOne(leadId, access);
    const doc = await this.prisma.leadDocument.findFirst({
      where: { id: documentId, leadId },
    });
    if (!doc) throw new NotFoundException('Document not found');
    const baseDir = this.getUploadDir();
    const filePath = path.resolve(path.join(baseDir, doc.storageKey));
    try {
      await fs.access(filePath);
    } catch {
      throw new NotFoundException('File not found on disk');
    }
    return { filePath, fileName: doc.fileName, mimeType: doc.mimeType };
  }

  async deleteDocument(leadId: string, documentId: string, access?: { role?: string; teamId?: string | null }) {
    await this.findOne(leadId, access);
    const doc = await this.prisma.leadDocument.findFirst({
      where: { id: documentId, leadId },
    });
    if (!doc) throw new NotFoundException('Document not found');
    const baseDir = this.getUploadDir();
    const filePath = path.join(baseDir, doc.storageKey);
    try {
      await fs.unlink(filePath);
    } catch {
      // ignore if file already missing
    }
    await this.prisma.leadDocument.delete({ where: { id: documentId } });
    return { message: 'Document deleted' };
  }

  async remove(id: string, access?: { role?: string; teamId?: string | null }) {
    await this.findOne(id, access);
    await this.prisma.lead.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    return { message: 'Lead deleted' };
  }

  /** GDPR: permanent delete lead and related data; audit trail. */
  async hardDeleteLead(id: string, userId: string | undefined, access?: { role?: string; teamId?: string | null }) {
    const lead = await this.prisma.lead.findFirst({
      where: { id },
      include: { assignedTo: { select: { teamId: true } }, organization: { select: { name: true } } },
    });
    if (!lead) throw new NotFoundException('Lead not found');
    this.assertLeadAccess(lead, access);
    const snapshot = {
      id: lead.id,
      title: lead.title,
      organizationId: lead.organizationId,
      organizationName: lead.organization?.name,
      deletedAt: lead.deletedAt?.toISOString() ?? null,
    };
    await this.audit.log({
      userId,
      resourceType: 'lead',
      resourceId: id,
      action: 'permanent_delete',
      oldValue: snapshot,
      newValue: null,
    });
    await this.prisma.lead.delete({ where: { id } });
    return { message: 'Lead permanently deleted' };
  }

  /** GDPR/data export: full lead and related data as JSON-serializable object */
  async exportDataForLead(id: string, access?: { role?: string; teamId?: string | null }) {
    const lead = await this.prisma.lead.findFirst({
      where: { id, deletedAt: null },
      include: {
        currentStage: true,
        pipeline: { include: { stages: true } },
        organization: true,
        primaryContact: true,
        assignedTo: { select: { id: true, name: true, email: true, teamId: true } },
        tags: { include: { tag: true } },
        activities: { orderBy: { createdAt: 'desc' }, include: { user: { select: { id: true, name: true } }, contact: true } },
        stageHistory: { orderBy: { enteredAt: 'desc' }, include: { stage: true } },
        scoreLog: true,
      },
    });
    if (!lead) throw new NotFoundException('Lead not found');
    this.assertLeadAccess(lead, access);
    return this.serializeForExport(lead);
  }

  private serializeForExport(obj: unknown): unknown {
    if (obj === null || obj === undefined) return obj;
    if (obj instanceof Date) return obj.toISOString();
    if (typeof (obj as { toNumber?: () => number }).toNumber === 'function') return (obj as { toNumber: () => number }).toNumber();
    if (Array.isArray(obj)) return obj.map((item) => this.serializeForExport(item));
    if (typeof obj === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(obj)) out[k] = this.serializeForExport(v);
      return out;
    }
    return obj;
  }

  async getScoreHistory(id: string, limit = 50, access?: { role?: string; teamId?: string | null }) {
    await this.findOne(id, access);
    return this.prisma.leadScoreLog.findMany({
      where: { leadId: id },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  async merge(keepId: string, mergeId: string, userId?: string, access?: { role?: string; teamId?: string | null }) {
    const keep = await this.findOne(keepId, access);
    const merge = await this.findOne(mergeId, access);
    if (keepId === mergeId) throw new BadRequestException('Cannot merge lead with itself');
    await this.prisma.$transaction([
      this.prisma.activity.updateMany({ where: { leadId: mergeId }, data: { leadId: keepId } }),
      this.prisma.leadTag.deleteMany({ where: { leadId: mergeId } }),
      this.prisma.leadStageHistory.deleteMany({ where: { leadId: mergeId } }),
      this.prisma.leadScoreLog.deleteMany({ where: { leadId: mergeId } }),
      this.prisma.lead.update({
        where: { id: mergeId },
        data: { deletedAt: new Date() },
      }),
    ]);
    await this.audit.log({
      userId,
      resourceType: 'lead',
      resourceId: keepId,
      action: 'merge',
      newValue: { mergedLeadId: mergeId, mergedTitle: merge.title },
    });
    return this.findOne(keepId, access);
  }

  async bulkUpdate(
    leadIds: string[],
    updates: { assignedToId?: string; stageId?: string },
    userId?: string,
  ) {
    if (!leadIds.length) return { updated: 0 };
    const data: Prisma.LeadUncheckedUpdateManyInput = {};
    if (updates.assignedToId !== undefined) data.assignedToId = updates.assignedToId;
    if (updates.stageId !== undefined) data.currentStageId = updates.stageId;
    const result = await this.prisma.lead.updateMany({
      where: { id: { in: leadIds }, deletedAt: null },
      data,
    });
    await this.audit.log({
      userId,
      resourceType: 'lead',
      resourceId: 'bulk',
      action: 'bulk_update',
      newValue: { leadIds, updates, count: result.count },
    });
    return { updated: result.count };
  }

  async exportCsv(query: ListLeadsQueryDto, access?: { role?: string; teamId?: string | null }): Promise<string> {
    const { data } = await this.findAll({ ...query, limit: 10000, page: 1 }, access);
    const headers = [
      'id',
      'title',
      'status',
      'source',
      'score',
      'nextStep',
      'expectedCloseAt',
      'amount',
      'currency',
      'organizationName',
      'primaryContactEmail',
      'assignedToName',
      'stageName',
      'tags',
      'createdAt',
    ];
    const rows = (data as any[]).map((lead) => {
      const tagNames = lead.tags?.map((lt: { tag?: { name: string } }) => lt.tag?.name).filter(Boolean) ?? [];
      return [
        lead.id,
        lead.title,
        lead.status,
        lead.source ?? '',
        lead.score ?? '',
        lead.nextStep ?? '',
        lead.expectedCloseAt ? new Date(lead.expectedCloseAt).toISOString() : '',
        lead.amount != null ? lead.amount.toString() : '',
        lead.currency ?? '',
        lead.organization?.name ?? '',
        lead.primaryContact?.email ?? '',
        lead.assignedTo?.name ?? '',
        lead.currentStage?.name ?? '',
        tagNames.join('; '),
        lead.createdAt ? new Date(lead.createdAt).toISOString() : '',
      ];
    });
    const escape = (v: string) => (v.includes(',') || v.includes('"') ? `"${v.replace(/"/g, '""')}"` : v);
    const lines = [headers.join(','), ...rows.map((r) => r.map((c: any) => escape(String(c ?? ''))).join(','))];
    return lines.join('\n');
  }

  async importCsv(
    rows: Record<string, string>[],
    mapping: Record<string, string>,
    pipelineId: string,
    defaultStageId: string,
  ) {
    const created: string[] = [];
    const errors: { row: number; message: string }[] = [];
    const titleCol = mapping['title'] ?? 'title';
    const sourceCol = mapping['source'] ?? 'source';
    const orgCol = mapping['organizationName'] ?? mapping['organization_name'] ?? 'organizationName';
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const title = row[titleCol]?.trim() || `Imported ${i + 1}`;
      const source = row[sourceCol]?.trim() || undefined;
      const orgName = row[orgCol]?.trim();
      try {
        let organizationId: string | undefined;
        if (orgName) {
          let org = await this.prisma.organization.findFirst({ where: { name: orgName } });
          if (!org) {
            org = await this.prisma.organization.create({
              data: { name: orgName.slice(0, 255), type: 'prospect' },
            });
          }
          organizationId = org.id;
        }
        const lead = await this.prisma.lead.create({
          data: {
            title: String(title).slice(0, 500),
            pipelineId,
            currentStageId: defaultStageId,
            source,
            organizationId,
            status: 'new',
          },
        });
        created.push(lead.id);
      } catch (e) {
        errors.push({ row: i + 1, message: e instanceof Error ? e.message : 'Unknown error' });
      }
    }
    return { created: created.length, errors };
  }

  async promoteToDeal(id: string, targetPipelineId: string, userId?: string, access?: { role?: string; teamId?: string | null }) {
    const lead = await this.findOne(id, access);
    const targetPipeline = await this.prisma.pipeline.findUnique({
      where: { id: targetPipelineId },
      include: { stages: { orderBy: { order: 'asc' }, take: 1 } },
    });
    if (!targetPipeline) throw new NotFoundException('Pipeline not found');
    if (targetPipeline.type !== 'deal') throw new BadRequestException('Target pipeline must be of type "deal"');
    const firstStage = targetPipeline.stages[0];
    if (!firstStage) throw new BadRequestException('Target pipeline has no stages');
    await this.prisma.$transaction([
      this.prisma.leadStageHistory.create({
        data: {
          leadId: id,
          stageId: firstStage.id,
          fromStageId: lead.currentStageId,
          userId,
        },
      }),
      this.prisma.lead.update({
        where: { id },
        data: {
          pipelineId: targetPipelineId,
          currentStageId: firstStage.id,
          status: 'new',
          closedAt: null,
        },
      }),
    ]);
    await this.audit.log({
      userId,
      resourceType: 'lead',
      resourceId: id,
      action: 'promote_to_deal',
      newValue: { pipelineId: targetPipelineId, pipelineName: targetPipeline.name },
    });
    return this.findOne(id, access);
  }

  async sendEmail(
    id: string,
    templateId: string,
    toEmail: string | undefined,
    userId: string,
    access?: { role?: string; teamId?: string | null },
  ) {
    const lead = await this.findOne(id, access);
    const template = await this.emailTemplatesService.findOne(templateId);
    const to = toEmail?.trim() || (lead.primaryContact as { email?: string } | null)?.email;
    if (!to) throw new BadRequestException('No recipient email. Set a primary contact or provide toEmail.');
    const primaryContactId = (lead as { primaryContactId?: string | null }).primaryContactId;
    if (primaryContactId && !toEmail) {
      const contact = await this.prisma.contact.findUnique({
        where: { id: primaryContactId },
        select: { unsubscribedAt: true },
      });
      if (contact?.unsubscribedAt) throw new BadRequestException('Contact has unsubscribed from emails.');
    }
    const vars = this.emailService.buildLeadVars({
      title: lead.title,
      organization: lead.organization,
      assignedTo: lead.assignedTo,
      nextStep: lead.nextStep,
      amount: lead.amount,
      currency: lead.currency,
      source: lead.source,
      primaryContact: lead.primaryContact,
      customFields: lead.customFields as Record<string, unknown> | null,
    });
    const { subject, html, text } = this.emailService.renderTemplate(
      {
        subject: template.subject,
        bodyHtml: template.bodyHtml ?? undefined,
        bodyText: template.bodyText ?? undefined,
      },
      vars,
    );
    await this.emailService.send({ to, subject, html, text });
    await this.prisma.activity.create({
      data: {
        leadId: id,
        userId,
        type: 'email',
        subject,
        body: text || html?.replace(/<[^>]*>/g, '') || null,
        outcome: 'sent',
        completedAt: new Date(),
      },
    });
    return { message: 'Email sent', to };
  }

  async clone(id: string, userId: string, access?: { role?: string; teamId?: string | null }) {
    const lead = await this.findOne(id, access);
    const customFields = lead.customFields as object | null;
    const existing = await this.prisma.lead.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new NotFoundException('Lead not found');
    const cloned = await this.prisma.lead.create({
      data: {
        title: `${lead.title} (Copy)`,
        pipelineId: existing.pipelineId,
        currentStageId: existing.currentStageId,
        organizationId: existing.organizationId,
        primaryContactId: existing.primaryContactId,
        source: existing.source,
        sourceDetail: existing.sourceDetail,
        assignedToId: userId,
        customFields: customFields ?? undefined,
        nextStep: existing.nextStep,
        expectedCloseAt: existing.expectedCloseAt,
        amount: existing.amount,
        currency: existing.currency ?? 'USD',
        status: 'new',
      },
      include: {
        currentStage: true,
        organization: true,
        primaryContact: true,
        assignedTo: { select: { id: true, name: true, email: true } },
        tags: { include: { tag: true } },
      },
    });
    await this.audit.log({ userId, action: 'clone', resourceType: 'lead', resourceId: cloned.id, meta: { sourceId: id } });
    return cloned;
  }

  async findSimilar(id: string, access?: { role?: string; teamId?: string | null }) {
    const lead = await this.prisma.lead.findFirst({ where: { id, deletedAt: null }, select: { title: true, organizationId: true } });
    if (!lead) throw new NotFoundException('Lead not found');
    const titleWords = lead.title.split(/\s+/).slice(0, 3).join(' ');
    const where: Prisma.LeadWhereInput = {
      deletedAt: null,
      id: { not: id },
      OR: [
        { title: { contains: titleWords, mode: 'insensitive' } },
        ...(lead.organizationId ? [{ organizationId: lead.organizationId }] : []),
      ],
    };
    if (access?.role === 'sales_manager' && access?.teamId) {
      where.assignedTo = { teamId: access.teamId };
    }
    return this.prisma.lead.findMany({
      where,
      take: 5,
      orderBy: { createdAt: 'desc' },
      include: { currentStage: true, organization: true },
    });
  }

  async setPriority(id: string, priority: string | null, userId?: string, access?: { role?: string; teamId?: string | null }) {
    const existing = await this.prisma.lead.findFirst({ where: { id, deletedAt: null }, select: { id: true, customFields: true } });
    if (!existing) throw new NotFoundException('Lead not found');
    const customFields = (existing.customFields as Record<string, unknown> | null) ?? {};
    const updated = { ...customFields, priority: priority ?? undefined };
    const lead = await this.prisma.lead.update({
      where: { id },
      data: { customFields: updated },
    });
    if (userId) await this.audit.log({ userId, action: 'set_priority', resourceType: 'lead', resourceId: id, meta: { priority } });
    return lead;
  }

  async archiveLead(id: string, userId: string, access?: { role?: string; teamId?: string | null }) {
    const lead = await this.prisma.lead.findFirst({ where: { id, deletedAt: null }, select: { id: true, assignedTo: { select: { teamId: true } } } });
    if (!lead) throw new NotFoundException('Lead not found');
    this.assertLeadAccess(lead as { assignedTo?: { teamId?: string | null } | null }, access);
    const existing = await this.prisma.lead.findFirst({ where: { id }, select: { customFields: true } });
    const cf = (existing?.customFields as Record<string, unknown> | null) ?? {};
    const updated = await this.prisma.lead.update({
      where: { id },
      data: { customFields: { ...cf, archived: true, archivedAt: new Date().toISOString() } },
    });
    await this.audit.log({ userId, action: 'archive', resourceType: 'lead', resourceId: id });
    return updated;
  }

  async restoreLead(id: string, userId: string, access?: { role?: string; teamId?: string | null }) {
    const lead = await this.prisma.lead.findFirst({ where: { id, deletedAt: null }, select: { id: true, customFields: true, assignedTo: { select: { teamId: true } } } });
    if (!lead) throw new NotFoundException('Lead not found');
    this.assertLeadAccess(lead as { assignedTo?: { teamId?: string | null } | null }, access);
    const cf = (lead.customFields as Record<string, unknown> | null) ?? {};
    const { archived: _a, archivedAt: _b, ...rest } = cf;
    const updated = await this.prisma.lead.update({ where: { id }, data: { customFields: rest } });
    await this.audit.log({ userId, action: 'restore', resourceType: 'lead', resourceId: id });
    return updated;
  }

  async findArchived(access?: { role?: string; teamId?: string | null; userId?: string }) {
    const where: Prisma.LeadWhereInput = {
      deletedAt: null,
      customFields: { path: ['archived'], equals: true },
    };
    if (access?.role === 'salesperson' || access?.role === 'sales_rep') {
      where.assignedToId = access.userId;
    } else if (access?.role === 'sales_manager' && access?.teamId) {
      where.assignedTo = { teamId: access.teamId };
    }
    return this.prisma.lead.findMany({
      where,
      take: 50,
      orderBy: { updatedAt: 'desc' },
      include: { currentStage: true, organization: true, assignedTo: { select: { id: true, name: true } } },
    });
  }

  async getScoreHistory(id: string, access?: { role?: string; teamId?: string | null }) {
    const lead = await this.prisma.lead.findFirst({ where: { id, deletedAt: null }, select: { id: true, assignedTo: { select: { teamId: true } } } });
    if (!lead) throw new NotFoundException('Lead not found');
    this.assertLeadAccess(lead as { assignedTo?: { teamId?: string | null } | null }, access);
    return this.prisma.leadScoreLog.findMany({
      where: { leadId: id },
      orderBy: { createdAt: 'desc' },
      take: 30,
    });
  }

  async addQuickNote(leadId: string, content: string, userId: string) {
    const lead = await this.prisma.lead.findFirst({ where: { id: leadId, deletedAt: null } });
    if (!lead) throw new NotFoundException('Lead not found');
    const note = await this.prisma.activity.create({
      data: {
        leadId,
        userId,
        type: 'note',
        subject: 'Quick note',
        body: content,
        completedAt: new Date(),
      },
    });
    return note;
  }

  async getHotStreak(id: string) {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const logs = await this.prisma.leadScoreLog.findMany({
      where: { leadId: id, createdAt: { gte: sevenDaysAgo } },
      orderBy: { createdAt: 'asc' },
    });
    if (logs.length < 2) return { isHot: false, scoreDelta: 0 };
    const scoreDelta = logs[logs.length - 1].newScore - logs[0].previousScore;
    return { isHot: scoreDelta >= 20, scoreDelta, logsCount: logs.length };
  }

  async getDealVelocity(id: string) {
    const lead = await this.prisma.lead.findFirst({
      where: { id },
      select: { createdAt: true, closedAt: true, status: true, stageHistory: { orderBy: { enteredAt: 'asc' }, include: { toStage: true } } },
    });
    if (!lead) throw new NotFoundException('Lead not found');
    const daysTotal = lead.closedAt
      ? Math.floor((lead.closedAt.getTime() - lead.createdAt.getTime()) / 86400000)
      : Math.floor((Date.now() - lead.createdAt.getTime()) / 86400000);
    return {
      daysTotal,
      isWon: lead.status === 'won',
      createdAt: lead.createdAt,
      closedAt: lead.closedAt,
      stageVelocity: lead.stageHistory.map((h, i, arr) => {
        const next = arr[i + 1];
        const daysInStage = next
          ? Math.floor((next.enteredAt.getTime() - h.enteredAt.getTime()) / 86400000)
          : Math.floor((Date.now() - h.enteredAt.getTime()) / 86400000);
        return { stage: h.toStage?.name ?? 'Unknown', daysInStage };
      }),
    };
  }

  async getChurnRisk(id: string) {
    const lead = await this.prisma.lead.findFirst({
      where: { id, deletedAt: null },
      include: {
        activities: { orderBy: { createdAt: 'desc' }, take: 1, select: { createdAt: true } },
        stageHistory: { orderBy: { enteredAt: 'desc' }, take: 1 },
      },
    });
    if (!lead) throw new NotFoundException('Lead not found');
    let riskScore = 0;
    const daysSinceActivity = lead.activities[0]
      ? Math.floor((Date.now() - lead.activities[0].createdAt.getTime()) / 86400000)
      : 999;
    if (daysSinceActivity > 30) riskScore += 30;
    else if (daysSinceActivity > 14) riskScore += 15;
    const daysInStage = lead.stageHistory[0]
      ? Math.floor((Date.now() - lead.stageHistory[0].enteredAt.getTime()) / 86400000)
      : 0;
    if (daysInStage > 30) riskScore += 25;
    else if (daysInStage > 14) riskScore += 10;
    const score = lead.score ?? 0;
    if (score < 20) riskScore += 30;
    else if (score < 40) riskScore += 15;
    const level = riskScore >= 60 ? 'high' : riskScore >= 30 ? 'medium' : 'low';
    return { riskScore, level, daysSinceActivity, daysInStage, leadScore: score };
  }

  async markRead(id: string, userId: string) {
    const lead = await this.prisma.lead.findFirst({ where: { id }, select: { customFields: true } });
    if (!lead) throw new NotFoundException('Lead not found');
    const cf = (lead.customFields as Record<string, unknown> | null) ?? {};
    const readBy = (cf.readBy as string[] | undefined) ?? [];
    if (!readBy.includes(userId)) {
      await this.prisma.lead.update({ where: { id }, data: { customFields: { ...cf, readBy: [...readBy, userId] } } });
    }
    return { read: true };
  }

  async addNote(id: string, content: string, isInternal: boolean, userId: string) {
    const lead = await this.prisma.lead.findFirst({ where: { id, deletedAt: null } });
    if (!lead) throw new NotFoundException('Lead not found');
    return this.prisma.leadNote.create({
      data: { leadId: id, body: content, isInternal, userId },
      include: { user: { select: { id: true, name: true } } },
    });
  }

  async getNotes(id: string) {
    return this.prisma.leadNote.findMany({
      where: { leadId: id },
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { id: true, name: true } } },
    });
  }

  async getNeedsAttention(access?: { role?: string; teamId?: string | null; userId?: string }) {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const where: Prisma.LeadWhereInput = {
      deletedAt: null,
      status: { notIn: ['won', 'lost'] },
      activities: {
        none: {
          createdAt: { gte: thirtyDaysAgo },
        },
      },
    };
    if (access?.role === 'salesperson' || access?.role === 'sales_rep') {
      where.assignedToId = access.userId;
    } else if (access?.role === 'sales_manager' && access?.teamId) {
      where.assignedTo = { teamId: access.teamId };
    }
    const leads = await this.prisma.lead.findMany({
      where,
      take: 20,
      orderBy: { updatedAt: 'asc' },
      include: { currentStage: true, organization: true, assignedTo: { select: { id: true, name: true } } },
    });
    return leads;
  }
}
