import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class TagsService {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    return this.prisma.tag.findMany({ orderBy: { name: 'asc' } });
  }

  async create(data: { name: string; color?: string }) {
    return this.prisma.tag.create({
      data: { name: data.name.trim(), color: data.color },
    });
  }

  async update(id: string, data: { name?: string; color?: string }) {
    await this.prisma.tag.findUniqueOrThrow({ where: { id } });
    return this.prisma.tag.update({ where: { id }, data });
  }

  async remove(id: string) {
    await this.prisma.tag.findUniqueOrThrow({ where: { id } });
    await this.prisma.tag.delete({ where: { id } });
    return { message: 'Tag deleted' };
  }

  async addToLead(leadId: string, tagId: string) {
    await this.prisma.lead.findFirstOrThrow({ where: { id: leadId, deletedAt: null } });
    await this.prisma.tag.findUniqueOrThrow({ where: { id: tagId } });
    await this.prisma.leadTag.upsert({
      where: { leadId_tagId: { leadId, tagId } },
      create: { leadId, tagId },
      update: {},
    });
    return this.prisma.lead.findUnique({
      where: { id: leadId },
      include: { tags: { include: { tag: true } } },
    });
  }

  async removeFromLead(leadId: string, tagId: string) {
    await this.prisma.leadTag.deleteMany({ where: { leadId, tagId } });
    return { message: 'Tag removed' };
  }

  async bulkAddTag(leadIds: string[], tagId: string) {
    await this.prisma.tag.findUniqueOrThrow({ where: { id: tagId } });
    await this.prisma.leadTag.createMany({
      data: leadIds.map((leadId) => ({ leadId, tagId })),
      skipDuplicates: true,
    });
    return { updated: leadIds.length };
  }

  async bulkRemoveTag(leadIds: string[], tagId: string) {
    const result = await this.prisma.leadTag.deleteMany({
      where: { leadId: { in: leadIds }, tagId },
    });
    return { removed: result.count };
  }
}
