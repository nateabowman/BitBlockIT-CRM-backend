import { Injectable, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ActivityTypesService {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    return this.prisma.activityType.findMany({
      orderBy: { order: 'asc' },
    });
  }

  async create(data: { name: string; slug: string; isTask?: boolean; order?: number }) {
    const existing = await this.prisma.activityType.findUnique({ where: { slug: data.slug } });
    if (existing) throw new ConflictException('Activity type with this slug already exists');
    return this.prisma.activityType.create({
      data: {
        name: data.name,
        slug: data.slug,
        isTask: data.isTask ?? false,
        order: data.order ?? 0,
      },
    });
  }

  async update(id: string, data: { name?: string; slug?: string; isTask?: boolean; order?: number }) {
    if (data.slug) {
      const existing = await this.prisma.activityType.findFirst({ where: { slug: data.slug, id: { not: id } } });
      if (existing) throw new ConflictException('Activity type with this slug already exists');
    }
    return this.prisma.activityType.update({
      where: { id },
      data,
    });
  }

  async remove(id: string) {
    await this.prisma.activityType.delete({ where: { id } });
    return { message: 'Activity type deleted' };
  }
}
