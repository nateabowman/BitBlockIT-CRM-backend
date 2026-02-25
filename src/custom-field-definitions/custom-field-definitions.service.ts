import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CustomFieldDefinitionsService {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    return this.prisma.customFieldDefinition.findMany({
      orderBy: [{ entity: 'asc' }, { order: 'asc' }],
    });
  }

  async findByEntity(entity: string) {
    return this.prisma.customFieldDefinition.findMany({
      where: { entity },
      orderBy: { order: 'asc' },
    });
  }

  async create(data: {
    entity: string;
    fieldKey: string;
    label: string;
    type: string;
    options?: unknown;
    required?: boolean;
    order?: number;
  }) {
    return this.prisma.customFieldDefinition.create({
      data: {
        entity: data.entity,
        fieldKey: data.fieldKey,
        label: data.label,
        type: data.type,
        options: (data.options as object) ?? undefined,
        required: data.required ?? false,
        order: data.order ?? 0,
      },
    });
  }

  async update(
    id: string,
    data: { label?: string; type?: string; options?: unknown; required?: boolean; order?: number },
  ) {
    return this.prisma.customFieldDefinition.update({
      where: { id },
      data: { ...data, options: data.options as object | undefined },
    });
  }

  async remove(id: string) {
    await this.prisma.customFieldDefinition.delete({ where: { id } });
    return { message: 'Custom field deleted' };
  }
}
