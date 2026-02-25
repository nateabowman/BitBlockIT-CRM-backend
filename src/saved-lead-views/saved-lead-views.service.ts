import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SavedLeadViewsService {
  constructor(private prisma: PrismaService) {}

  async findByUser(userId: string) {
    return this.prisma.savedLeadView.findMany({
      where: { userId },
      orderBy: { name: 'asc' },
    });
  }

  async create(
    userId: string,
    data: { name: string; filters: Record<string, unknown>; sort?: Record<string, string>; columns?: string[] },
  ) {
    return this.prisma.savedLeadView.create({
      data: {
        userId,
        name: data.name,
        filters: data.filters as object,
        sort: data.sort as object | undefined,
        columns: data.columns as object | undefined,
      },
    });
  }

  async update(
    id: string,
    userId: string,
    data: { name?: string; filters?: Record<string, unknown>; sort?: Record<string, string>; columns?: string[] },
  ) {
    const view = await this.prisma.savedLeadView.findFirst({ where: { id, userId } });
    if (!view) throw new NotFoundException('View not found');
    return this.prisma.savedLeadView.update({
      where: { id },
      data: {
        ...data,
        filters: data.filters as object | undefined,
        sort: data.sort as object | undefined,
        columns: data.columns as object | undefined,
      },
    });
  }

  async remove(id: string, userId: string) {
    const view = await this.prisma.savedLeadView.findFirst({ where: { id, userId } });
    if (!view) throw new NotFoundException('View not found');
    await this.prisma.savedLeadView.delete({ where: { id } });
    return { message: 'View deleted' };
  }
}
