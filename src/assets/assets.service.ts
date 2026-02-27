import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AssetsService {
  constructor(private prisma: PrismaService) {}

  async findAll(type?: string) {
    const where = type ? { type } : {};
    return this.prisma.asset.findMany({
      where,
      orderBy: { name: 'asc' },
      include: { _count: { select: { downloads: true } } },
    });
  }

  async findOne(id: string) {
    const asset = await this.prisma.asset.findUnique({
      where: { id },
      include: { _count: { select: { downloads: true } } },
    });
    if (!asset) throw new NotFoundException('Asset not found');
    return asset;
  }

  async create(data: { name: string; type: string; storageKey: string; url?: string; isGated?: boolean }) {
    return this.prisma.asset.create({
      data: {
        name: data.name,
        type: data.type,
        storageKey: data.storageKey,
        url: data.url ?? null,
        isGated: data.isGated ?? false,
      },
    });
  }

  async update(id: string, data: { name?: string; type?: string; storageKey?: string; url?: string; isGated?: boolean }) {
    await this.findOne(id);
    return this.prisma.asset.update({
      where: { id },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.type !== undefined && { type: data.type }),
        ...(data.storageKey !== undefined && { storageKey: data.storageKey }),
        ...(data.url !== undefined && { url: data.url }),
        ...(data.isGated !== undefined && { isGated: data.isGated }),
      },
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.asset.delete({ where: { id } });
    return { message: 'Asset deleted' };
  }

  /** Record download and return redirect URL; for gated assets require contactId or email */
  async requestDownload(
    assetId: string,
    options: { contactId?: string; leadId?: string; email?: string },
  ): Promise<{ url: string }> {
    const asset = await this.prisma.asset.findUnique({ where: { id: assetId } });
    if (!asset) throw new NotFoundException('Asset not found');
    if (asset.isGated && !options.contactId && !options.email?.trim()) {
      throw new BadRequestException('Gated assets require contactId or email');
    }
    await this.prisma.assetDownloadLog.create({
      data: {
        assetId,
        contactId: options.contactId ?? undefined,
        leadId: options.leadId ?? undefined,
        email: options.email?.trim() || undefined,
      },
    });
    const url = asset.url || `/files/${asset.storageKey}`;
    return { url };
  }

  async getDownloadStats(assetId: string, dateFrom?: string, dateTo?: string) {
    await this.findOne(assetId);
    const where: { assetId: string; downloadedAt?: { gte?: Date; lte?: Date } } = { assetId };
    if (dateFrom || dateTo) {
      where.downloadedAt = {};
      if (dateFrom) where.downloadedAt.gte = new Date(dateFrom);
      if (dateTo) where.downloadedAt.lte = new Date(dateTo);
    }
    const [total, byDay] = await Promise.all([
      this.prisma.assetDownloadLog.count({ where }),
      this.prisma.assetDownloadLog.groupBy({
        by: ['downloadedAt'],
        where,
        _count: true,
      }),
    ]);
    const byDayMap = byDay.reduce((acc, r) => {
      const day = r.downloadedAt.toISOString().slice(0, 10);
      acc[day] = (acc[day] || 0) + r._count;
      return acc;
    }, {} as Record<string, number>);
    return {
      total,
      byDay: Object.entries(byDayMap).map(([day, count]) => ({ day, count })).sort((a, b) => a.day.localeCompare(b.day)),
    };
  }

  async getAnalytics(id: string) {
    const asset = await this.prisma.asset.findUnique({
      where: { id },
      select: { id: true, name: true, downloads: { orderBy: { downloadedAt: 'desc' }, take: 100, include: { contact: { select: { id: true, firstName: true, lastName: true, email: true } } } } },
    });
    if (!asset) throw new Error('Asset not found');
    const total = asset.downloads.length;
    const uniqueContacts = new Set(asset.downloads.map((d) => d.contactId).filter(Boolean)).size;
    const byDay = asset.downloads.reduce((acc, d) => {
      if (!d.downloadedAt) return acc;
      const day = d.downloadedAt.toISOString().slice(0, 10);
      acc[day] = (acc[day] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    return {
      assetName: asset.name,
      totalDownloads: total,
      uniqueContacts,
      byDay: Object.entries(byDay).map(([day, count]) => ({ day, count })).sort((a, b) => a.day.localeCompare(b.day)).slice(-30),
      recentDownloads: asset.downloads.slice(0, 20).map((d) => ({
        email: d.email ?? d.contact?.email,
        contactName: d.contact ? `${d.contact.firstName} ${d.contact.lastName}` : null,
        downloadedAt: d.downloadedAt,
      })),
    };
  }
}
