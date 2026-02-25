import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from './email.service';

@Injectable()
export class EmailAutomationService {
  constructor(
    private prisma: PrismaService,
    private emailService: EmailService,
  ) {}

  async findAll() {
    return this.prisma.emailAutomation.findMany({
      include: { template: true },
      orderBy: { name: 'asc' },
    });
  }

  async findOne(id: string) {
    const a = await this.prisma.emailAutomation.findUnique({
      where: { id },
      include: { template: true },
    });
    if (!a) throw new NotFoundException('Automation not found');
    return a;
  }

  async create(data: {
    name: string;
    triggerType: string;
    triggerConfig: Record<string, unknown>;
    templateId: string;
    delayMinutes?: number;
    isActive?: boolean;
  }) {
    return this.prisma.emailAutomation.create({
      data: {
        name: data.name,
        triggerType: data.triggerType,
        triggerConfig: data.triggerConfig as object,
        templateId: data.templateId,
        delayMinutes: data.delayMinutes ?? 0,
        isActive: data.isActive ?? true,
      },
      include: { template: true },
    });
  }

  async update(
    id: string,
    data: {
      name?: string;
      triggerType?: string;
      triggerConfig?: Record<string, unknown>;
      templateId?: string;
      delayMinutes?: number;
      isActive?: boolean;
    },
  ) {
    await this.findOne(id);
    return this.prisma.emailAutomation.update({
      where: { id },
      data: {
        ...data,
        triggerConfig: data.triggerConfig as object | undefined,
      },
      include: { template: true },
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.emailAutomation.delete({ where: { id } });
    return { message: 'Automation deleted' };
  }

  /**
   * Fire stage_entry (for toStageId) and stage_exit (for fromStageId) automations.
   * Sends template emails to the lead's primary contact.
   */
  async runForStageChange(
    lead: {
      id: string;
      title: string;
      organization?: { name: string } | null;
      primaryContact?: { firstName?: string; lastName?: string; email: string } | null;
      assignedTo?: { name: string | null } | null;
      nextStep?: string | null;
      amount?: unknown;
      currency?: string | null;
      source?: string | null;
      customFields?: Record<string, unknown> | null;
    },
    fromStageId: string,
    toStageId: string,
  ): Promise<void> {
    const toEmail = lead.primaryContact?.email;
    if (!toEmail) return;

    const allEntry = await this.prisma.emailAutomation.findMany({
      where: { isActive: true, triggerType: 'stage_entry' },
      include: { template: true },
    });
    const allExitRaw = fromStageId
      ? await this.prisma.emailAutomation.findMany({
          where: { isActive: true, triggerType: 'stage_exit' },
          include: { template: true },
        })
      : [];

    const configMatchesStageId = (config: unknown, stageId: string): boolean => {
      const cfg = config as Record<string, unknown> | null;
      return cfg != null && typeof cfg === 'object' && String(cfg.stageId) === stageId;
    };

    const entryAutomations = allEntry.filter((a) => configMatchesStageId(a.triggerConfig, toStageId));
    const exitAutomations = allExitRaw.filter((a) => configMatchesStageId(a.triggerConfig, fromStageId));

    const vars = this.emailService.buildLeadVars({
      title: lead.title,
      organization: lead.organization,
      assignedTo: lead.assignedTo,
      nextStep: lead.nextStep,
      amount: lead.amount,
      currency: lead.currency,
      source: lead.source,
      primaryContact: lead.primaryContact,
      customFields: lead.customFields ?? undefined,
    });

    for (const automation of [...entryAutomations, ...exitAutomations]) {
      const template = automation.template;
      if (!template) continue;
      try {
        const { subject, html, text } = this.emailService.renderTemplate(
          {
            subject: template.subject,
            bodyHtml: template.bodyHtml ?? undefined,
            bodyText: template.bodyText ?? undefined,
          },
          vars,
        );
        await this.emailService.send({
          to: toEmail,
          subject,
          html,
          text,
          fromName: template.fromName ?? undefined,
          fromEmail: template.fromEmail ?? undefined,
        });
      } catch (err) {
        console.error(`Stage automation ${automation.name} failed for lead ${lead.id}:`, err);
      }
    }
  }
}
