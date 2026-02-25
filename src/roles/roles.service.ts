import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class RolesService {
  constructor(private prisma: PrismaService) {}

  findAll() {
    return this.prisma.role.findMany({
      select: {
        id: true,
        name: true,
        description: true,
        _count: { select: { users: true } },
      },
      orderBy: { name: 'asc' },
    });
  }

  findOne(id: string) {
    return this.prisma.role.findUnique({
      where: { id },
      include: {
        permissions: { include: { permission: true } },
        _count: { select: { users: true } },
      },
    });
  }

  findAllPermissions() {
    return this.prisma.permission.findMany({
      orderBy: [{ resource: 'asc' }, { action: 'asc' }],
    });
  }

  async create(data: { name: string; description?: string }) {
    const name = data.name.trim();
    if (!name) throw new BadRequestException('Name is required');
    const existing = await this.prisma.role.findUnique({ where: { name } });
    if (existing) throw new BadRequestException('Role name already exists');
    return this.prisma.role.create({
      data: { name, description: data.description ?? null },
    });
  }

  async update(id: string, data: { name?: string; description?: string }) {
    const role = await this.prisma.role.findUnique({ where: { id } });
    if (!role) throw new NotFoundException('Role not found');
    if (data.name !== undefined) {
      const name = data.name.trim();
      if (!name) throw new BadRequestException('Name is required');
      const existing = await this.prisma.role.findFirst({ where: { name, id: { not: id } } });
      if (existing) throw new BadRequestException('Role name already exists');
    }
    return this.prisma.role.update({
      where: { id },
      data: {
        ...(data.name !== undefined && { name: data.name.trim() }),
        ...(data.description !== undefined && { description: data.description ?? null }),
      },
    });
  }

  async setPermissions(roleId: string, permissionIds: string[]) {
    const role = await this.prisma.role.findUnique({ where: { id: roleId } });
    if (!role) throw new NotFoundException('Role not found');
    const permissions = await this.prisma.permission.findMany({ where: { id: { in: permissionIds } } });
    if (permissions.length !== permissionIds.length) throw new BadRequestException('Invalid permission id(s)');
    await this.prisma.rolePermission.deleteMany({ where: { roleId } });
    if (permissionIds.length > 0) {
      await this.prisma.rolePermission.createMany({
        data: permissionIds.map((permissionId) => ({ roleId, permissionId })),
      });
    }
    return this.findOne(roleId);
  }

  async remove(id: string) {
    const role = await this.prisma.role.findUnique({ where: { id }, include: { _count: { select: { users: true } } } });
    if (!role) throw new NotFoundException('Role not found');
    if (role._count.users > 0) throw new BadRequestException('Cannot delete role that has users assigned');
    await this.prisma.role.delete({ where: { id } });
  }
}
