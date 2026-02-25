import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/users.service';
import * as bcrypt from 'bcrypt';
import { JwtPayload } from '../common/decorators/current-user.decorator';

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
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
}
