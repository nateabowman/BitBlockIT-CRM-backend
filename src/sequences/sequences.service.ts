import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { CreateSequenceDto } from './dto/create-sequence.dto';
import { UpdateSequenceDto } from './dto/update-sequence.dto';

@Injectable()
export class SequencesService {
  constructor(
    private prisma: PrismaService,
    private emailService: EmailService,
  ) {}

  async findAll() {
    return this.prisma.sequence.findMany({
      orderBy: { name: 'asc' },
      include: {
        steps: { orderBy: { order: 'asc' }, include: { template: { select: { id: true, name: true } } } },
        _count: { select: { enrollments: true } },
      },
    });
  }

  async findOne(id: string) {
    const seq = await this.prisma.sequence.findUnique({
      where: { id },
      include: {
        steps: { orderBy: { order: 'asc' }, include: { template: true } },
        enrollments: { take: 50, include: { lead: { select: { id: true, title: true } }, contact: { select: { id: true, email: true } } } },
        _count: { select: { enrollments: true } },
      },
    });
    if (!seq) throw new NotFoundException('Sequence not found');
    return seq;
  }

  /** Performance report: enrolled by state, completed count, avg time to complete (days) */
  async getPerformance(sequenceId: string) {
    await this.findOne(sequenceId);
    const enrollments = await this.prisma.sequenceEnrollment.findMany({
      where: { sequenceId },
      select: { state: true, enrolledAt: true, updatedAt: true },
    });
    const byState = { active: 0, paused: 0, completed: 0 };
    let completedCount = 0;
    let totalDaysToComplete = 0;
    for (const e of enrollments) {
      if (e.state === 'active') byState.active += 1;
      else if (e.state === 'paused') byState.paused += 1;
      else if (e.state === 'completed') {
        byState.completed += 1;
        completedCount += 1;
        const ms = e.updatedAt.getTime() - e.enrolledAt.getTime();
        totalDaysToComplete += ms / (24 * 60 * 60 * 1000);
      }
    }
    const avgDaysToComplete = completedCount > 0 ? Math.round((totalDaysToComplete / completedCount) * 10) / 10 : null;
    return {
      data: {
        total: enrollments.length,
        byState,
        completedCount,
        avgDaysToComplete,
      },
    };
  }

  async create(dto: CreateSequenceDto) {
    const sequence = await this.prisma.sequence.create({
      data: { name: dto.name ?? 'Unnamed sequence' },
    });
    if (dto.steps?.length) {
      for (const s of dto.steps) {
        await this.prisma.sequenceStep.create({
          data: {
            sequenceId: sequence.id,
            order: s.order,
            type: s.type,
            templateId: s.templateId ?? null,
            delayMinutes: s.delayMinutes ?? 0,
            condition: (s.condition as object) ?? undefined,
          },
        });
      }
    }
    return this.findOne(sequence.id);
  }

  async update(id: string, dto: UpdateSequenceDto) {
    await this.findOne(id);
    if (dto.name !== undefined) {
      await this.prisma.sequence.update({ where: { id }, data: { name: dto.name } });
    }
    if (dto.steps !== undefined) {
      await this.prisma.sequenceStep.deleteMany({ where: { sequenceId: id } });
      for (const s of dto.steps) {
        await this.prisma.sequenceStep.create({
          data: {
            sequenceId: id,
            order: s.order,
            type: s.type,
            templateId: s.templateId ?? null,
            delayMinutes: s.delayMinutes ?? 0,
            condition: (s.condition as object) ?? undefined,
          },
        });
      }
    }
    return this.findOne(id);
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.sequence.delete({ where: { id } });
    return { message: 'Sequence deleted' };
  }

  private async getSystemUserId(assignedToId?: string | null): Promise<string> {
    if (assignedToId) return assignedToId;
    const u = await this.prisma.user.findFirst({ where: { isActive: true }, select: { id: true } });
    if (!u) throw new Error('No user found for activity');
    return u.id;
  }

  async enroll(sequenceId: string, leadId: string, contactId: string) {
    const sequence = await this.findOne(sequenceId);
    const contact = await this.prisma.contact.findUnique({
      where: { id: contactId },
      select: { unsubscribedAt: true, email: true },
    });
    if (!contact?.email) throw new BadRequestException('Contact has no email');
    if (contact.unsubscribedAt) throw new BadRequestException('Contact has unsubscribed');
    const existing = await this.prisma.sequenceEnrollment.findUnique({
      where: { sequenceId_leadId: { sequenceId, leadId } },
    });
    if (existing) throw new BadRequestException('Lead already enrolled in this sequence');
    const steps = await this.prisma.sequenceStep.findMany({
      where: { sequenceId },
      orderBy: { order: 'asc' },
    });
    const firstStep = steps[0];
    let nextStepAt: Date | null = null;
    if (firstStep?.type === 'delay') {
      nextStepAt = new Date();
      nextStepAt.setMinutes(nextStepAt.getMinutes() + (firstStep.delayMinutes ?? 0));
    } else if (firstStep?.type === 'wait_until') {
      nextStepAt = this.computeWaitUntil((firstStep as { condition?: unknown }).condition) ?? null;
    }
    return this.prisma.sequenceEnrollment.create({
      data: {
        sequenceId,
        leadId,
        contactId,
        currentStepIndex: 0,
        state: 'active',
        nextStepAt,
      },
      include: { lead: { select: { id: true, title: true } }, contact: { select: { id: true, email: true } } },
    });
  }

  async pause(enrollmentId: string) {
    await this.prisma.sequenceEnrollment.update({
      where: { id: enrollmentId },
      data: { state: 'paused' },
    });
    return { message: 'Enrollment paused' };
  }

  async resume(enrollmentId: string) {
    await this.prisma.sequenceEnrollment.update({
      where: { id: enrollmentId },
      data: { state: 'active' },
    });
    return { message: 'Enrollment resumed' };
  }

  /** Process due enrollments: send email step or advance from delay. Called by cron. */
  async processDueEnrollments() {
    const now = new Date();
    const due = await this.prisma.sequenceEnrollment.findMany({
      where: {
        state: 'active',
        OR: [{ nextStepAt: null }, { nextStepAt: { lte: now } }],
      },
      take: 30,
      include: {
        sequence: { include: { steps: { orderBy: { order: 'asc' }, include: { template: true } } } },
        lead: {
          include: {
            organization: true,
            primaryContact: true,
            assignedTo: { select: { id: true, name: true, email: true } },
            currentStage: { select: { isWon: true, isLost: true } },
            tags: { select: { tagId: true, tag: { select: { id: true, name: true } } } },
          },
        },
        contact: true,
      },
    });
    for (const enr of due) {
      try {
        await this.processEnrollment(enr);
      } catch (e) {
        console.error('Sequence enrollment process failed:', enr.id, e);
      }
    }
  }

  /** Compute next occurrence for wait_until: condition { dayOfWeek?, hour?, minute?, rule?: 'next_week' }. dayOfWeek 0=Sun..6=Sat. */
  private computeWaitUntil(condition: unknown): Date | null {
    const c = condition as { dayOfWeek?: number; hour?: number; minute?: number; rule?: string } | null | undefined;
    if (!c) return null;
    const now = new Date();
    const hour = typeof c.hour === 'number' ? Math.max(0, Math.min(23, c.hour)) : 9;
    const minute = typeof c.minute === 'number' ? Math.max(0, Math.min(59, c.minute)) : 0;
    if (c.rule === 'next_week') {
      const next = new Date(now);
      next.setHours(hour, minute, 0, 0);
      const day = next.getDay();
      const daysUntilMonday = day === 0 ? 1 : day === 1 ? 0 : 8 - day;
      next.setDate(next.getDate() + daysUntilMonday);
      if (next <= now) next.setDate(next.getDate() + 7);
      return next;
    }
    if (typeof c.dayOfWeek === 'number' && c.dayOfWeek >= 0 && c.dayOfWeek <= 6) {
      const next = new Date(now);
      next.setHours(hour, minute, 0, 0);
      const currentDay = next.getDay();
      let days = (c.dayOfWeek - currentDay + 7) % 7;
      if (days === 0 && next <= now) days = 7;
      next.setDate(next.getDate() + days);
      return next;
    }
    return null;
  }

  private async processEnrollment(enr: {
    id: string;
    currentStepIndex: number;
    nextStepAt: Date | null;
    sequence: { steps: { id: string; order: number; type: string; templateId: string | null; template: { subject: string; bodyHtml: string | null; bodyText: string | null } | null; delayMinutes: number; condition?: unknown }[] };
    lead: {
      id: string;
      title: string;
      organization: { name: string } | null;
      primaryContact: { firstName: string; lastName: string; email: string } | null;
      assignedTo: { name: string | null } | null;
      nextStep: string | null;
      amount: unknown;
      currency: string | null;
      source: string | null;
      customFields: unknown;
      currentStage?: { isWon: boolean; isLost: boolean } | null;
      tags?: { tagId: string; tag: { id: string; name: string } }[];
    };
    contact: { id: string; email: string; unsubscribedAt: Date | null };
  }) {
    const steps = enr.sequence.steps;
    const stepIndex = enr.currentStepIndex;

    if (enr.lead.currentStage?.isWon || enr.lead.currentStage?.isLost) {
      await this.prisma.sequenceEnrollment.update({
        where: { id: enr.id },
        data: { state: 'completed', nextStepAt: null },
      });
      return;
    }
    const doNotEmail = (enr.lead.tags ?? []).some((t) => t.tag.name.toLowerCase() === 'do not email');
    if (doNotEmail) {
      await this.prisma.sequenceEnrollment.update({
        where: { id: enr.id },
        data: { state: 'completed', nextStepAt: null },
      });
      return;
    }

    if (stepIndex >= steps.length) {
      await this.prisma.sequenceEnrollment.update({
        where: { id: enr.id },
        data: { state: 'completed', nextStepAt: null },
      });
      return;
    }
    const step = steps[stepIndex];
    if (step.type === 'delay') {
      const nextIndex = stepIndex + 1;
      const nextStep = steps[nextIndex];
      let nextStepAt: Date | null = null;
      if (nextStep?.type === 'delay') {
        nextStepAt = new Date();
        nextStepAt.setMinutes(nextStepAt.getMinutes() + nextStep.delayMinutes);
      } else if (nextStep?.type === 'wait_until') {
        nextStepAt = this.computeWaitUntil((nextStep as { condition?: unknown }).condition);
      }
      await this.prisma.sequenceEnrollment.update({
        where: { id: enr.id },
        data: { currentStepIndex: nextIndex, nextStepAt },
      });
      return;
    }
    if (step.type === 'wait_until') {
      const cond = (step as { condition?: unknown }).condition;
      if (enr.nextStepAt == null) {
        const nextAt = this.computeWaitUntil(cond);
        await this.prisma.sequenceEnrollment.update({
          where: { id: enr.id },
          data: { nextStepAt: nextAt ?? new Date() },
        });
        return;
      }
      const nextIndex = stepIndex + 1;
      const nextStep = steps[nextIndex];
      let nextStepAt: Date | null = null;
      if (nextStep?.type === 'delay') {
        nextStepAt = new Date();
        nextStepAt.setMinutes(nextStepAt.getMinutes() + (nextStep.delayMinutes ?? 0));
      } else if (nextStep?.type === 'wait_until') {
        nextStepAt = this.computeWaitUntil((nextStep as { condition?: unknown }).condition);
      }
      await this.prisma.sequenceEnrollment.update({
        where: { id: enr.id },
        data: { currentStepIndex: nextIndex, nextStepAt },
      });
      return;
    }
    if (step.type === 'email' && step.template) {
      if (enr.contact.unsubscribedAt) {
        await this.prisma.sequenceEnrollment.update({
          where: { id: enr.id },
          data: { state: 'completed', nextStepAt: null },
        });
        return;
      }
      const lastEmail = await this.prisma.activity.findFirst({
        where: { contactId: enr.contact.id, type: 'email', completedAt: { not: null } },
        orderBy: { completedAt: 'desc' },
        select: { completedAt: true },
      });
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      if (lastEmail?.completedAt && lastEmail.completedAt > oneDayAgo) {
        const nextAt = new Date(lastEmail.completedAt.getTime() + 24 * 60 * 60 * 1000);
        await this.prisma.sequenceEnrollment.update({
          where: { id: enr.id },
          data: { nextStepAt: nextAt },
        });
        return;
      }
      const vars = this.emailService.buildLeadVars({
        title: enr.lead.title,
        organization: enr.lead.organization ?? undefined,
        assignedTo: enr.lead.assignedTo ?? undefined,
        nextStep: enr.lead.nextStep,
        amount: enr.lead.amount,
        currency: enr.lead.currency,
        source: enr.lead.source,
        primaryContact: enr.lead.primaryContact ?? undefined,
        customFields: enr.lead.customFields as Record<string, unknown> | null,
      });
      const t = step.template;
      const rendered = this.emailService.renderTemplate(
        {
          subject: t.subject,
          bodyHtml: t.bodyHtml ?? undefined,
          bodyText: t.bodyText ?? undefined,
        },
        vars,
      );
      await this.emailService.send({
        to: enr.contact.email,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        ...((t as unknown as { fromName?: string | null }).fromName && { fromName: (t as unknown as { fromName: string }).fromName }),
        ...((t as unknown as { fromEmail?: string | null }).fromEmail && { fromEmail: (t as unknown as { fromEmail: string }).fromEmail }),
      });
      const nextIndex = stepIndex + 1;
      const nextStep = steps[nextIndex];
      let nextStepAt: Date | null = null;
      if (nextStep?.type === 'delay') {
        nextStepAt = new Date();
        nextStepAt.setMinutes(nextStepAt.getMinutes() + nextStep.delayMinutes);
      } else if (nextStep?.type === 'wait_until') {
        nextStepAt = this.computeWaitUntil((nextStep as { condition?: unknown }).condition);
      }
      await this.prisma.sequenceEnrollment.update({
        where: { id: enr.id },
        data: { currentStepIndex: nextIndex, nextStepAt },
      });
      await this.prisma.activity.create({
        data: {
          leadId: enr.lead.id,
          contactId: enr.contact.id,
          userId: await this.getSystemUserId((enr.lead as { assignedToId?: string | null }).assignedToId),
          type: 'email',
          subject: rendered.subject,
          body: rendered.text || rendered.html?.replace(/<[^>]*>/g, '') || null,
          outcome: 'sent',
          completedAt: new Date(),
          metadata: { sequenceEnrollmentId: enr.id },
        },
      });
      return;
    }
    if (step.type === 'webhook') {
      const config = (step as { condition?: { url?: string } }).condition;
      const url = config?.url?.trim();
      if (url) {
        try {
          await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              event: 'sequence.step',
              enrollmentId: enr.id,
              sequenceId: (enr.sequence as { id?: string }).id ?? '',
              leadId: enr.lead.id,
              contactId: enr.contact.id,
              stepIndex,
              timestamp: new Date().toISOString(),
            }),
            signal: AbortSignal.timeout(10000),
          });
        } catch (err) {
          console.error('Sequence webhook step failed:', url, err);
        }
      }
      const nextIndex = stepIndex + 1;
      const next = steps[nextIndex];
      let nextStepAt: Date | null = null;
      if (next?.type === 'delay') {
        nextStepAt = new Date();
        nextStepAt.setMinutes(nextStepAt.getMinutes() + ((next as { delayMinutes?: number }).delayMinutes ?? 0));
      } else if (next?.type === 'wait_until') {
        nextStepAt = this.computeWaitUntil((next as { condition?: unknown }).condition);
      }
      await this.prisma.sequenceEnrollment.update({
        where: { id: enr.id },
        data: { currentStepIndex: nextIndex, nextStepAt },
      });
      return;
    }
    if (step.type === 'condition') {
      const cond = (step as { condition?: { tagId?: string; present?: boolean; thenStepIndex?: number; elseStepIndex?: number } }).condition;
      let nextIndex: number;
      if (cond?.tagId != null && typeof cond.thenStepIndex === 'number' && typeof cond.elseStepIndex === 'number') {
        const hasTag = (enr.lead.tags ?? []).some((t) => t.tagId === cond.tagId || t.tag?.id === cond.tagId);
        const match = cond.present !== false ? hasTag : !hasTag;
        nextIndex = match ? cond.thenStepIndex : cond.elseStepIndex;
      } else {
        nextIndex = stepIndex + 1;
      }
      const next = steps[nextIndex];
      let nextStepAt: Date | null = null;
      if (next?.type === 'delay') {
        nextStepAt = new Date();
        nextStepAt.setMinutes(nextStepAt.getMinutes() + ((next as { delayMinutes?: number }).delayMinutes ?? 0));
      } else if (next?.type === 'wait_until') {
        nextStepAt = this.computeWaitUntil((next as { condition?: unknown }).condition);
      }
      await this.prisma.sequenceEnrollment.update({
        where: { id: enr.id },
        data: { currentStepIndex: nextIndex, nextStepAt },
      });
    }
  }
}
