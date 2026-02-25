import { Controller, Post, Body } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Public } from '../common/decorators/public.decorator';

/** Resend webhook: { type: "email.bounced", data: { to: string[] } } or type "email.complained" */
interface ResendWebhookPayload {
  type?: string;
  data?: { to?: string[]; email_id?: string };
}

/** SendGrid Event Webhook: array of { event: "bounce"|"dropped", email: string } */
type SendGridWebhookPayload = Array<{ event?: string; email?: string }>;

@Controller('webhooks/email')
@Public()
export class EmailWebhooksController {
  constructor(private prisma: PrismaService) {}

  @Post('resend')
  async resend(@Body() body: ResendWebhookPayload) {
    const type = body?.type;
    const to = body?.data?.to;
    if (!Array.isArray(to) || to.length === 0) {
      return { received: true };
    }
    if (type === 'email.bounced' || type === 'email.complained') {
      for (const email of to) {
        if (typeof email === 'string' && email) {
          await this.markBounced(email);
        }
      }
    }
    return { received: true };
  }

  @Post('sendgrid')
  async sendgrid(@Body() body: SendGridWebhookPayload) {
    if (!Array.isArray(body)) return { received: true };
    for (const ev of body) {
      const event = ev?.event;
      const email = ev?.email;
      if (event === 'bounce' || event === 'dropped' || event === 'spamreport') {
        if (typeof email === 'string' && email) {
          await this.markBounced(email);
        }
      }
    }
    return { received: true };
  }

  private async markBounced(email: string) {
    const normalized = email.trim().toLowerCase();
    await this.prisma.contact.updateMany({
      where: { email: normalized },
      data: { bouncedAt: new Date() },
    });
  }
}
