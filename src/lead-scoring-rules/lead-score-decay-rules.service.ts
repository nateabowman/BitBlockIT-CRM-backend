import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class LeadScoreDecayRulesService {
  constructor(private prisma: PrismaService) {}

  async findAll(activeOnly = false) {
    const where = activeOnly ? { isActive: true } : {};
    return this.prisma.leadScoreDecayRule.findMany({ where, orderBy: { name: 'asc' } });
  }

  async findOne(id: string) {
    const r = await this.prisma.leadScoreDecayRule.findUnique({ where: { id } });
    if (!r) throw new NotFoundException('Decay rule not found');
    return r;
  }

  async create(data: {
    name: string;
    pointsPerDay: number;
    noActivityDays: number;
    minScore?: number;
    isActive?: boolean;
  }) {
    return this.prisma.leadScoreDecayRule.create({
      data: {
        name: data.name,
        pointsPerDay: data.pointsPerDay,
        noActivityDays: data.noActivityDays,
        minScore: data.minScore ?? 0,
        isActive: data.isActive ?? true,
      },
    });
  }

  async update(
    id: string,
    data: { name?: string; pointsPerDay?: number; noActivityDays?: number; minScore?: number; isActive?: boolean },
  ) {
    await this.findOne(id);
    return this.prisma.leadScoreDecayRule.update({
      where: { id },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.pointsPerDay !== undefined && { pointsPerDay: data.pointsPerDay }),
        ...(data.noActivityDays !== undefined && { noActivityDays: data.noActivityDays }),
        ...(data.minScore !== undefined && { minScore: data.minScore }),
        ...(data.isActive !== undefined && { isActive: data.isActive }),
      },
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.leadScoreDecayRule.delete({ where: { id } });
    return { message: 'Decay rule deleted' };
  }
}
