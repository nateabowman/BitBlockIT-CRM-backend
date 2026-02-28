/**
 * Sentry instrumentation - must be imported before any other modules.
 * https://docs.sentry.io/platforms/javascript/guides/nestjs/
 */

import * as Sentry from '@sentry/nestjs';

const DISCORD_WEBHOOK =
  process.env.SENTRY_DISCORD_WEBHOOK_URL?.trim() || process.env.DISCORD_WEBHOOK_URL?.trim();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function notifyDiscord(event: any): void {
  if (!DISCORD_WEBHOOK || !event) return;
  const msg = event.exception?.values?.[0]?.value ?? event.message ?? 'Unknown error';
  const type = event.exception?.values?.[0]?.type ?? 'Error';
  const env = event.environment ?? process.env.NODE_ENV ?? 'unknown';
  const url = event.request?.url;
  const stack = event.exception?.values?.[0]?.stacktrace?.frames
    ?.slice(-5)
    .map((f: { filename?: string; line?: number }) => `${f.filename}:${f.line ?? '?'}`)
    .join('\n');

  const fields: { name: string; value: string; inline?: boolean }[] = [
    { name: 'Type', value: type, inline: true },
    { name: 'Environment', value: env, inline: true },
    { name: 'Project', value: 'bitblockit-crm-backend', inline: true },
    { name: 'Message', value: String(msg).slice(0, 1000), inline: false },
  ];
  if (url) fields.push({ name: 'URL', value: url.slice(0, 200), inline: false });
  if (stack)
    fields.push({
      name: 'Stack (last 5 frames)',
      value: '```\n' + stack.slice(0, 800) + '\n```',
      inline: false,
    });

  fetch(DISCORD_WEBHOOK, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      embeds: [
        {
          title: 'Sentry Error: bitblockit-crm-backend',
          color: 0xed4245,
          fields,
          timestamp: new Date().toISOString(),
        },
      ],
    }),
  }).catch(() => {});
}

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV ?? 'development',
  tracesSampleRate: 1,
  enableLogs: true,
  beforeSend(event) {
    if (event) notifyDiscord(event);
    return event;
  },
});
