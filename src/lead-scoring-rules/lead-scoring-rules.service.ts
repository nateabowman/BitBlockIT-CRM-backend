import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class LeadScoringRulesService {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    return this.prisma.leadScoringRule.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } });
  }

  async findAllAdmin() {
    return this.prisma.leadScoringRule.findMany({ orderBy: { name: 'asc' } });
  }

  async create(data: {
    name: string;
    triggerType: string;
    triggerConfig: Record<string, unknown>;
    points: number;
    isActive?: boolean;
  }) {
    return this.prisma.leadScoringRule.create({
      data: {
        name: data.name,
        triggerType: data.triggerType,
        triggerConfig: data.triggerConfig as object,
        points: data.points,
        isActive: data.isActive ?? true,
      },
    });
  }

  async update(
    id: string,
    data: {
      name?: string;
      triggerType?: string;
      triggerConfig?: Record<string, unknown>;
      points?: number;
      isActive?: boolean;
    },
  ) {
    return this.prisma.leadScoringRule.update({
      where: { id },
      data: { ...data, triggerConfig: data.triggerConfig as object | undefined },
    });
  }

  async remove(id: string) {
    await this.prisma.leadScoringRule.delete({ where: { id } });
    return { message: 'Rule deleted' };
  }

  /** Evaluate rules for activity type; returns total points to add */
  async evaluateForActivity(activityType: string): Promise<number> {
    const rules = await this.prisma.leadScoringRule.findMany({
      where: { isActive: true, triggerType: 'activity_type' },
    });
    let points = 0;
    for (const rule of rules) {
      const config = rule.triggerConfig as { activityType?: string };
      if (config?.activityType === activityType) points += rule.points;
    }
    return points;
  }

  /** Evaluate rules for stage change; returns total points to add */
  async evaluateForStageChange(stageId: string): Promise<number> {
    const rules = await this.prisma.leadScoringRule.findMany({
      where: { isActive: true, triggerType: 'stage_change' },
    });
    let points = 0;
    for (const rule of rules) {
      const config = rule.triggerConfig as { stageId?: string };
      if (config?.stageId === stageId) points += rule.points;
    }
    return points;
  }
}
