import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { UpdateTicketDto } from './dto/update-ticket.dto';

@Injectable()
export class TicketsService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateTicketDto) {
    if (!dto.leadId && !dto.organizationId) {
      throw new BadRequestException('Either leadId or organizationId is required');
    }
    return this.prisma.serviceTicket.create({
      data: {
        subject: dto.subject,
        leadId: dto.leadId ?? undefined,
        organizationId: dto.organizationId ?? undefined,
        status: (dto.status as 'open' | 'in_progress' | 'resolved' | 'closed') ?? 'open',
        dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
      },
      include: { lead: { select: { id: true, title: true } }, organization: { select: { id: true, name: true } } },
    });
  }

  async findAll(filters?: { leadId?: string; organizationId?: string; status?: string }) {
    const where: { leadId?: string; organizationId?: string; status?: string } = {};
    if (filters?.leadId) where.leadId = filters.leadId;
    if (filters?.organizationId) where.organizationId = filters.organizationId;
    if (filters?.status) where.status = filters.status;
    return this.prisma.serviceTicket.findMany({
      where,
      orderBy: [{ status: 'asc' }, { dueDate: 'asc' }, { createdAt: 'desc' }],
      include: { lead: { select: { id: true, title: true } }, organization: { select: { id: true, name: true } } },
    });
  }

  async findOne(id: string) {
    const ticket = await this.prisma.serviceTicket.findUnique({
      where: { id },
      include: { lead: true, organization: true },
    });
    if (!ticket) throw new NotFoundException('Ticket not found');
    return ticket;
  }

  async update(id: string, dto: UpdateTicketDto) {
    await this.findOne(id);
    return this.prisma.serviceTicket.update({
      where: { id },
      data: {
        ...(dto.subject !== undefined && { subject: dto.subject }),
        ...(dto.leadId !== undefined && { leadId: dto.leadId || null }),
        ...(dto.organizationId !== undefined && { organizationId: dto.organizationId || null }),
        ...(dto.status !== undefined && { status: dto.status }),
        ...(dto.dueDate !== undefined && { dueDate: dto.dueDate ? new Date(dto.dueDate) : null }),
      },
      include: { lead: { select: { id: true, title: true } }, organization: { select: { id: true, name: true } } },
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.serviceTicket.delete({ where: { id } });
    return { message: 'Deleted' };
  }
}
