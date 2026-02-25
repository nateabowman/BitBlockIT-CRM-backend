import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ScoreDecayService {
  constructor(private prisma: PrismaService) {}

  /** Apply active decay rules: reduce score for leads with no recent activity */
  async applyDecay(): Promise<{ updated: number }> {
    const rules = await this.prisma.leadScoreDecayRule.findMany({
      where: { isActive: true },
    });
    let updated = 0;
    for (const rule of rules) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - rule.noActivityDays);
      const leads = await this.prisma.lead.findMany({
        where: {
          deletedAt: null,
          score: { gte: rule.minScore + rule.pointsPerDay * rule.noActivityDays },
          activities: { none: { createdAt: { gte: cutoff } } },
        },
        select: { id: true, score: true },
      });
      const decay = rule.pointsPerDay * rule.noActivityDays;
      for (const lead of leads) {
        const newScore = Math.max(rule.minScore, (lead.score ?? 0) - decay);
        await this.prisma.lead.update({
          where: { id: lead.id },
          data: { score: newScore, scoreUpdatedAt: new Date() },
        });
        await this.prisma.leadScoreLog.create({
          data: {
            leadId: lead.id,
            previousScore: lead.score,
            newScore,
            reason: `Decay: ${rule.name}`,
          },
        });
        updated++;
      }
    }
    return { updated };
  }
}
