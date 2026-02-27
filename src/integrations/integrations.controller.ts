import { Controller, Get, Post, Patch, Body, UseGuards, Param } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { SuperAdminGuard } from '../common/guards/super-admin.guard';
import { IntegrationsService } from './integrations.service';

@Controller('integrations')
@UseGuards(JwtAuthGuard)
export class IntegrationsController {
  constructor(private service: IntegrationsService) {}

  @Get()
  async getAll() {
    return { data: await this.service.getAll() };
  }

  @Patch(':section')
  @UseGuards(SuperAdminGuard)
  async update(@Param('section') section: string, @Body() body: Record<string, unknown>) {
    const allowed = ['slack', 'calendly', 'docusign', 'stripe', 'zapier'];
    if (!allowed.includes(section)) throw new Error('Invalid integration section');
    return { data: await this.service.update(section as 'slack', body) };
  }

  @Post('slack/test')
  @UseGuards(SuperAdminGuard)
  async testSlack(@Body() body: { webhookUrl: string }) {
    if (!body.webhookUrl) throw new Error('webhookUrl is required');
    return { data: await this.service.testSlack(body.webhookUrl) };
  }

  @Post('slack/notify')
  async sendNotification(@Body() body: { type: string; title: string; description?: string; url?: string; emoji?: string }) {
    await this.service.sendSlackNotification(body);
    return { message: 'Notification queued' };
  }
}
