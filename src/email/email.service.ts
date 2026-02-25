import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class EmailService {
  private transporter: nodemailer.Transporter | null = null;

  constructor(private config: ConfigService) {
    const host = this.config.get('SMTP_HOST');
    if (host) {
      this.transporter = nodemailer.createTransport({
        host,
        port: this.config.get('SMTP_PORT', 587),
        secure: this.config.get('SMTP_SECURE') === 'true',
        auth: this.config.get('SMTP_USER')
          ? {
              user: this.config.get('SMTP_USER'),
              pass: this.config.get('SMTP_PASS'),
            }
          : undefined,
      });
    }
  }

  async send(options: {
    to: string;
    subject: string;
    text?: string;
    html?: string;
    listUnsubscribeUrl?: string;
    listUnsubscribeMailto?: string;
    fromName?: string;
    fromEmail?: string;
    replyTo?: string;
  }): Promise<{ messageId?: string }> {
    const defaultFrom = this.config.get('SMTP_FROM', 'BitBlockIT CRM <noreply@bitblockit.com>');
    const parsed = defaultFrom.match(/^(.+?)\s*<([^>]+)>$/) || [null, defaultFrom, defaultFrom];
    let fromName = options.fromName ?? (parsed[1] || 'BitBlockIT CRM').trim();
    let fromEmail = options.fromEmail ?? (parsed[2] || defaultFrom).trim();
    if (options.fromName !== undefined || options.fromEmail !== undefined) {
      fromName = (options.fromName ?? fromName).trim();
      fromEmail = (options.fromEmail ?? fromEmail).trim();
    }
    const from = fromName ? `${fromName} <${fromEmail}>` : fromEmail;

    const resendKey = this.config.get('RESEND_API_KEY');
    const sendgridKey = this.config.get('SENDGRID_API_KEY');
    const listUnsubscribeParts: string[] = [];
    if (options.listUnsubscribeUrl) listUnsubscribeParts.push(`<${options.listUnsubscribeUrl}>`);
    if (options.listUnsubscribeMailto) listUnsubscribeParts.push(`<mailto:${options.listUnsubscribeMailto}>`);
    const listUnsubscribeHeader = listUnsubscribeParts.length ? listUnsubscribeParts.join(', ') : undefined;

    if (resendKey) {
      const payload: Record<string, unknown> = {
        from,
        to: [options.to],
        subject: options.subject,
        html: options.html ?? options.text ?? '',
        text: options.text,
      };
      if (options.replyTo) payload.reply_to = options.replyTo.trim();
      if (listUnsubscribeHeader) payload.headers = { 'List-Unsubscribe': listUnsubscribeHeader };
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${resendKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.text();
        throw new Error(`Resend send failed: ${res.status} ${err}`);
      }
      const data = (await res.json()) as { id?: string };
      return { messageId: data.id ?? 'resend' };
    }

    if (sendgridKey) {
      const content: { type: string; value: string }[] = [];
      if (options.text) content.push({ type: 'text/plain', value: options.text });
      if (options.html) content.push({ type: 'text/html', value: options.html });
      if (!content.length) content.push({ type: 'text/plain', value: ' ' });
      const payload: Record<string, unknown> = {
        personalizations: [{ to: [{ email: options.to }] }],
        from: { email: fromEmail, name: fromName },
        subject: options.subject,
        content,
      };
      if (options.replyTo) payload.reply_to = { email: options.replyTo.trim() };
      if (listUnsubscribeHeader) payload.headers = { 'List-Unsubscribe': listUnsubscribeHeader };
      const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${sendgridKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.text();
        throw new Error(`SendGrid send failed: ${res.status} ${err}`);
      }
      const id = res.headers.get('x-message-id');
      return { messageId: id ?? 'sendgrid' };
    }

    const mailgunKey = this.config.get('MAILGUN_API_KEY');
    const mailgunDomain = this.config.get('MAILGUN_DOMAIN');
    if (mailgunKey && mailgunDomain) {
      const form = new URLSearchParams();
      form.set('from', from);
      form.set('to', options.to);
      form.set('subject', options.subject);
      if (options.html) form.set('html', options.html);
      if (options.text) form.set('text', options.text);
      if (options.replyTo) form.set('h:Reply-To', options.replyTo.trim());
      if (listUnsubscribeHeader) form.set('h:List-Unsubscribe', listUnsubscribeHeader);
      const res = await fetch(`https://api.mailgun.net/v3/${mailgunDomain}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`api:${mailgunKey}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: form.toString(),
      });
      if (!res.ok) {
        const err = await res.text();
        throw new Error(`Mailgun send failed: ${res.status} ${err}`);
      }
      const data = (await res.json()) as { id?: string };
      return { messageId: data.id ?? 'mailgun' };
    }

    if (!this.transporter) {
      console.warn('No email provider (Resend, SendGrid, or SMTP) configured; email not sent:', options.subject);
      return { messageId: 'no-provider' };
    }
    const mailOptions: { from: string; to: string; subject: string; text?: string; html?: string; replyTo?: string; headers?: Record<string, string> } = {
      from,
      to: options.to,
      subject: options.subject,
      text: options.text,
      html: options.html,
    };
    if (options.replyTo) mailOptions.replyTo = options.replyTo.trim();
    if (listUnsubscribeHeader) mailOptions.headers = { 'List-Unsubscribe': listUnsubscribeHeader };
    const info = await this.transporter.sendMail(mailOptions);
    return { messageId: info.messageId };
  }

  renderTemplate(template: { subject: string; bodyHtml?: string; bodyText?: string }, vars: Record<string, string>) {
    let subject = template.subject;
    let html = template.bodyHtml ?? '';
    let text = template.bodyText ?? '';
    for (const [k, v] of Object.entries(vars)) {
      const re = new RegExp(`{{${k}}}`, 'gi');
      const safe = String(v ?? '').replace(/\\/g, '\\\\');
      subject = subject.replace(re, safe);
      html = html.replace(re, safe);
      text = text.replace(re, safe);
    }
    if (!text && html) {
      text = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    }
    return { subject, html, text };
  }

  /**
   * Build template variables for a lead. Supports: leadName, company, assignedTo,
   * nextStep, amount, currency, source, contactName, contactEmail, and custom field keys.
   */
  buildLeadVars(lead: {
    title?: string | null;
    organization?: { name?: string | null; industry?: string | null } | null;
    assignedTo?: { name?: string | null } | null;
    nextStep?: string | null;
    amount?: unknown;
    currency?: string | null;
    source?: string | null;
    primaryContact?: { firstName?: string; lastName?: string; email?: string } | null;
    customFields?: Record<string, unknown> | null;
  }): Record<string, string> {
    const vars: Record<string, string> = {
      leadName: lead.title ?? '',
      company: lead.organization?.name ?? '',
      CompanyName: lead.organization?.name ?? '',
      industry: lead.organization?.industry ?? '',
      Industry: lead.organization?.industry ?? '',
      assignedTo: lead.assignedTo?.name ?? '',
      nextStep: lead.nextStep ?? '',
      amount: lead.amount != null ? String(lead.amount) : '',
      currency: lead.currency ?? '',
      source: lead.source ?? '',
      contactName: lead.primaryContact
        ? [lead.primaryContact.firstName, lead.primaryContact.lastName].filter(Boolean).join(' ') || ''
        : '',
      contactFirstName: lead.primaryContact?.firstName ?? '',
      contactLastName: lead.primaryContact?.lastName ?? '',
      contactEmail: lead.primaryContact?.email ?? '',
      scheduleMeetingUrl: this.config.get('SCHEDULE_MEETING_URL') ?? '',
    };
    if (lead.customFields && typeof lead.customFields === 'object') {
      for (const [k, v] of Object.entries(lead.customFields)) {
        vars[k] = v != null ? String(v) : '';
      }
    }
    return vars;
  }
}
