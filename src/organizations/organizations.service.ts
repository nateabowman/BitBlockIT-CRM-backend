import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { BillingService } from '../billing/billing.service';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { UpdateOrganizationDto } from './dto/update-organization.dto';

type Access = { role?: string; teamId?: string | null };

@Injectable()
export class OrganizationsService {
  constructor(
    private prisma: PrismaService,
    private billing: BillingService,
  ) {}

  private teamFilter(access?: Access): Prisma.OrganizationWhereInput {
    if (access?.role === 'sales_manager' && access?.teamId) {
      return { leads: { some: { assignedTo: { teamId: access.teamId } } } };
    }
    return {};
  }

  async create(dto: CreateOrganizationDto) {
    const org = await this.prisma.organization.create({
      data: {
        name: dto.name,
        type: dto.type ?? 'prospect',
        domain: dto.domain,
        industry: dto.industry,
        address: dto.address,
        phone: dto.phone,
        customFields: dto.customFields as object | undefined,
      },
    });

    if (org.type === 'customer' && this.billing.isConfigured()) {
      try {
        const customer = await this.billing.createOrLinkCustomer({
          externalId: org.id,
          name: org.name,
        });
        await this.prisma.organization.update({
          where: { id: org.id },
          data: { billingCustomerId: customer.id },
        });
        return { ...org, billingCustomerId: customer.id };
      } catch (err) {
        console.error('Failed to sync organization to billing:', err);
      }
    }
    return org;
  }

  async findAll(skip?: number, take = 20, type?: 'prospect' | 'customer', access?: Access) {
    const where: Prisma.OrganizationWhereInput = { ...this.teamFilter(access) };
    if (type) where.type = type;
    const [data, total] = await Promise.all([
      this.prisma.organization.findMany({
        where,
        skip,
        take,
        orderBy: { name: 'asc' },
      }),
      this.prisma.organization.count({ where }),
    ]);
    return { data, total };
  }

  async findOne(id: string, access?: Access) {
    const where: Prisma.OrganizationWhereInput = { id, ...this.teamFilter(access) };
    const org = await this.prisma.organization.findFirst({
      where,
      include: {
        contacts: true,
        leads: { where: { deletedAt: null }, include: { currentStage: true } },
      },
    });
    if (!org) throw new NotFoundException('Organization not found');
    return org;
  }

  async update(id: string, dto: UpdateOrganizationDto, access?: Access) {
    const org = await this.findOne(id, access);
    const data: Prisma.OrganizationUpdateInput = {
      ...(dto.name !== undefined && { name: dto.name }),
      ...(dto.type !== undefined && { type: dto.type }),
      ...(dto.domain !== undefined && { domain: dto.domain }),
      ...(dto.industry !== undefined && { industry: dto.industry }),
      ...(dto.address !== undefined && { address: dto.address }),
      ...(dto.phone !== undefined && { phone: dto.phone }),
      ...(dto.customFields !== undefined && { customFields: dto.customFields as object }),
    };

    // Sync to billing when Organization becomes customer and billing is configured
    if (dto.type === 'customer' && !org.billingCustomerId && this.billing.isConfigured()) {
      try {
        const primaryContact = org.contacts?.find((c) => c.isPrimary) ?? org.contacts?.[0];
        const customer = await this.billing.createOrLinkCustomer({
          externalId: org.id,
          name: org.name,
          email: primaryContact?.email ?? undefined,
        });
        data.billingCustomerId = customer.id;
      } catch (err) {
        console.error('Failed to sync organization to billing:', err);
      }
    }

    return this.prisma.organization.update({
      where: { id },
      data,
    });
  }

  async getContacts(id: string, access?: Access) {
    await this.findOne(id, access);
    return this.prisma.contact.findMany({
      where: { organizationId: id },
      orderBy: [{ isPrimary: 'desc' }, { lastName: 'asc' }],
    });
  }

  async getLeads(id: string, access?: Access) {
    await this.findOne(id, access);
    return this.prisma.lead.findMany({
      where: { organizationId: id, deletedAt: null },
      include: { currentStage: true, assignedTo: { select: { id: true, name: true } } },
    });
  }

  // Item 350: Admin endpoint to link billing customer to org
  async linkBillingCustomer(id: string, access?: Access) {
    const org = await this.findOne(id, access);
    if (org.billingCustomerId) {
      return { data: org, message: 'Already linked to billing' };
    }
    if (!this.billing.isConfigured()) {
      throw new Error('Billing API not configured');
    }
    const primaryContact = org.contacts?.find((c) => c.isPrimary) ?? org.contacts?.[0];
    const customer = await this.billing.createOrLinkCustomer({
      externalId: org.id,
      name: org.name,
      email: primaryContact?.email ?? undefined,
    });
    const updated = await this.prisma.organization.update({
      where: { id },
      data: { billingCustomerId: customer.id },
    });
    return { data: updated, billingCustomerId: customer.id };
  }

  // Item 443: Unlink billing customer
  async unlinkBillingCustomer(id: string, access?: Access) {
    await this.findOne(id, access);
    const updated = await this.prisma.organization.update({
      where: { id },
      data: { billingCustomerId: null },
    });
    return { data: updated };
  }

  // Item 444: Backfill billing customers for orgs of type customer without billingCustomerId
  async backfillBillingCustomers(): Promise<{ synced: number; failed: number; skipped: number }> {
    if (!this.billing.isConfigured()) throw new Error('Billing API not configured');
    const orgs = await this.prisma.organization.findMany({
      where: { type: 'customer', billingCustomerId: null },
      include: { contacts: { where: { isPrimary: true }, take: 1 } },
    });

    let synced = 0;
    let failed = 0;
    let skipped = 0;

    for (const org of orgs) {
      try {
        const customer = await this.billing.createOrLinkCustomer({
          externalId: org.id,
          name: org.name,
          email: org.contacts[0]?.email ?? undefined,
        });
        await this.prisma.organization.update({
          where: { id: org.id },
          data: { billingCustomerId: customer.id },
        });
        synced++;
      } catch {
        failed++;
      }
    }

    return { synced, failed, skipped };
  }
}
