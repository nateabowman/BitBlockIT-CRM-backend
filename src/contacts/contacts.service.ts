import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateContactDto } from './dto/create-contact.dto';
import { UpdateContactDto } from './dto/update-contact.dto';

type Access = { role?: string; teamId?: string | null };

@Injectable()
export class ContactsService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  private teamFilter(access?: Access): Prisma.ContactWhereInput {
    if (access?.role === 'sales_manager' && access?.teamId) {
      return { leadsAsPrimary: { some: { assignedTo: { teamId: access.teamId } } } };
    }
    return {};
  }

  async create(dto: CreateContactDto) {
    const { consentAt, consentSource, ...rest } = dto;
    const data: Prisma.ContactUncheckedCreateInput = {
      ...rest,
      customFields: dto.customFields as object | undefined,
      consentAt: consentAt ? new Date(consentAt) : undefined,
      consentSource: consentSource ?? undefined,
    };
    return this.prisma.contact.create({
      data,
      include: { organization: true },
    });
  }

  async findAll(skip?: number, take = 20, access?: Access) {
    const where = this.teamFilter(access);
    const [data, total] = await Promise.all([
      this.prisma.contact.findMany({
        where,
        skip,
        take,
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
        include: { organization: true },
      }),
      this.prisma.contact.count({ where }),
    ]);
    return { data, total };
  }

  async findOne(id: string, access?: Access) {
    const where: Prisma.ContactWhereInput = { id, ...this.teamFilter(access) };
    const contact = await this.prisma.contact.findFirst({
      where,
      include: { organization: true, activities: { take: 20, orderBy: { createdAt: 'desc' } } },
    });
    if (!contact) throw new NotFoundException('Contact not found');
    return contact;
  }

  async update(id: string, dto: UpdateContactDto, access?: Access) {
    await this.findOne(id, access);
    const { unsubscribed, smsOptOut, dnc, consentAt, consentSource, ...rest } = dto;
    const data: Prisma.ContactUncheckedUpdateInput = {
      ...rest,
      customFields: rest.customFields as object | undefined,
    };
    if (unsubscribed !== undefined) data.unsubscribedAt = unsubscribed ? new Date() : null;
    if (smsOptOut !== undefined) data.smsOptOutAt = smsOptOut ? new Date() : null;
    if (dnc !== undefined) data.dncAt = dnc ? new Date() : null;
    if (consentAt !== undefined) data.consentAt = consentAt ? new Date(consentAt) : null;
    if (consentSource !== undefined) data.consentSource = consentSource;
    return this.prisma.contact.update({
      where: { id },
      data,
      include: { organization: true },
    });
  }

  /** GDPR/data export: full contact and related data as JSON-serializable object */
  async exportDataForContact(id: string, access?: Access) {
    const where: Prisma.ContactWhereInput = { id, ...this.teamFilter(access) };
    const contact = await this.prisma.contact.findFirst({
      where,
      include: {
        organization: true,
        activities: { orderBy: { createdAt: 'desc' }, include: { user: { select: { id: true, name: true } }, lead: { select: { id: true, title: true } } } },
      },
    });
    if (!contact) throw new NotFoundException('Contact not found');
    return this.serializeForExport(contact);
  }

  /** GDPR data package: contact + leads + activities + campaign sends + sequence enrollments + page views */
  async gdprExport(id: string, access?: Access) {
    const where: Prisma.ContactWhereInput = { id, ...this.teamFilter(access) };
    const contact = await this.prisma.contact.findFirst({
      where,
      include: {
        organization: true,
        activities: { orderBy: { createdAt: 'desc' }, include: { user: { select: { id: true, name: true } }, lead: { select: { id: true, title: true } } } },
        leadsAsPrimary: { include: { pipeline: true, currentStage: true } },
        campaignSends: { include: { campaign: { select: { id: true, name: true } } } },
        sequenceEnrollments: { include: { sequence: { select: { id: true, name: true } } } },
      },
    });
    if (!contact) throw new NotFoundException('Contact not found');
    const pageViews = await this.prisma.pageView.findMany({ where: { contactId: id }, orderBy: { createdAt: 'desc' }, take: 1000 });
    const visitorEvents = await this.prisma.visitorEvent.findMany({ where: { contactId: id }, orderBy: { createdAt: 'desc' }, take: 1000 });
    return this.serializeForExport({
      exportedAt: new Date(),
      contact,
      pageViews,
      visitorEvents,
    });
  }

  private serializeForExport(obj: unknown): unknown {
    if (obj === null || obj === undefined) return obj;
    if (obj instanceof Date) return obj.toISOString();
    if (Array.isArray(obj)) return obj.map((item) => this.serializeForExport(item));
    if (typeof obj === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(obj)) out[k] = this.serializeForExport(v);
      return out;
    }
    return obj;
  }

  /** Email timeline: all campaign sends for this contact with sent at, open, and click events */
  async getEmailTimeline(id: string, access?: Access) {
    const where: Prisma.ContactWhereInput = { id, ...this.teamFilter(access) };
    const contact = await this.prisma.contact.findFirst({ where, select: { id: true } });
    if (!contact) throw new NotFoundException('Contact not found');
    const sends = await this.prisma.campaignSend.findMany({
      where: { contactId: id },
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

  async getActivities(id: string, access?: Access) {
    await this.findOne(id, access);
    return this.prisma.activity.findMany({
      where: { contactId: id },
      orderBy: { createdAt: 'desc' },
      include: { lead: true, user: { select: { id: true, name: true } } },
    });
  }

  /** GDPR: permanent delete contact and related data; audit trail. */
  async hardDeleteContact(id: string, userId: string | undefined, access?: Access) {
    const where: Prisma.ContactWhereInput = { id, ...this.teamFilter(access) };
    const contact = await this.prisma.contact.findFirst({
      where,
      include: { organization: { select: { name: true } } },
    });
    if (!contact) throw new NotFoundException('Contact not found');
    const snapshot = {
      id: contact.id,
      firstName: contact.firstName,
      lastName: contact.lastName,
      email: contact.email,
      organizationId: contact.organizationId,
      organizationName: contact.organization?.name,
    };
    await this.audit.log({
      userId,
      resourceType: 'contact',
      resourceId: id,
      action: 'permanent_delete',
      oldValue: snapshot,
      newValue: null,
    });
    await this.prisma.contact.delete({ where: { id } });
    return { message: 'Contact permanently deleted' };
  }

  /** GDPR Right to Erasure: anonymize all PII, keep record shell for audit */
  async gdprErase(id: string, userId?: string) {
    const contact = await this.prisma.contact.findUnique({ where: { id } });
    if (!contact) throw new NotFoundException('Contact not found');
    const hash = Buffer.from(contact.email ?? contact.id).toString('base64').slice(0, 12);
    const anonymized = await this.prisma.contact.update({
      where: { id },
      data: {
        firstName: '[ERASED]',
        lastName: '[ERASED]',
        email: `erased-${hash}@gdpr-deleted.invalid`,
        phone: null,
        notes: null,
        linkedInUrl: null,
        twitterUrl: null,
        customFields: null,
        unsubscribedAt: new Date(),
      },
    });
    await this.audit.log({
      userId,
      resourceType: 'contact',
      resourceId: id,
      action: 'gdpr_erase',
      meta: { reason: 'GDPR right to erasure request' },
    });
    return { message: 'Contact data erased per GDPR request', id };
  }

  async getLastContacted(id: string, access?: Access) {
    const contact = await this.prisma.contact.findFirst({
      where: { id, ...this.teamFilter(access) },
    });
    if (!contact) throw new NotFoundException('Contact not found');
    const lastActivity = await this.prisma.activity.findFirst({
      where: { contactId: id },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true, type: true, subject: true },
    });
    return {
      lastContactedAt: lastActivity?.createdAt ?? null,
      lastActivityType: lastActivity?.type ?? null,
      lastActivitySubject: lastActivity?.subject ?? null,
    };
  }
}
