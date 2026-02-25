import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as crypto from 'crypto';
import { JwtPayload } from '../common/decorators/current-user.decorator';

const PREFIX = 'bb_live_';
const KEY_BYTES = 32;
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

type CacheEntry = { user: JwtPayload; scopes: string[]; expiresAt: number };

@Injectable()
export class ApiKeysService {
  private readonly keyCache = new Map<string, CacheEntry>();

  constructor(private prisma: PrismaService) {}

  hashKey(plainKey: string): string {
    return crypto.createHash('sha256').update(plainKey).digest('hex');
  }

  async validateKey(plainKey: string): Promise<{ user: JwtPayload; scopes: string[] } | null> {
    if (!plainKey.startsWith(PREFIX) || plainKey.length < PREFIX.length + 10) return null;
    const keyHash = this.hashKey(plainKey);
    const cached = this.keyCache.get(keyHash);
    if (cached) {
      if (Date.now() < cached.expiresAt) {
        return { user: cached.user, scopes: cached.scopes };
      }
      this.keyCache.delete(keyHash);
    }
    const apiKey = await this.prisma.apiKey.findUnique({
      where: { keyHash },
      include: { user: { include: { role: true } } },
    });
    if (!apiKey) return null;
    const u = apiKey.user;
    const result = {
      user: {
        sub: u.id,
        email: u.email,
        role: u.role?.name,
        teamId: u.teamId,
      } as JwtPayload,
      scopes: apiKey.scopes,
    };
    this.keyCache.set(keyHash, {
      ...result,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });
    this.prisma.apiKey
      .update({
        where: { id: apiKey.id },
        data: { lastUsedAt: new Date() },
      })
      .catch(() => {});
    return result;
  }

  async create(userId: string, name: string, scopes: string[]) {
    const raw = crypto.randomBytes(KEY_BYTES).toString('base64url');
    const plainKey = PREFIX + raw;
    const keyHash = this.hashKey(plainKey);
    await this.prisma.apiKey.create({
      data: { keyHash, name, scopes, userId },
    });
    return { plainKey, name, scopes };
  }

  async findAll(userId: string) {
    return this.prisma.apiKey.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, name: true, scopes: true, lastUsedAt: true, createdAt: true },
    });
  }

  async revoke(id: string, userId: string) {
    const key = await this.prisma.apiKey.findFirst({ where: { id, userId }, select: { keyHash: true } });
    if (!key) throw new NotFoundException('API key not found');
    await this.prisma.apiKey.delete({ where: { id } });
    this.keyCache.delete(key.keyHash);
    return { message: 'Revoked' };
  }

  async revokeAllForUser(userId: string) {
    const keys = await this.prisma.apiKey.findMany({ where: { userId }, select: { keyHash: true } });
    await this.prisma.apiKey.deleteMany({ where: { userId } });
    for (const k of keys) this.keyCache.delete(k.keyHash);
    return { message: 'All API keys revoked' };
  }
}
