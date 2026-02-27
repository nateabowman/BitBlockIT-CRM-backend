import { BadRequestException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async findByEmail(email: string) {
    return this.prisma.user.findUnique({
      where: { email: email.toLowerCase(), isActive: true },
      include: { role: true },
    });
  }

  async findById(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id, isActive: true },
      include: { role: true, team: true },
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async findByIdForAuth(id: string) {
    return this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        name: true,
        isActive: true,
        tokenVersion: true,
        teamId: true,
        role: { select: { name: true } },
      },
    });
  }

  async findByIdWithPassword(id: string) {
    return this.prisma.user.findUnique({
      where: { id },
    });
  }

  async findAssignable() {
    return this.prisma.user.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
  }

  async findAll(params?: { skip?: number; take?: number; includeInactive?: boolean }) {
    const where = params?.includeInactive ? {} : { isActive: true };
    const [data, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip: params?.skip,
        take: params?.take ?? 20,
        select: {
          id: true,
          email: true,
          name: true,
          avatarUrl: true,
          roleId: true,
          teamId: true,
          timezone: true,
          isActive: true,
          tokenVersion: true,
          createdAt: true,
          updatedAt: true,
          role: true,
          team: true,
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.user.count({ where }),
    ]);
    return { data, total };
  }

  async getMe(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        name: true,
        avatarUrl: true,
        phone: true,
        callMode: true,
        timezone: true,
        signature: true,
        notificationPrefs: true,
        roleId: true,
        teamId: true,
        tokenVersion: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
        role: true,
        team: true,
      },
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  /** Normalize phone to E.164-like form for storage (10+ digits). Returns null if empty or invalid. */
  private normalizePhone(phone: string | null | undefined): string | null {
    if (phone == null || typeof phone !== 'string') return null;
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 10) return null;
    if (digits.length === 10) return `+1${digits}`;
    if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
    return `+${digits}`;
  }

  async updateMe(id: string, data: { name?: string; phone?: string; callMode?: string; timezone?: string; avatarUrl?: string; signature?: string; notificationPrefs?: Record<string, unknown> }) {
    const updateData: {
      name?: string;
      phone?: string | null;
      callMode?: string | null;
      timezone?: string;
      avatarUrl?: string;
      signature?: string;
      notificationPrefs?: object;
    } = {
      name: data.name,
      timezone: data.timezone,
      avatarUrl: data.avatarUrl,
      signature: data.signature,
      notificationPrefs: data.notificationPrefs as object | undefined,
    };
    if (data.callMode !== undefined) {
      if (data.callMode !== 'phone' && data.callMode !== 'browser') {
        throw new BadRequestException('callMode must be "phone" or "browser"');
      }
      updateData.callMode = data.callMode;
    }
    if (data.phone !== undefined) {
      const trimmed = data.phone.trim();
      if (!trimmed) {
        updateData.phone = null;
      } else {
        const normalized = this.normalizePhone(trimmed);
        if (!normalized) {
          throw new BadRequestException('Phone number must contain at least 10 digits');
        }
        updateData.phone = normalized;
      }
    }
    return this.prisma.user.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        email: true,
        name: true,
        avatarUrl: true,
        phone: true,
        timezone: true,
        signature: true,
        notificationPrefs: true,
        roleId: true,
        teamId: true,
        role: true,
        team: true,
        tokenVersion: true,
      },
    });
  }

  async revokeAllSessions(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id }, select: { tokenVersion: true } });
    if (!user) throw new NotFoundException('User not found');
    await this.prisma.user.update({
      where: { id },
      data: { tokenVersion: user.tokenVersion + 1 },
    });
    return { message: 'All sessions revoked' };
  }

  async create(data: Prisma.UserUncheckedCreateInput & { password: string }) {
    const { password, ...rest } = data;
    const passwordHash = await bcrypt.hash(password, 10);
    return this.prisma.user.create({
      data: { ...rest, passwordHash, email: rest.email.toLowerCase() },
      select: { id: true, email: true, name: true, roleId: true, createdAt: true },
    });
  }

  async update(id: string, data: Prisma.UserUncheckedUpdateInput) {
    return this.prisma.user.update({
      where: { id },
      data,
      select: { id: true, email: true, name: true, roleId: true, teamId: true, isActive: true, role: true, team: true },
    });
  }

  async createInvite(data: { email: string; name?: string; roleId: string; teamId?: string }) {
    const email = data.email.toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) throw new NotFoundException('User with this email already exists');
    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date();
    expires.setDate(expires.getDate() + 7);
    const tempHash = await bcrypt.hash(token + email, 10);
    const user = await this.prisma.user.create({
      data: {
        email,
        name: data.name,
        passwordHash: tempHash,
        roleId: data.roleId,
        teamId: data.teamId,
        isActive: true,
        inviteToken: token,
        inviteTokenExpires: expires,
      },
      select: { id: true, email: true, inviteToken: true, inviteTokenExpires: true },
    });
    return { user, inviteLink: `${process.env.APP_URL || 'http://localhost:3000'}/login?invite=${user.inviteToken}` };
  }

  async acceptInvite(token: string, newPassword: string) {
    const user = await this.prisma.user.findFirst({
      where: { inviteToken: token, inviteTokenExpires: { gte: new Date() } },
      include: { role: true },
    });
    if (!user) throw new UnauthorizedException('Invalid or expired invite');
    const passwordHash = await bcrypt.hash(newPassword, 10);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash, inviteToken: null, inviteTokenExpires: null },
    });
    return user;
  }

  async setPasswordResetToken(email: string) {
    const user = await this.prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (!user) return null;
    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date();
    expires.setHours(expires.getHours() + 1);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { resetToken: token, resetTokenExpires: expires },
    });
    return { email: user.email, resetToken: token };
  }

  async resetPassword(token: string, newPassword: string) {
    const user = await this.prisma.user.findFirst({
      where: { resetToken: token, resetTokenExpires: { gte: new Date() } },
    });
    if (!user) throw new UnauthorizedException('Invalid or expired reset token');
    const passwordHash = await bcrypt.hash(newPassword, 10);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash, resetToken: null, resetTokenExpires: null },
    });
    return user;
  }
}
