import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { WebhookOutboundService } from '../webhooks/webhook-outbound.service';
import { TrackingPageEventService } from '../tracking/tracking-page-event.service';
import { EmailService } from '../email/email.service';
import { SubmitFormDto } from './dto/submit-form.dto';

@Injectable()
export class FormsService {
  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private webhookOutbound: WebhookOutboundService,
    private trackingPageEvent: TrackingPageEventService,
    private emailService: EmailService,
  ) {}

  async findAll() {
    return this.prisma.form.findMany({
      orderBy: { name: 'asc' },
      include: {
        segment: { select: { id: true, name: true } },
        sequence: { select: { id: true, name: true } },
      },
    });
  }

  async findOne(id: string) {
    const form = await this.prisma.form.findUnique({
      where: { id },
      include: {
        segment: { select: { id: true, name: true } },
        sequence: { select: { id: true, name: true } },
        landingPages: true,
      },
    });
    if (!form) throw new NotFoundException('Form not found');
    return form;
  }

  async findOneBySlug(slug: string) {
    const lp = await this.prisma.landingPage.findUnique({
      where: { slug },
      include: { form: true },
    });
    if (!lp) throw new NotFoundException('Landing page not found');
    return lp;
  }

  async create(data: {
    name: string;
    schema: object;
    segmentId?: string;
    sequenceId?: string;
    thankYouUrl?: string;
    webhookUrl?: string;
    tagIds?: string[];
    embedAllowlist?: string[];
    progressiveConfig?: object;
    requireConfirmation?: boolean;
    confirmRedirectUrl?: string;
  }) {
    return this.prisma.form.create({
      data: {
        name: data.name,
        schema: data.schema as object,
        segmentId: data.segmentId ?? null,
        sequenceId: data.sequenceId ?? null,
        thankYouUrl: data.thankYouUrl ?? null,
        webhookUrl: data.webhookUrl ?? null,
        tagIds: (data.tagIds as object) ?? null,
        embedAllowlist: (data.embedAllowlist as object) ?? null,
        progressiveConfig: (data.progressiveConfig as object) ?? null,
        requireConfirmation: data.requireConfirmation ?? false,
        confirmRedirectUrl: data.confirmRedirectUrl ?? null,
      },
      include: {
        segment: { select: { id: true, name: true } },
        sequence: { select: { id: true, name: true } },
      },
    });
  }

  async update(
    id: string,
    data: {
      name?: string;
      schema?: object;
      segmentId?: string | null;
      sequenceId?: string | null;
      thankYouUrl?: string | null;
      webhookUrl?: string | null;
      tagIds?: string[] | null;
      embedAllowlist?: string[] | null;
      progressiveConfig?: object | null;
      requireConfirmation?: boolean | null;
      confirmRedirectUrl?: string | null;
    },
  ) {
    await this.findOne(id);
    const updateData: Prisma.FormUpdateInput = {
      ...(data.name !== undefined && { name: data.name }),
      ...(data.schema !== undefined && { schema: data.schema as object }),
      ...(data.segmentId !== undefined && { segment: data.segmentId ? { connect: { id: data.segmentId } } : { disconnect: true } }),
      ...(data.sequenceId !== undefined && { sequence: data.sequenceId ? { connect: { id: data.sequenceId } } : { disconnect: true } }),
      ...(data.thankYouUrl !== undefined && { thankYouUrl: data.thankYouUrl }),
      ...(data.webhookUrl !== undefined && { webhookUrl: data.webhookUrl }),
      ...(data.tagIds !== undefined && { tagIds: data.tagIds === null ? Prisma.JsonNull : (data.tagIds as object) }),
      ...(data.embedAllowlist !== undefined && { embedAllowlist: data.embedAllowlist === null ? Prisma.JsonNull : (data.embedAllowlist as object) }),
      ...(data.progressiveConfig !== undefined && { progressiveConfig: data.progressiveConfig === null ? Prisma.JsonNull : (data.progressiveConfig as object) }),
      ...(data.requireConfirmation !== undefined && data.requireConfirmation !== null && { requireConfirmation: data.requireConfirmation }),
      ...(data.confirmRedirectUrl !== undefined && { confirmRedirectUrl: data.confirmRedirectUrl }),
    };
    return this.prisma.form.update({
      where: { id },
      data: updateData,
      include: {
        segment: { select: { id: true, name: true } },
        sequence: { select: { id: true, name: true } },
      },
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.form.delete({ where: { id } });
    return { message: 'Form deleted' };
  }

  private validateFormData(
    schema: { fields?: Array<{ key: string; label?: string; required?: boolean; regex?: string; minLength?: number; maxLength?: number }> },
    data: Record<string, string>,
  ) {
    const fields = schema?.fields ?? [];
    for (const field of fields) {
      const value = data[field.key] ?? data[field.key.toLowerCase()] ?? '';
      const label = (field as { label?: string }).label ?? field.key;
      if (field.required && !String(value).trim()) {
        throw new BadRequestException(`Field "${label}" is required`);
      }
      if (value && field.regex && !new RegExp(field.regex).test(String(value))) {
        throw new BadRequestException(`Field "${label}" has invalid format`);
      }
      const len = String(value).length;
      if (field.minLength != null && len < field.minLength) {
        throw new BadRequestException(`Field "${label}" must be at least ${field.minLength} characters`);
      }
      if (field.maxLength != null && len > field.maxLength) {
        throw new BadRequestException(`Field "${label}" must be at most ${field.maxLength} characters`);
      }
    }
  }

  /** Normalize origin for allowlist: lowercase, no trailing slash, no path */
  private normalizeOrigin(origin: string): string {
    try {
      const u = new URL(origin);
      return `${u.protocol}//${u.host}`.toLowerCase().replace(/\/$/, '');
    } catch {
      return origin.toLowerCase().replace(/\/$/, '');
    }
  }

  /** Public submit: create/update lead and contact, optionally add to segment or enroll in sequence */
  async submit(
    formId: string,
    dto: SubmitFormDto,
    options?: { ip?: string; userAgent?: string; origin?: string },
  ) {
    const form = await this.prisma.form.findUnique({
      where: { id: formId },
      include: { segment: true, sequence: true },
    });
    if (!form) throw new NotFoundException('Form not found');

    const allowlist = (form as { embedAllowlist?: string[] }).embedAllowlist;
    if (Array.isArray(allowlist) && allowlist.length > 0) {
      const origin = options?.origin?.trim();
      if (!origin) throw new BadRequestException('Origin or Referer required when form has embed allowlist');
      const normalized = this.normalizeOrigin(origin);
      const allowed = allowlist.map((o) => this.normalizeOrigin(o));
      if (!allowed.some((o) => o === normalized)) {
        throw new BadRequestException('Form submissions are only accepted from allowed domains');
      }
    }

    const data = (dto.data ?? {}) as Record<string, string>;
    const email = dto.email ?? data?.email ?? data?.Email;
    const name = dto.name ?? data?.name ?? data?.Name;
    const company = dto.company ?? data?.company ?? data?.Company;
    const phone = (dto as { phone?: string }).phone ?? data?.phone ?? data?.Phone;
    if (!email?.trim()) throw new BadRequestException('Email is required');
    this.validateFormData((form.schema ?? {}) as { fields?: Array<{ key: string; label?: string; required?: boolean; regex?: string; minLength?: number; maxLength?: number }> }, { ...data, email, name, company });

    const [firstName, ...lastParts] = (name || 'Contact').trim().split(/\s+/);
    const lastName = lastParts.join(' ') || '';

    const defaultPipeline = await this.prisma.pipeline.findFirst({
      where: { isDefault: true },
      include: { stages: { orderBy: { order: 'asc' }, take: 1 } },
    });
    if (!defaultPipeline?.stages[0]) throw new BadRequestException('No default pipeline configured');

    let org = company
      ? await this.prisma.organization.findFirst({ where: { name: company } })
      : null;
    if (!org && company) {
      org = await this.prisma.organization.create({
        data: { name: company, type: 'prospect' },
      });
    }
    if (!org) {
      org = await this.prisma.organization.create({
        data: { name: email.split('@')[0] || 'Unknown', type: 'prospect' },
      });
    }

    const requireConfirmation = (form as { requireConfirmation?: boolean }).requireConfirmation === true;

    let contact = await this.prisma.contact.findFirst({
      where: { email: email.trim(), organizationId: org.id },
    });
    const phoneTrimmed = phone?.trim() || null;
    if (!contact) {
      contact = await this.prisma.contact.create({
        data: {
          organizationId: org.id,
          firstName,
          lastName,
          email: email.trim(),
          ...(phoneTrimmed ? { phone: phoneTrimmed } : {}),
          ...(requireConfirmation ? {} : { consentAt: new Date(), consentSource: 'form' }),
        },
      });
    } else {
      const updateData: { consentAt?: Date; consentSource?: string; phone?: string | null } = {};
      if (!requireConfirmation && !(contact as { consentAt?: Date | null }).consentAt) {
        updateData.consentAt = new Date();
        updateData.consentSource = 'form';
      }
      if (phoneTrimmed !== null) updateData.phone = phoneTrimmed;
      if (Object.keys(updateData).length > 0) {
        await this.prisma.contact.update({
          where: { id: contact.id },
          data: updateData,
        });
      }
    }

    let lead = await this.prisma.lead.findFirst({
      where: { primaryContactId: contact.id, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (!lead) {
      lead = await this.prisma.lead.create({
        data: {
          title: company ? `${company} - ${name || email}` : name || email,
          pipelineId: defaultPipeline.id,
          currentStageId: defaultPipeline.stages[0].id,
          organizationId: org.id,
          primaryContactId: contact.id,
          source: 'Form',
          sourceDetail: form.name,
          status: 'new',
        },
      });
    }

    if (requireConfirmation) {
      const token = randomBytes(32).toString('hex');
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7);
      await this.prisma.formConfirmationToken.create({
        data: { token, formId: form.id, contactId: contact.id, leadId: lead.id, expiresAt },
      });
      const base = this.config.get('API_PUBLIC_URL') || this.config.get('FRONTEND_URL') || 'http://localhost:3001';
      const apiBase = `${base.replace(/\/$/, '')}/api/v1`;
      const confirmUrl = `${apiBase}/forms/confirm?token=${token}`;
      await this.emailService.send({
        to: contact.email,
        subject: 'Confirm your subscription',
        html: `Please confirm your email by clicking: <a href="${confirmUrl}">${confirmUrl}</a>`,
        text: `Please confirm your email by visiting: ${confirmUrl}`,
      });
      await this.prisma.formSubmissionLog.create({
        data: {
          formId: form.id,
          leadId: lead.id,
          contactId: contact.id,
          data: { ...data, email: email?.trim(), name, company } as object,
          ip: options?.ip?.slice(0, 45) ?? null,
          userAgent: options?.userAgent ?? null,
        },
      });
      return {
        success: true,
        requireConfirmation: true,
        message: 'Please check your email to confirm your subscription.',
        leadId: lead.id,
        contactId: contact.id,
      };
    }

    if (form.sequenceId) {
      try {
        await this.prisma.sequenceEnrollment.create({
          data: {
            sequenceId: form.sequenceId,
            leadId: lead.id,
            contactId: contact.id,
            state: 'active',
          },
        });
      } catch {
        // already enrolled
      }
    }

    const tagIds = (form as { tagIds?: string[] }).tagIds;
    if (Array.isArray(tagIds) && tagIds.length > 0) {
      for (const tagId of tagIds) {
        try {
          await this.prisma.leadTag.upsert({
            where: { leadId_tagId: { leadId: lead.id, tagId } },
            create: { leadId: lead.id, tagId },
            update: {},
          });
        } catch {
          // tag may not exist
        }
      }
    }

    const webhookUrl = (form as { webhookUrl?: string }).webhookUrl;
    if (webhookUrl) {
      fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          formId: form.id,
          formName: form.name,
          leadId: lead.id,
          contactId: contact.id,
          email: contact.email,
          name: `${firstName} ${lastName}`.trim(),
          company: company ?? undefined,
          data,
          submittedAt: new Date().toISOString(),
        }),
        signal: AbortSignal.timeout(10000),
      }).catch((err) => console.error('Form webhook POST failed:', err));
    }

    this.webhookOutbound
      .dispatch('form.submitted', {
        formId: form.id,
        formName: form.name,
        leadId: lead.id,
        contactId: contact.id,
        email: contact.email,
        submittedAt: new Date().toISOString(),
      })
      .catch((err) => console.error('Webhook form.submitted failed:', err));

    await this.prisma.formSubmissionLog.create({
      data: {
        formId: form.id,
        leadId: lead.id,
        contactId: contact.id,
        data: { ...data, email: email?.trim(), name, company } as object,
        ip: options?.ip?.slice(0, 45) ?? null,
        userAgent: options?.userAgent ?? null,
      },
    });

    if (dto.visitorId?.trim()) {
      this.trackingPageEvent
        .identifyVisitor(dto.visitorId.trim(), contact.id, lead.id)
        .catch((err) => console.error('Identify visitor failed:', err));
    }

    let thankYouUrl = form.thankYouUrl ?? undefined;
    if (thankYouUrl) {
      try {
        const u = new URL(thankYouUrl);
        u.searchParams.set('lead_id', lead.id);
        u.searchParams.set('contact_id', contact.id);
        u.searchParams.set('email', contact.email);
        thankYouUrl = u.toString();
      } catch {
        // leave thankYouUrl as-is if invalid
      }
    }
    return {
      success: true,
      leadId: lead.id,
      contactId: contact.id,
      thankYouUrl,
    };
  }

  /** Confirm double opt-in: validate token, set consent, enroll in sequence/add tags, return redirect URL */
  async confirmToken(token: string): Promise<{ redirectUrl: string }> {
    const record = await this.prisma.formConfirmationToken.findUnique({
      where: { token },
      include: {
        form: true,
        contact: true,
        lead: true,
      },
    });
    if (!record || record.expiresAt < new Date()) {
      throw new NotFoundException('Invalid or expired confirmation link');
    }
    const form = record.form as { thankYouUrl?: string | null; confirmRedirectUrl?: string | null; sequenceId?: string | null; tagIds?: string[]; webhookUrl?: string };
    await this.prisma.contact.update({
      where: { id: record.contactId },
      data: { consentAt: new Date(), consentSource: 'form' },
    });
    if (form.sequenceId) {
      try {
        await this.prisma.sequenceEnrollment.create({
          data: {
            sequenceId: form.sequenceId,
            leadId: record.leadId,
            contactId: record.contactId,
            state: 'active',
          },
        });
      } catch {
        // already enrolled
      }
    }
    const tagIds = Array.isArray(form.tagIds) ? form.tagIds : [];
    for (const tagId of tagIds) {
      try {
        await this.prisma.leadTag.upsert({
          where: { leadId_tagId: { leadId: record.leadId, tagId } },
          create: { leadId: record.leadId, tagId },
          update: {},
        });
      } catch {
        // tag may not exist
      }
    }
    if (form.webhookUrl) {
      fetch(form.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          formId: record.formId,
          event: 'form.confirmed',
          leadId: record.leadId,
          contactId: record.contactId,
          email: record.contact.email,
          confirmedAt: new Date().toISOString(),
        }),
        signal: AbortSignal.timeout(10000),
      }).catch((err) => console.error('Form confirm webhook failed:', err));
    }
    this.webhookOutbound
      .dispatch('form.confirmed', {
        formId: record.formId,
        leadId: record.leadId,
        contactId: record.contactId,
        email: record.contact.email,
        confirmedAt: new Date().toISOString(),
      })
      .catch((err) => console.error('Webhook form.confirmed failed:', err));
    await this.prisma.formConfirmationToken.delete({ where: { id: record.id } });
    const base = this.config.get('API_PUBLIC_URL') || this.config.get('FRONTEND_URL') || 'http://localhost:3001';
    const redirectUrl =
      form.confirmRedirectUrl?.trim() ||
      form.thankYouUrl?.trim() ||
      `${base.replace(/\/$/, '')}`;
    return { redirectUrl };
  }

  /** List form submission logs with pagination; optionally export as CSV */
  async getSubmissions(
    formId: string,
    page = 1,
    limit = 50,
    format?: 'json' | 'csv',
  ) {
    await this.findOne(formId);
    const skip = (Math.max(1, page) - 1) * Math.min(100, Math.max(1, limit));
    const take = format === 'csv' ? 10000 : Math.min(100, Math.max(1, limit));
    const [rows, total] = await Promise.all([
      this.prisma.formSubmissionLog.findMany({
        where: { formId },
        orderBy: { submittedAt: 'desc' },
        skip,
        take,
        include: {
          contact: { select: { id: true, email: true, firstName: true, lastName: true } },
          lead: { select: { id: true, title: true } },
        },
      }),
      this.prisma.formSubmissionLog.count({ where: { formId } }),
    ]);
    if (format === 'csv') {
      const headers = ['submittedAt', 'email', 'firstName', 'lastName', 'leadId', 'ip', 'data'];
      const escape = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const lines = [
        headers.join(','),
        ...rows.map((r) =>
          [
            r.submittedAt.toISOString(),
            r.contact?.email ?? '',
            r.contact?.firstName ?? '',
            r.contact?.lastName ?? '',
            r.leadId ?? '',
            r.ip ?? '',
            escape(JSON.stringify(r.data ?? {})),
          ].join(','),
        ),
      ];
      return { data: lines.join('\n'), contentType: 'text/csv' };
    }
    return { data: { items: rows, total, page, limit: take } };
  }

  async createLandingPage(formId: string, data: { slug: string; title: string; body?: string | null }) {
    await this.findOne(formId);
    const slug = data.slug.trim().toLowerCase().replace(/\s+/g, '-');
    if (!slug) throw new BadRequestException('Slug is required');
    return this.prisma.landingPage.create({
      data: {
        formId,
        slug,
        title: data.title.trim() || slug,
        body: data.body?.trim() ?? null,
      },
    });
  }

  async updateLandingPage(formId: string, lpId: string, data: { slug?: string; title?: string; body?: string | null }) {
    const lp = await this.prisma.landingPage.findFirst({ where: { id: lpId, formId } });
    if (!lp) throw new NotFoundException('Landing page not found');
    const update: { slug?: string; title?: string; body?: string | null } = {};
    if (data.slug !== undefined) update.slug = data.slug.trim().toLowerCase().replace(/\s+/g, '-');
    if (data.title !== undefined) update.title = data.title.trim() || lp.slug;
    if (data.body !== undefined) update.body = data.body?.trim() ?? null;
    return this.prisma.landingPage.update({
      where: { id: lpId },
      data: update,
    });
  }

  async removeLandingPage(formId: string, lpId: string) {
    const lp = await this.prisma.landingPage.findFirst({ where: { id: lpId, formId } });
    if (!lp) throw new NotFoundException('Landing page not found');
    await this.prisma.landingPage.delete({ where: { id: lpId } });
    return { message: 'Landing page deleted' };
  }

  /** Render full HTML for landing page (title, optional body, form) at /lp/:slug */
  async renderLandingPageHtml(slug: string): Promise<string> {
    const lp = await this.findOneBySlug(slug);
    const form = lp.form as { id: string; name: string; schema?: { fields?: Array<{ key: string; label?: string; type?: string }> } };
    const base = this.config.get('API_PUBLIC_URL') || this.config.get('FRONTEND_URL') || 'http://localhost:3001';
    const apiBase = `${base.replace(/\/$/, '')}/api/v1`;
    const fields = (form.schema?.fields ?? []).map(
      (f) =>
        `<p><label>${f.label ?? f.key}</label><br><input type="${f.type === 'email' ? 'email' : f.type === 'number' ? 'number' : 'text'}" name="${f.key}" ${f.key === 'email' || f.key === 'Email' ? 'required' : ''}></p>`,
    );
    const bodyHtml = (lp as { body?: string | null }).body?.trim() ?? '';
    const formHtml = `
<form id="f" action="${apiBase}/forms/${form.id}/submit" method="post">
  <input type="hidden" name="data" value="{}">
  <div id="fields">${fields.join('\n')}</div>
  <button type="submit">Submit</button>
</form>
<script>
(function(){
  var form = document.getElementById('f');
  form.addEventListener('submit', function(e) {
    e.preventDefault();
    var fd = new FormData(form);
    var data = {};
    fd.forEach(function(v,k) { if (k !== 'data') data[k] = v; });
    form.querySelector('input[name="data"]').value = JSON.stringify(data);
    fetch(form.action, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: data, email: data.email || data.Email, name: data.name || data.Name, company: data.company || data.Company, visitorId: (document.cookie.match(/bb_visitor_id=([^;]+)/)||[])[1] }) })
      .then(function(r) { return r.json(); })
      .then(function(j) { if (j.data && j.data.thankYouUrl) window.top.location = j.data.thankYouUrl; else alert('Thank you!'); })
      .catch(function() { alert('Error'); });
  });
})();
</script>`;
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${lp.title}</title></head><body>${bodyHtml ? `<div class="lp-body">${bodyHtml}</div>` : ''}${formHtml}</body></html>`;
  }

  /** Get embed snippet for form (iframe URL and script tag) */
  async getEmbedSnippet(formId: string) {
    const form = await this.findOne(formId);
    const base = this.config.get('API_PUBLIC_URL') || this.config.get('FRONTEND_URL') || 'http://localhost:3001';
    const apiBase = `${base.replace(/\/$/, '')}/api/v1`;
    const iframeUrl = `${apiBase}/forms/f/${form.id}`;
    const scriptSnippet = `<script src="${apiBase}/forms/embed.js?formId=${form.id}" async></script>`;
    const iframeSnippet = `<iframe src="${iframeUrl}" width="100%" height="400" frameborder="0" title="${form.name}"></iframe>`;
    return { iframeUrl, scriptSnippet, iframeSnippet };
  }
}
