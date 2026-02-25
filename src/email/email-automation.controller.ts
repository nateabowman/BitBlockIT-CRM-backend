import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { EmailAutomationService } from './email-automation.service';
import { EmailService } from './email.service';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('email-automation')
@UseGuards(JwtAuthGuard)
export class EmailAutomationController {
  constructor(
    private service: EmailAutomationService,
    private emailService: EmailService,
    private prisma: PrismaService,
  ) {}

  @Get()
  async list() {
    const data = await this.service.findAll();
    return { data };
  }

  @Get(':id')
  async one(@Param('id') id: string) {
    return { data: await this.service.findOne(id) };
  }

  @Post()
  async create(
    @Body()
    body: {
      name: string;
      triggerType: string;
      triggerConfig: Record<string, unknown>;
      templateId: string;
      delayMinutes?: number;
      isActive?: boolean;
    },
  ) {
    return { data: await this.service.create(body) };
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body()
    body: {
      name?: string;
      triggerType?: string;
      triggerConfig?: Record<string, unknown>;
      templateId?: string;
      delayMinutes?: number;
      isActive?: boolean;
    },
  ) {
    return { data: await this.service.update(id, body) };
  }

  @Post(':id/test')
  async test(@Param('id') id: string, @CurrentUser('sub') userId: string, @Body() body: { email?: string }) {
    const automation = await this.service.findOne(id);
    const template = automation.template;
    const to = body.email || (await this.prisma.user.findUnique({ where: { id: userId } }))?.email;
    if (!to) throw new Error('No email to send to');
    const { subject, html, text } = this.emailService.renderTemplate(
      {
        subject: template.subject,
        bodyHtml: template.bodyHtml ?? undefined,
        bodyText: template.bodyText ?? undefined,
      },
      {
      leadName: 'Test Lead',
      companyName: 'Test Co',
    },
    );
    await this.emailService.send({ to, subject, html, text });
    return { message: 'Test email sent' };
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    return await this.service.remove(id);
  }
}
