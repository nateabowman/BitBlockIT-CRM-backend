import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LeadScoringRulesService } from '../lead-scoring-rules/lead-scoring-rules.service';
import { ScoreTriggersService } from '../lead-scoring-rules/score-triggers.service';
import { CreateActivityDto } from './dto/create-activity.dto';
import { UpdateActivityDto } from './dto/update-activity.dto';
import { Prisma } from '@prisma/client';

@Injectable()
export class ActivitiesService {
  constructor(
    private prisma: PrismaService,
    private scoringRules: LeadScoringRulesService,
    private scoreTriggers: ScoreTriggersService,
  ) {}

  async create(userId: string, dto: CreateActivityDto) {
    const activity = await this.prisma.activity.create({
      data: {
        leadId: dto.leadId,
        contactId: dto.contactId,
        userId,
        assignedToId: dto.assignedToId,
        type: dto.type,
        subject: dto.subject,
        body: dto.body,
        outcome: dto.outcome,
        scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : null,
        reminderAt: dto.reminderAt ? new Date(dto.reminderAt) : null,
        recurrenceRule: dto.recurrenceRule,
        recurrenceEndAt: dto.recurrenceEndAt ? new Date(dto.recurrenceEndAt) : null,
        emailThreadId: dto.emailThreadId,
        metadata: (dto.metadata ?? undefined) as object | undefined,
      },
      include: {
        lead: true,
        user: { select: { id: true, name: true, email: true } },
        contact: true,
        assignedTo: { select: { id: true, name: true } },
      },
    });
    const points = await this.scoringRules.evaluateForActivity(dto.type);
    if (points !== 0 && activity.lead) {
      const previousScore = activity.lead.score ?? 0;
      const newScore = previousScore + points;
      await this.prisma.$transaction([
        this.prisma.lead.update({
          where: { id: dto.leadId },
          data: { score: newScore, scoreUpdatedAt: new Date() },
        }),
        this.prisma.leadScoreLog.create({
          data: {
            leadId: dto.leadId,
            previousScore,
            newScore,
            reason: `Activity: ${dto.type}`,
          },
        }),
      ]);
      this.scoreTriggers.evaluateForLead(dto.leadId, newScore).catch(() => {});
    }
    // Follow-up task automation: when type = meeting, create follow-up task N days later
    const typeLower = (dto.type || '').toLowerCase();
    if (typeLower === 'meeting' && dto.scheduledAt) {
      const scheduled = new Date(dto.scheduledAt);
      const followUpDate = new Date(scheduled);
      followUpDate.setDate(followUpDate.getDate() + 1);
      await this.prisma.activity.create({
        data: {
          leadId: dto.leadId,
          contactId: dto.contactId,
          userId,
          assignedToId: dto.assignedToId ?? userId,
          type: 'task',
          subject: `Follow-up: ${dto.subject ?? 'Meeting'}`,
          scheduledAt: followUpDate,
          reminderAt: followUpDate,
        },
      });
    }
    return activity;
  }

  async findAll(query: {
    leadId?: string;
    contactId?: string;
    userId?: string;
    assignedToId?: string;
    type?: string;
    outcome?: string;
    dateFrom?: string;
    dateTo?: string;
    scheduledFrom?: string;
    scheduledTo?: string;
    page?: number;
    limit?: number;
  }) {
    const where: Prisma.ActivityWhereInput = {};
    if (query.leadId) where.leadId = query.leadId;
    if (query.contactId) where.contactId = query.contactId;
    if (query.userId) where.userId = query.userId;
    if (query.assignedToId) where.assignedToId = query.assignedToId;
    if (query.type) where.type = query.type;
    if (query.outcome) where.outcome = query.outcome;
    if (query.dateFrom || query.dateTo) {
      where.createdAt = {};
      if (query.dateFrom) (where.createdAt as Prisma.DateTimeFilter).gte = new Date(query.dateFrom);
      if (query.dateTo) (where.createdAt as Prisma.DateTimeFilter).lte = new Date(query.dateTo);
    }
    if (query.scheduledFrom || query.scheduledTo) {
      where.scheduledAt = {};
      if (query.scheduledFrom) (where.scheduledAt as Prisma.DateTimeNullableFilter).gte = new Date(query.scheduledFrom);
      if (query.scheduledTo) (where.scheduledAt as Prisma.DateTimeNullableFilter).lte = new Date(query.scheduledTo);
    }
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const [data, total] = await Promise.all([
      this.prisma.activity.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          lead: { select: { id: true, title: true, currentStage: true } },
          user: { select: { id: true, name: true } },
          assignedTo: { select: { id: true, name: true } },
          contact: true,
        },
      }),
      this.prisma.activity.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  async findUpcoming(userId?: string, limit = 20) {
    const where: Prisma.ActivityWhereInput = {
      completedAt: null,
      scheduledAt: { gte: new Date() },
    };
    if (userId) where.OR = [{ userId }, { assignedToId: userId }];
    return this.prisma.activity.findMany({
      where,
      orderBy: { scheduledAt: 'asc' },
      take: limit,
      include: {
        lead: { select: { id: true, title: true } },
        user: { select: { id: true, name: true } },
        assignedTo: { select: { id: true, name: true } },
      },
    });
  }

  async findOverdue(userId?: string, limit = 50) {
    const where: Prisma.ActivityWhereInput = {
      completedAt: null,
      scheduledAt: { lt: new Date() },
    };
    if (userId) where.OR = [{ userId }, { assignedToId: userId }];
    return this.prisma.activity.findMany({
      where,
      orderBy: { scheduledAt: 'asc' },
      take: limit,
      include: {
        lead: { select: { id: true, title: true } },
        user: { select: { id: true, name: true } },
        assignedTo: { select: { id: true, name: true } },
      },
    });
  }

  async completeTask(id: string, userId: string) {
    const activity = await this.findOne(id);
    if (activity.completedAt) return activity;
    return this.prisma.activity.update({
      where: { id },
      data: { completedAt: new Date() },
      include: {
        lead: true,
        user: { select: { id: true, name: true } },
        assignedTo: { select: { id: true, name: true } },
        contact: true,
      },
    });
  }

  async reschedule(id: string, scheduledAt: Date) {
    await this.findOne(id);
    return this.prisma.activity.update({
      where: { id },
      data: { scheduledAt, reminderAt: scheduledAt },
      include: {
        lead: { select: { id: true, title: true } },
        user: { select: { id: true, name: true } },
        assignedTo: { select: { id: true, name: true } },
      },
    });
  }

  async findOne(id: string) {
    const activity = await this.prisma.activity.findUnique({
      where: { id },
      include: {
        lead: true,
        contact: true,
        user: { select: { id: true, name: true, email: true } },
        assignedTo: { select: { id: true, name: true } },
        attachments: true,
      },
    });
    if (!activity) throw new NotFoundException('Activity not found');
    return activity;
  }

  async update(id: string, dto: UpdateActivityDto) {
    await this.findOne(id);
    return this.prisma.activity.update({
      where: { id },
      data: {
        subject: dto.subject,
        body: dto.body,
        outcome: dto.outcome,
        assignedToId: dto.assignedToId,
        scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : undefined,
        completedAt: dto.completedAt ? new Date(dto.completedAt) : undefined,
        reminderAt: dto.reminderAt ? new Date(dto.reminderAt) : undefined,
        recurrenceRule: dto.recurrenceRule,
        recurrenceEndAt: dto.recurrenceEndAt ? new Date(dto.recurrenceEndAt) : undefined,
        metadata: dto.metadata as object | undefined,
      },
      include: {
        lead: true,
        user: { select: { id: true, name: true } },
        assignedTo: { select: { id: true, name: true } },
        contact: true,
        attachments: true,
      },
    });
  }

  async exportCsv(query: { leadId?: string; userId?: string; assignedToId?: string; dateFrom?: string; dateTo?: string; type?: string; outcome?: string }) {
    const where: Prisma.ActivityWhereInput = {};
    if (query.leadId) where.leadId = query.leadId;
    if (query.userId) where.userId = query.userId;
    if (query.assignedToId) where.assignedToId = query.assignedToId;
    if (query.type) where.type = query.type;
    if (query.outcome) where.outcome = { contains: query.outcome, mode: 'insensitive' };
    if (query.dateFrom || query.dateTo) {
      where.createdAt = {};
      if (query.dateFrom) (where.createdAt as Prisma.DateTimeFilter).gte = new Date(query.dateFrom);
      if (query.dateTo) (where.createdAt as Prisma.DateTimeFilter).lte = new Date(query.dateTo);
    }
    const activities = await this.prisma.activity.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 5000,
      include: { lead: { select: { title: true } }, user: { select: { name: true } } },
    });
    const headers = ['Date', 'Type', 'Subject', 'Lead', 'User', 'Outcome', 'Scheduled', 'Completed'];
    const rows = activities.map((a) => [
      a.createdAt.toISOString(),
      a.type,
      a.subject ?? '',
      a.lead?.title ?? '',
      a.user?.name ?? '',
      a.outcome ?? '',
      a.scheduledAt?.toISOString() ?? '',
      a.completedAt?.toISOString() ?? '',
    ]);
    const csv = [headers.join(','), ...rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))].join('\n');
    return csv;
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.activity.delete({ where: { id } });
    return { message: 'Activity deleted' };
  }

  async addAttachment(
    activityId: string,
    data: { storageKey: string; fileName: string; mimeType?: string; sizeBytes?: number },
  ) {
    await this.findOne(activityId);
    return this.prisma.activityAttachment.create({
      data: {
        activityId,
        storageKey: data.storageKey,
        fileName: data.fileName,
        mimeType: data.mimeType,
        sizeBytes: data.sizeBytes,
      },
    });
  }

  async removeAttachment(activityId: string, attachmentId: string) {
    await this.findOne(activityId);
    await this.prisma.activityAttachment.deleteMany({
      where: { id: attachmentId, activityId },
    });
    return { message: 'Attachment removed' };
  }
}
