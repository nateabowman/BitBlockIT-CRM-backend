import { Controller, Get, Post, Body, Param, Res, Req } from '@nestjs/common';
import { Response, Request } from 'express';
import { PreferenceCenterService } from './preference-center.service';
import { Public } from '../common/decorators/public.decorator';
import { Throttle } from '@nestjs/throttler';

@Controller('preference')
@Public()
export class PreferenceCenterController {
  constructor(private service: PreferenceCenterService) {}

  /** Lookup contact by email (for preference center form) */
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @Post('lookup')
  async lookup(@Body() body: { email: string }) {
    const email = body?.email?.trim();
    if (!email) return { error: 'Email is required' };
    return this.service.findByEmail(email);
  }

  /** Update preferences (frequency, topics) */
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @Post('update')
  async update(
    @Body()
    body: { email: string; frequency?: string; topicPreferences?: Record<string, unknown> },
  ) {
    const email = body?.email?.trim();
    if (!email) return { error: 'Email is required' };
    return this.service.updatePreferences(email, {
      frequency: body.frequency,
      topicPreferences: body.topicPreferences,
    });
  }

  /** Unsubscribe by email */
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @Post('unsubscribe')
  async unsubscribeByEmail(@Body() body: { email: string }) {
    const email = body?.email?.trim();
    if (!email) return { error: 'Email is required' };
    return this.service.unsubscribeByEmail(email);
  }

  /** One-click unsubscribe by token - redirect to thank-you or return JSON */
  @Get('unsubscribe/:token')
  async unsubscribeByToken(
    @Param('token') token: string,
    @Res() res: Response,
    @Req() req: Request,
  ) {
    const accept = req.headers?.accept ?? '';
    const wantsJson = accept.includes('application/json');
    try {
      await this.service.unsubscribeByToken(token);
      if (wantsJson) {
        return res.status(200).json({ success: true, unsubscribed: true });
      }
      return res.redirect(302, `${this.service.getFrontendBaseUrl()}/unsubscribed?done=1`);
    } catch {
      if (wantsJson) {
        return res.status(404).json({ error: 'Invalid or expired link' });
      }
      return res.redirect(302, `${this.service.getFrontendBaseUrl()}/unsubscribed?error=1`);
    }
  }
}
