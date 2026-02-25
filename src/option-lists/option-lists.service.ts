import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class OptionListsService {
  constructor(private prisma: PrismaService) {}

  async findByType(type: string, pipelineId?: string) {
    const where: { type: string; pipelineId?: string | null } = { type };
    if (pipelineId) where.pipelineId = pipelineId;
    return this.prisma.optionList.findMany({
      where,
      orderBy: [{ order: 'asc' }, { label: 'asc' }],
    });
  }

  async create(data: { type: string; value: string; label: string; pipelineId?: string; order?: number }) {
    return this.prisma.optionList.create({
      data: {
        type: data.type,
        value: data.value,
        label: data.label,
        pipelineId: data.pipelineId,
        order: data.order ?? 0,
      },
    });
  }

  async update(id: string, data: { value?: string; label?: string; order?: number }) {
    return this.prisma.optionList.update({ where: { id }, data });
  }

  async remove(id: string) {
    await this.prisma.optionList.delete({ where: { id } });
    return { message: 'Option deleted' };
  }
}
