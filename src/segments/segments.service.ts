import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSegmentDto } from './dto/create-segment.dto';
import { UpdateSegmentDto } from './dto/update-segment.dto';
import { Prisma } from '@prisma/client';

export type CustomFieldFilter = {
  key: string;
  op: 'equals' | 'contains' | 'exists';
  value?: string;
};

export type SegmentFilters = {
  pipelineId?: string;
  stageIds?: string[];
  tagIds?: string[];
  source?: string;
  organizationId?: string;
  notUnsubscribed?: boolean;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  scoreMin?: number;
  scoreMax?: number;
  createdAtAfter?: string;
  createdAtBefore?: string;
  notBounced?: boolean;
  customFieldFilters?: CustomFieldFilter[];
  /** Segment by sequence: sequenceId + sequenceEnrollment */
  sequenceId?: string;
  sequenceEnrollment?: 'enrolled' | 'not_enrolled' | 'completed';
  /** Segment by campaign engagement: campaignId + campaignEngagement */
  campaignId?: string;
  campaignEngagement?: 'opened' | 'clicked' | 'never_opened';
};

export type SegmentRecipient = {
  leadId: string;
  contactId: string;
  email: string;
};

@Injectable()
export class SegmentsService {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    return this.prisma.segment.findMany({
      orderBy: { name: 'asc' },
      include: {
        organization: { select: { id: true, name: true } },
        excludeSegment: { select: { id: true, name: true } },
      },
    });
  }

  async findOne(id: string) {
    const segment = await this.prisma.segment.findUnique({
      where: { id },
      include: {
        organization: { select: { id: true, name: true } },
        excludeSegment: { select: { id: true, name: true } },
      },
    });
    if (!segment) throw new NotFoundException('Segment not found');
    return segment;
  }

  async create(dto: CreateSegmentDto) {
    return this.prisma.segment.create({
      data: {
        name: dto.name,
        filters: dto.filters as object,
        organizationId: dto.organizationId ?? null,
        excludeSegmentId: dto.excludeSegmentId ?? null,
        type: dto.type ?? 'static',
      },
      include: { organization: { select: { id: true, name: true } }, excludeSegment: { select: { id: true, name: true } } },
    });
  }

  async update(id: string, dto: UpdateSegmentDto) {
    await this.findOne(id);
    return this.prisma.segment.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.filters !== undefined && { filters: dto.filters as object }),
        ...(dto.organizationId !== undefined && { organizationId: dto.organizationId }),
        ...(dto.excludeSegmentId !== undefined && { excludeSegmentId: dto.excludeSegmentId }),
        ...(dto.type !== undefined && { type: dto.type }),
      },
      include: { organization: { select: { id: true, name: true } }, excludeSegment: { select: { id: true, name: true } } },
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.segment.delete({ where: { id } });
    return { message: 'Segment deleted' };
  }

  /**
   * Resolve segment filters to a list of recipients (leadId, contactId, email).
   * Only includes leads that have a primary contact with email; excludes unsubscribed/bounced unless filter says otherwise.
   */
  async resolveRecipients(segmentId: string, limit = 10_000): Promise<SegmentRecipient[]> {
    let recipients = await this.resolveRecipientsInternal(segmentId, limit);
    const segment = await this.prisma.segment.findUnique({ where: { id: segmentId }, select: { excludeSegmentId: true } });
    if (segment?.excludeSegmentId && recipients.length > 0) {
      const exclude = await this.resolveRecipientsInternal(segment.excludeSegmentId, 100_000);
      const excludeSet = new Set(exclude.map((r) => r.contactId));
      recipients = recipients.filter((r) => !excludeSet.has(r.contactId));
    }
    return recipients;
  }

  private async resolveRecipientsInternal(segmentId: string, limit: number): Promise<SegmentRecipient[]> {
    const segment = await this.findOne(segmentId);
    const filters = segment.filters as SegmentFilters;
    const where: Prisma.LeadWhereInput = { deletedAt: null };

    if (filters.pipelineId) where.pipelineId = filters.pipelineId;
    if (filters.stageIds?.length) where.currentStageId = { in: filters.stageIds };
    if (filters.tagIds?.length) {
      where.tags = { some: { tagId: { in: filters.tagIds } } };
    }
    if (filters.source) where.source = filters.source;
    if (filters.organizationId) where.organizationId = filters.organizationId;
    if (segment.organizationId) where.organizationId = segment.organizationId;
    if (filters.utmSource) where.utmSource = filters.utmSource;
    if (filters.utmMedium) where.utmMedium = filters.utmMedium;
    if (filters.utmCampaign) where.utmCampaign = filters.utmCampaign;
    if (filters.scoreMin != null) where.score = { gte: filters.scoreMin };
    if (filters.scoreMax != null) {
      if (filters.scoreMin != null) (where.score as { gte?: number; lte?: number }).lte = filters.scoreMax;
      else where.score = { lte: filters.scoreMax };
    }
    if (filters.createdAtAfter || filters.createdAtBefore) {
      where.createdAt = {};
      if (filters.createdAtAfter) (where.createdAt as { gte?: Date }).gte = new Date(filters.createdAtAfter);
      if (filters.createdAtBefore) (where.createdAt as { lte?: Date }).lte = new Date(filters.createdAtBefore);
    }

    if (filters.customFieldFilters?.length) {
      where.AND = (where.AND as Prisma.LeadWhereInput[] | undefined) ?? [];
      for (const cf of filters.customFieldFilters) {
        if (cf.op === 'equals' && cf.value != null) {
          (where.AND as Prisma.LeadWhereInput[]).push({
            customFields: { path: [cf.key], equals: cf.value },
          });
        } else if (cf.op === 'contains' && cf.value != null) {
          (where.AND as Prisma.LeadWhereInput[]).push({
            customFields: { path: [cf.key], string_contains: cf.value },
          });
        } else if (cf.op === 'exists') {
          (where.AND as Prisma.LeadWhereInput[]).push({
            customFields: { path: [cf.key], not: Prisma.JsonNull },
          });
        }
      }
    }

    if (filters.sequenceId) {
      const enrollment = filters.sequenceEnrollment ?? 'enrolled';
      if (enrollment === 'enrolled') {
        where.sequenceEnrollments = { some: { sequenceId: filters.sequenceId, state: { in: ['active', 'paused'] } } };
      } else if (enrollment === 'not_enrolled') {
        where.sequenceEnrollments = { none: { sequenceId: filters.sequenceId } };
      } else {
        where.sequenceEnrollments = { some: { sequenceId: filters.sequenceId, state: 'completed' } };
      }
    }

    let primaryContactEngagement: Prisma.ContactWhereInput | undefined;
    if (filters.campaignId && filters.campaignEngagement) {
      const campaignId = filters.campaignId;
      const engagement = filters.campaignEngagement;
      if (engagement === 'opened') {
        primaryContactEngagement = { campaignSends: { some: { campaignId, trackingEvents: { some: { type: 'open' } } } } };
      } else if (engagement === 'clicked') {
        primaryContactEngagement = { campaignSends: { some: { campaignId, trackingEvents: { some: { type: 'click' } } } } };
      } else {
        primaryContactEngagement = { campaignSends: { some: { campaignId, trackingEvents: { none: { type: 'open' } } } } };
      }
    }

    where.primaryContactId = { not: null };
    where.primaryContact = {
      email: { not: '' },
      ...(filters.notUnsubscribed !== false && { unsubscribedAt: null }),
      ...(filters.notBounced === true && { bouncedAt: null }),
      dncAt: null, // always exclude do-not-contact
      ...primaryContactEngagement,
    };

    const leads = await this.prisma.lead.findMany({
      where,
      select: {
        id: true,
        primaryContactId: true,
        primaryContact: { select: { id: true, email: true } },
      },
      take: limit,
    });

    return leads
      .filter((l) => l.primaryContact?.email)
      .map((l) => ({
        leadId: l.id,
        contactId: l.primaryContact!.id,
        email: l.primaryContact!.email,
      }));
  }

  /** Return approximate recipient count for segment (optionally excluding another segment). */
  async getRecipientCount(segmentId: string): Promise<number> {
    const recipients = await this.resolveRecipients(segmentId, 50_000);
    return recipients.length;
  }
}
