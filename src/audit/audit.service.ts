import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AuditService {
  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {}

  /** Delete audit logs older than retention days. Returns number of deleted rows. */
  async deleteOlderThan(retentionDays: number): Promise<number> {
    if (retentionDays < 1) return 0;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - retentionDays);
    const result = await this.prisma.auditLog.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });
    return result.count;
  }

  /** Run retention: delete logs older than AUDIT_LOG_RETENTION_DAYS if set. */
  async runRetention(): Promise<number> {
    const days = this.config.get<number>('AUDIT_LOG_RETENTION_DAYS');
    if (days == null || Number.isNaN(Number(days)) || Number(days) < 1) return 0;
    return this.deleteOlderThan(Number(days));
  }

  @Cron('0 2 * * *')
  async scheduledRetention(): Promise<void> {
    const deleted = await this.runRetention();
    if (deleted > 0) {
      const Logger = (await import('@nestjs/common')).Logger;
      Logger.log(`Audit retention: deleted ${deleted} log(s)`, 'AuditService');
    }
  }

  async log(params: {
    userId?: string;
    resourceType: string;
    resourceId: string;
    action: string;
    oldValue?: unknown;
    newValue?: unknown;
    ip?: string;
  }) {
    return this.prisma.auditLog.create({
      data: {
        userId: params.userId,
        resourceType: params.resourceType,
        resourceId: params.resourceId,
        action: params.action,
        oldValue: params.oldValue as object | undefined,
        newValue: params.newValue as object | undefined,
        ip: params.ip,
      },
    });
  }

  async findByResource(resourceType: string, resourceId: string, limit = 50) {
    return this.prisma.auditLog.findMany({
      where: { resourceType, resourceId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { user: { select: { id: true, name: true, email: true } } },
    });
  }

  async findWithFilters(query: {
    userId?: string;
    resourceType?: string;
    resourceId?: string;
    dateFrom?: string;
    dateTo?: string;
    page?: number;
    limit?: number;
  }) {
    const where: { userId?: string; resourceType?: string; resourceId?: string; createdAt?: { gte?: Date; lte?: Date } } = {};
    if (query.userId) where.userId = query.userId;
    if (query.resourceType) where.resourceType = query.resourceType;
    if (query.resourceId) where.resourceId = query.resourceId;
    if (query.dateFrom || query.dateTo) {
      where.createdAt = {};
      if (query.dateFrom) where.createdAt.gte = new Date(query.dateFrom);
      if (query.dateTo) where.createdAt.lte = new Date(query.dateTo);
    }
    const page = query.page ?? 1;
    const limit = query.limit ?? 50;
    const [data, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: { user: { select: { id: true, name: true, email: true } } },
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return { data, total, page, limit };
  }
}
