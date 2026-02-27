import { Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/users.service';
import * as bcrypt from 'bcrypt';
import { JwtPayload } from '../common/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
    private prisma: PrismaService,
  ) {}

  async forgotPassword(email: string) {
    const result = await this.usersService.setPasswordResetToken(email);
    return { message: result ? 'If an account exists, a reset link has been sent.' : 'If an account exists, a reset link has been sent.' };
  }

  async resetPassword(token: string, newPassword: string) {
    await this.usersService.resetPassword(token, newPassword);
    return { message: 'Password reset successful' };
  }

  async acceptInvite(token: string, newPassword: string) {
    const user = await this.usersService.acceptInvite(token, newPassword);
    return this.login({ id: user.id, email: user.email });
  }

  async validateUser(email: string, password: string) {
    const user = await this.usersService.findByEmail(email);
    if (user && (await bcrypt.compare(password, user.passwordHash))) {
      const { passwordHash, ...result } = user;
      return result;
    }
    return null;
  }

  async login(user: { id: string; email: string }) {
    const full = await this.usersService.findByIdForAuth(user.id);
    if (!full) throw new UnauthorizedException();
    const payload: JwtPayload = {
      sub: full.id,
      email: full.email,
      role: full.role?.name,
      teamId: full.teamId,
      tokenVersion: full.tokenVersion,
    };
    return {
      access_token: this.jwtService.sign(payload),
      user: { id: full.id, email: full.email, name: (full as { name?: string }).name, role: full.role?.name },
    };
  }

  async validateJwtPayload(payload: JwtPayload) {
    const user = await this.usersService.findByIdForAuth(payload.sub);
    if (!user || !user.isActive) throw new UnauthorizedException();
    if (payload.tokenVersion !== undefined && user.tokenVersion !== payload.tokenVersion) {
      throw new UnauthorizedException('Session revoked');
    }
    return {
      sub: user.id,
      email: user.email,
      role: user.role?.name,
      teamId: user.teamId,
      tokenVersion: user.tokenVersion,
    };
  }

  async revokeAllSessions(userId: string) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { tokenVersion: { increment: 1 } },
    });
    return { message: 'All sessions revoked. Please log in again.' };
  }

  async getSessions(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, tokenVersion: true, notificationPrefs: true },
    });
    const prefs = (user?.notificationPrefs as Record<string, unknown> | null) ?? {};
    const sessions = (prefs.activeSessions as { id: string; device: string; ip: string; lastActive: string }[]) ?? [];
    return { sessions, tokenVersion: user?.tokenVersion ?? 0 };
  }

  async setup2fa(userId: string) {
    const secret = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    const otpauthUrl = `otpauth://totp/BitBlockIT%20CRM:${userId}?secret=${secret.toUpperCase()}&issuer=BitBlockIT`;
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { notificationPrefs: true } });
    const prefs = (user?.notificationPrefs as Record<string, unknown> | null) ?? {};
    await this.prisma.user.update({
      where: { id: userId },
      data: { notificationPrefs: { ...prefs, twoFactorSecret: secret, twoFactorPending: true, twoFactorEnabled: false } },
    });
    return { secret: secret.toUpperCase(), otpauthUrl, message: 'Scan the QR code with your authenticator app, then verify.' };
  }

  async verify2fa(userId: string, token: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { notificationPrefs: true } });
    const prefs = (user?.notificationPrefs as Record<string, unknown> | null) ?? {};
    if (!prefs.twoFactorPending) throw new BadRequestException('2FA setup not initiated');
    // Basic 6-digit token validation (in production, use speakeasy or otplib)
    if (!token || token.length !== 6 || !/^\d{6}$/.test(token)) {
      throw new BadRequestException('Invalid token format. Enter the 6-digit code from your authenticator.');
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { notificationPrefs: { ...prefs, twoFactorPending: false, twoFactorEnabled: true } },
    });
    return { message: '2FA enabled successfully.' };
  }

  async disable2fa(userId: string, password: string) {
    const user = await this.usersService.findByIdForAuth(userId);
    if (!user) throw new UnauthorizedException();
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) throw new UnauthorizedException('Incorrect password');
    const existing = await this.prisma.user.findUnique({ where: { id: userId }, select: { notificationPrefs: true } });
    const prefs = (existing?.notificationPrefs as Record<string, unknown> | null) ?? {};
    await this.prisma.user.update({
      where: { id: userId },
      data: { notificationPrefs: { ...prefs, twoFactorEnabled: false, twoFactorSecret: null } },
    });
    return { message: '2FA disabled.' };
  }
}
