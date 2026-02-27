import { Controller, Post, Get, Delete, UseGuards, Body, Param, Request } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LocalAuthGuard } from './guards/local-auth.guard';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { LoginDto } from './dto/login.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { AcceptInviteDto } from './dto/accept-invite.dto';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Public()
  @UseGuards(LocalAuthGuard)
  @Post('login')
  async login(@Body() _body: LoginDto, @CurrentUser() user: { id: string; email: string }) {
    return this.authService.login(user);
  }

  @Post('logout')
  async logout() {
    return { message: 'Logged out' };
  }

  @Post('refresh')
  async refresh(@CurrentUser() user: { sub: string; email: string }) {
    return this.authService.login({ id: user.sub, email: user.email });
  }

  @Public()
  @Post('forgot-password')
  async forgotPassword(@Body() body: { email: string }) {
    return this.authService.forgotPassword(body.email);
  }

  @Public()
  @Post('reset-password')
  async resetPassword(@Body() body: ResetPasswordDto) {
    return this.authService.resetPassword(body.token, body.newPassword);
  }

  @Public()
  @Post('accept-invite')
  async acceptInvite(@Body() body: AcceptInviteDto) {
    return this.authService.acceptInvite(body.token, body.password);
  }

  @UseGuards(JwtAuthGuard)
  @Post('revoke-all')
  async revokeAllSessions(@CurrentUser() user: JwtPayload) {
    return this.authService.revokeAllSessions(user.sub);
  }

  @UseGuards(JwtAuthGuard)
  @Get('sessions')
  async getSessions(@CurrentUser() user: JwtPayload) {
    return this.authService.getSessions(user.sub);
  }

  @UseGuards(JwtAuthGuard)
  @Post('2fa/setup')
  async setup2fa(@CurrentUser() user: JwtPayload) {
    return this.authService.setup2fa(user.sub);
  }

  @UseGuards(JwtAuthGuard)
  @Post('2fa/verify')
  async verify2fa(@CurrentUser() user: JwtPayload, @Body() body: { token: string }) {
    return this.authService.verify2fa(user.sub, body.token);
  }

  @UseGuards(JwtAuthGuard)
  @Post('2fa/disable')
  async disable2fa(@CurrentUser() user: JwtPayload, @Body() body: { password: string }) {
    return this.authService.disable2fa(user.sub, body.password);
  }
}
