import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

type Access = { role?: string; teamId?: string | null };

@Injectable()
export class SearchService {
  constructor(private prisma: PrismaService) {}

  private leadTeamFilter(access?: Access) {
    if (access?.role === 'sales_manager' && access?.teamId) {
      return { assignedTo: { teamId: access.teamId } };
    }
    return {};
  }

  async search(q: string, limit: number, access?: Access) {
    if (!q || q.length < 2) {
      return { leads: [], contacts: [], organizations: [] };
    }
    const teamId = access?.role === 'sales_manager' ? access?.teamId : undefined;
    const [leads, contacts, organizations] = await Promise.all([
      this.prisma.lead.findMany({
        where: {
          deletedAt: null,
          ...this.leadTeamFilter(access),
          OR: [
            { title: { contains: q, mode: 'insensitive' } },
            { organization: { name: { contains: q, mode: 'insensitive' } } },
          ],
        },
        take: limit,
        select: { id: true, title: true },
      }),
      this.prisma.contact.findMany({
        where: {
          ...(teamId
            ? { leadsAsPrimary: { some: { assignedTo: { teamId } } } }
            : {}),
          OR: [
            { firstName: { contains: q, mode: 'insensitive' } },
            { lastName: { contains: q, mode: 'insensitive' } },
            { email: { contains: q, mode: 'insensitive' } },
          ],
        },
        take: limit,
        select: { id: true, firstName: true, lastName: true, email: true },
      }),
      this.prisma.organization.findMany({
        where: {
          ...(teamId ? { leads: { some: { assignedTo: { teamId } } } } : {}),
          name: { contains: q, mode: 'insensitive' },
        },
        take: limit,
        select: { id: true, name: true },
      }),
    ]);
    return {
      leads: leads.map((l) => ({ id: l.id, title: l.title, type: 'lead' as const })),
      contacts: contacts.map((c) => ({
        id: c.id,
        label: [c.firstName, c.lastName].filter(Boolean).join(' ') || c.email,
        type: 'contact' as const,
      })),
      organizations: organizations.map((o) => ({ id: o.id, name: o.name, type: 'organization' as const })),
    };
  }
}
