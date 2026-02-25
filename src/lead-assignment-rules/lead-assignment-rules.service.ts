import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class LeadAssignmentRulesService {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    return this.prisma.leadAssignmentRule.findMany({
      where: { isActive: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  async findAllAdmin() {
    return this.prisma.leadAssignmentRule.findMany({ orderBy: { createdAt: 'asc' } });
  }

  async create(data: { type: string; config: Record<string, unknown>; isActive?: boolean }) {
    return this.prisma.leadAssignmentRule.create({
      data: {
        type: data.type,
        config: data.config as object,
        isActive: data.isActive ?? true,
      },
    });
  }

  async update(id: string, data: { type?: string; config?: Record<string, unknown>; isActive?: boolean }) {
    return this.prisma.leadAssignmentRule.update({
      where: { id },
      data: { ...data, config: data.config as object | undefined },
    });
  }

  async remove(id: string) {
    await this.prisma.leadAssignmentRule.delete({ where: { id } });
    return { message: 'Rule deleted' };
  }

  /** Get assignee for new lead (round_robin or by_source). Returns userId or null */
  async getAssigneeForNewLead(source?: string): Promise<string | null> {
    const rules = await this.prisma.leadAssignmentRule.findMany({
      where: { isActive: true },
      orderBy: { createdAt: 'asc' },
    });
    for (const rule of rules) {
      if (rule.type === 'round_robin') {
        const config = rule.config as { userIds?: string[] };
        const userIds = config?.userIds as string[] | undefined;
        if (!userIds?.length) continue;
        const lastAssigned = await this.prisma.lead.findFirst({
          where: { assignedToId: { in: userIds } },
          orderBy: { createdAt: 'desc' },
          select: { assignedToId: true },
        });
        const currentIndex = lastAssigned
          ? userIds.indexOf(lastAssigned.assignedToId!)
          : -1;
        const nextIndex = (currentIndex + 1) % userIds.length;
        return userIds[nextIndex] ?? null;
      }
      if (rule.type === 'by_source' && source) {
        const config = rule.config as { sourceToUserId?: Record<string, string> };
        const userId = config?.sourceToUserId?.[source];
        if (userId) return userId;
      }
    }
    return null;
  }
}
