import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from './email.service';

@Injectable()
export class EmailTemplatesService {
  constructor(
    private prisma: PrismaService,
    private emailService: EmailService,
  ) {}

  async findAll(category?: string) {
    const where = category ? { category } : {};
    return this.prisma.emailTemplate.findMany({ where, orderBy: { name: 'asc' } });
  }

  async findOne(id: string) {
    const t = await this.prisma.emailTemplate.findUnique({ where: { id } });
    if (!t) throw new NotFoundException('Template not found');
    return t;
  }

  async create(data: { name: string; subject: string; bodyHtml?: string; bodyText?: string; bodyJson?: object; category?: string; fromName?: string; fromEmail?: string }) {
    return this.prisma.emailTemplate.create({
      data: {
        name: data.name,
        subject: data.subject,
        bodyHtml: data.bodyHtml ?? null,
        bodyText: data.bodyText ?? null,
        bodyJson: data.bodyJson as object | undefined,
        category: data.category ?? null,
        fromName: data.fromName ?? null,
        fromEmail: data.fromEmail ?? null,
      },
    });
  }

  async update(id: string, data: { name?: string; subject?: string; bodyHtml?: string; bodyText?: string; bodyJson?: object; category?: string; fromName?: string | null; fromEmail?: string | null }) {
    await this.findOne(id);
    return this.prisma.emailTemplate.update({
      where: { id },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.subject !== undefined && { subject: data.subject }),
        ...(data.bodyHtml !== undefined && { bodyHtml: data.bodyHtml }),
        ...(data.bodyText !== undefined && { bodyText: data.bodyText }),
        ...(data.bodyJson !== undefined && { bodyJson: data.bodyJson as object }),
        ...(data.category !== undefined && { category: data.category }),
        ...(data.fromName !== undefined && { fromName: data.fromName }),
        ...(data.fromEmail !== undefined && { fromEmail: data.fromEmail }),
      },
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.emailTemplate.delete({ where: { id } });
    return { message: 'Template deleted' };
  }

  async sendTest(id: string, to: string) {
    const template = await this.findOne(id);
    const vars = this.emailService.buildLeadVars({
      title: 'Test Lead',
      primaryContact: { firstName: 'Test', lastName: 'User', email: to },
      organization: { name: 'Test Company' },
    });
    const rendered = this.emailService.renderTemplate(
      { subject: template.subject, bodyHtml: template.bodyHtml ?? undefined, bodyText: template.bodyText ?? undefined },
      vars,
    );
    await this.emailService.send({
      to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      ...(template.fromName && { fromName: template.fromName }),
      ...(template.fromEmail && { fromEmail: template.fromEmail }),
    });
    return { message: 'Test email sent' };
  }
}
