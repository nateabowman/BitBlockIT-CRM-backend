import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePipelineDto } from './dto/create-pipeline.dto';
import { UpdatePipelineDto } from './dto/update-pipeline.dto';
import { CreateStageDto } from './dto/create-stage.dto';
import { UpdateStageDto } from './dto/update-stage.dto';

@Injectable()
export class PipelinesService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreatePipelineDto) {
    const type = dto.type ?? 'lead';
    if (dto.isDefault) {
      await this.prisma.pipeline.updateMany({ where: { type }, data: { isDefault: false } });
    }
    const pipeline = await this.prisma.pipeline.create({
      data: {
        name: dto.name,
        type,
        isDefault: dto.isDefault ?? false,
      },
    });
    if (dto.stages?.length) {
      await this.prisma.pipelineStage.createMany({
        data: dto.stages.map((s, i) => ({
          pipelineId: pipeline.id,
          name: s.name,
          order: s.order ?? i,
          color: s.color,
          isWon: s.isWon ?? false,
          isLost: s.isLost ?? false,
        })),
      });
    }
    return this.findOne(pipeline.id);
  }

  async findAll() {
    return this.prisma.pipeline.findMany({
      include: { stages: { orderBy: { order: 'asc' } } },
      orderBy: { name: 'asc' },
    });
  }

  async findOne(id: string) {
    const pipeline = await this.prisma.pipeline.findUnique({
      where: { id },
      include: { stages: { orderBy: { order: 'asc' } } },
    });
    if (!pipeline) throw new NotFoundException('Pipeline not found');
    return pipeline;
  }

  async update(id: string, dto: UpdatePipelineDto) {
    const existing = await this.findOne(id);
    if (dto.isDefault === true && existing.type) {
      await this.prisma.pipeline.updateMany({
        where: { type: existing.type, id: { not: id } },
        data: { isDefault: false },
      });
    }
    return this.prisma.pipeline.update({
      where: { id },
      data: dto,
      include: { stages: { orderBy: { order: 'asc' } } },
    });
  }

  async getStages(pipelineId: string) {
    await this.findOne(pipelineId);
    return this.prisma.pipelineStage.findMany({
      where: { pipelineId },
      orderBy: { order: 'asc' },
    });
  }

  async createStage(pipelineId: string, dto: CreateStageDto) {
    await this.findOne(pipelineId);
    const maxOrder = await this.prisma.pipelineStage.aggregate({
      where: { pipelineId },
      _max: { order: true },
    });
    const order = dto.order ?? (maxOrder._max.order ?? -1) + 1;
    return this.prisma.pipelineStage.create({
      data: {
        pipelineId,
        name: dto.name,
        order,
        color: dto.color,
        isWon: dto.isWon ?? false,
        isLost: dto.isLost ?? false,
      },
    });
  }

  async updateStage(pipelineId: string, stageId: string, dto: UpdateStageDto) {
    await this.findOne(pipelineId);
    const stage = await this.prisma.pipelineStage.findFirst({
      where: { id: stageId, pipelineId },
    });
    if (!stage) throw new NotFoundException('Stage not found');
    return this.prisma.pipelineStage.update({
      where: { id: stageId },
      data: dto,
    });
  }

  async deleteStage(pipelineId: string, stageId: string) {
    await this.findOne(pipelineId);
    const stage = await this.prisma.pipelineStage.findFirst({
      where: { id: stageId, pipelineId },
    });
    if (!stage) throw new NotFoundException('Stage not found');
    await this.prisma.pipelineStage.delete({ where: { id: stageId } });
    return { message: 'Stage deleted' };
  }

  async reorderStages(pipelineId: string, stageIds: string[]) {
    await this.findOne(pipelineId);
    await Promise.all(
      stageIds.map((stageId, index) =>
        this.prisma.pipelineStage.updateMany({
          where: { id: stageId, pipelineId },
          data: { order: index },
        }),
      ),
    );
    return this.getStages(pipelineId);
  }

  async clone(id: string) {
    const source = await this.findOne(id);
    const pipeline = await this.prisma.pipeline.create({
      data: {
        name: `${source.name} (Copy)`,
        type: source.type,
        isDefault: false,
      },
    });
    if (source.stages?.length) {
      await this.prisma.pipelineStage.createMany({
        data: source.stages.map((s, i) => ({
          pipelineId: pipeline.id,
          name: s.name,
          order: s.order ?? i,
          color: s.color,
          isWon: s.isWon ?? false,
          isLost: s.isLost ?? false,
          requiredFieldKeys: s.requiredFieldKeys as object | undefined,
        })),
      });
    }
    return this.findOne(pipeline.id);
  }

  async getAnalytics(pipelineId: string) {
    await this.findOne(pipelineId);
    const stages = await this.prisma.pipelineStage.findMany({
      where: { pipelineId },
      orderBy: { order: 'asc' },
      include: {
        _count: { select: { leads: true } },
        stageHistoryTo: {
          select: { id: true, enteredAt: true, fromStageId: true },
          orderBy: { enteredAt: 'desc' },
          take: 5000,
        },
      },
    });
    const stageIds = stages.map((s) => s.id);
    const history = await this.prisma.leadStageHistory.findMany({
      where: { stageId: { in: stageIds } },
      select: { stageId: true, fromStageId: true, enteredAt: true, leadId: true },
    });
    const conversion: Record<string, Record<string, number>> = {};
    const avgTimeByStage: Record<string, number[]> = {};
    for (const h of history) {
      if (h.fromStageId) {
        conversion[h.fromStageId] = conversion[h.fromStageId] ?? {};
        conversion[h.fromStageId][h.stageId] = (conversion[h.fromStageId][h.stageId] ?? 0) + 1;
      }
      const toStage = stages.find((s) => s.id === h.stageId);
      if (toStage?.isWon || toStage?.isLost) {
        const lead = await this.prisma.lead.findUnique({
          where: { id: h.leadId },
          select: { createdAt: true },
        });
        if (lead) {
          const days = (h.enteredAt.getTime() - lead.createdAt.getTime()) / (1000 * 60 * 60 * 24);
          avgTimeByStage[h.stageId] = avgTimeByStage[h.stageId] ?? [];
          avgTimeByStage[h.stageId].push(days);
        }
      }
    }
    const avgTime: Record<string, number> = {};
    for (const [stageId, days] of Object.entries(avgTimeByStage)) {
      avgTime[stageId] = days.length ? days.reduce((a, b) => a + b, 0) / days.length : 0;
    }
    return {
      stages: stages.map((s) => ({ id: s.id, name: s.name, order: s.order, count: s._count.leads })),
      conversion,
      avgTimeToCloseByStage: avgTime,
    };
  }

  async getForecast(pipelineId: string, groupBy?: 'assignee' | 'team') {
    await this.findOne(pipelineId);
    const stages = await this.prisma.pipelineStage.findMany({
      where: { pipelineId, isWon: false, isLost: false },
      orderBy: { order: 'asc' },
    });
    const stageIds = stages.map((s) => s.id);
    const where = { pipelineId, currentStageId: { in: stageIds }, deletedAt: null };
    const leads = await this.prisma.lead.findMany({
      where,
      select: {
        amount: true,
        assignedToId: true,
        assignedTo: { select: { id: true, name: true, teamId: true, team: { select: { id: true, name: true } } } },
      },
    });
    const byKey: Record<string, { name: string; total: number; count: number }> = {};
    for (const lead of leads) {
      const amount = lead.amount ? Number(lead.amount) : 0;
      const key = groupBy === 'team' && lead.assignedTo?.teamId
        ? lead.assignedTo.teamId
        : groupBy === 'assignee' && lead.assignedToId
          ? lead.assignedToId
          : '_unassigned';
      const label = groupBy === 'team' && lead.assignedTo?.team
        ? lead.assignedTo.team.name
        : groupBy === 'assignee' && lead.assignedTo
          ? lead.assignedTo.name ?? lead.assignedToId
          : 'Unassigned';
      if (!byKey[key]) byKey[key] = { name: label ?? 'Unassigned', total: 0, count: 0 };
      byKey[key].total += amount;
      byKey[key].count += 1;
    }
    return { byGroup: Object.values(byKey), total: leads.reduce((sum, l) => sum + (l.amount ? Number(l.amount) : 0), 0) };
  }

  async archive(id: string) {
    const pipeline = await this.prisma.pipeline.findUnique({ where: { id } });
    if (!pipeline) throw new Error('Pipeline not found');
    return this.prisma.pipeline.update({ where: { id }, data: { isDefault: false } });
  }

  async restore(id: string) {
    return this.prisma.pipeline.findUnique({ where: { id } });
  }
}
