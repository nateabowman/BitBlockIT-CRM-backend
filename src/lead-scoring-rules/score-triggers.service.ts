import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ScoreTriggersService {
  constructor(private prisma: PrismaService) {}

  async findAll(activeOnly = false) {
    const where = activeOnly ? { isActive: true } : {};
    return this.prisma.scoreTrigger.findMany({ where, orderBy: { threshold: 'asc' } });
  }

  async findOne(id: string) {
    const t = await this.prisma.scoreTrigger.findUnique({ where: { id } });
    if (!t) throw new NotFoundException('Score trigger not found');
    return t;
  }

  async create(data: { name: string; threshold: number; action: string; config: Record<string, unknown>; isActive?: boolean }) {
    return this.prisma.scoreTrigger.create({
      data: {
        name: data.name,
        threshold: data.threshold,
        action: data.action,
        config: data.config as object,
        isActive: data.isActive ?? true,
      },
    });
  }

  async update(id: string, data: { name?: string; threshold?: number; action?: string; config?: Record<string, unknown>; isActive?: boolean }) {
    await this.findOne(id);
    return this.prisma.scoreTrigger.update({
      where: { id },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.threshold !== undefined && { threshold: data.threshold }),
        ...(data.action !== undefined && { action: data.action }),
        ...(data.config !== undefined && { config: data.config as object }),
        ...(data.isActive !== undefined && { isActive: data.isActive }),
      },
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.scoreTrigger.delete({ where: { id } });
    return { message: 'Score trigger deleted' };
  }

  /** Evaluate triggers for a lead that just reached newScore; run add_tag or enroll_sequence */
  async evaluateForLead(leadId: string, newScore: number): Promise<void> {
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      select: { primaryContactId: true },
    });
    if (!lead?.primaryContactId) return;
    const triggers = await this.prisma.scoreTrigger.findMany({
      where: { isActive: true, threshold: { lte: newScore } },
      orderBy: { threshold: 'desc' },
    });
    for (const t of triggers) {
      const config = t.config as { tagId?: string; sequenceId?: string };
      if (t.action === 'add_tag' && config?.tagId) {
        try {
          await this.prisma.leadTag.upsert({
            where: { leadId_tagId: { leadId, tagId: config.tagId } },
            create: { leadId, tagId: config.tagId },
            update: {},
          });
        } catch {
          // tag may not exist
        }
      }
      if (t.action === 'enroll_sequence' && config?.sequenceId) {
        try {
          await this.prisma.sequenceEnrollment.create({
            data: {
              sequenceId: config.sequenceId,
              leadId,
              contactId: lead.primaryContactId,
              state: 'active',
            },
          });
        } catch {
          // already enrolled
        }
      }
    }
  }
}
