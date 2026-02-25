import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SuppressionService {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    return this.prisma.suppressionEntry.findMany({
      orderBy: [{ type: 'asc' }, { value: 'asc' }],
    });
  }

  async create(type: 'email' | 'domain', value: string) {
    const trimmed = value.trim().toLowerCase();
    if (!trimmed) throw new BadRequestException('Value is required');
    if (type === 'email' && !trimmed.includes('@')) {
      throw new BadRequestException('Email must contain @');
    }
    if (type === 'domain' && trimmed.includes('@')) {
      throw new BadRequestException('Domain must not contain @');
    }
    return this.prisma.suppressionEntry.upsert({
      where: { type_value: { type, value: trimmed } },
      create: { type, value: trimmed },
      update: {},
    });
  }

  async remove(id: string) {
    const entry = await this.prisma.suppressionEntry.findUnique({ where: { id } });
    if (!entry) throw new NotFoundException('Suppression entry not found');
    await this.prisma.suppressionEntry.delete({ where: { id } });
    return { message: 'Suppression entry removed' };
  }
}
