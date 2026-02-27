/**
 * BullMQ Queue Configuration
 * Install: npm install bullmq @nestjs/bullmq
 */

export const QUEUE_NAMES = {
  EMAILS: 'emails',
  AUTOMATIONS: 'automations',
  NOTIFICATIONS: 'notifications',
  LEAD_SCORING: 'lead-scoring',
  EXPORTS: 'exports',
  CAMPAIGN_SENDS: 'campaign-sends',
  WEBHOOK_DELIVERY: 'webhook-delivery',
} as const;

export type QueueName = typeof QUEUE_NAMES[keyof typeof QUEUE_NAMES];

export const QUEUE_DEFAULTS = {
  defaultJobOptions: {
    removeOnComplete: { count: 100, age: 24 * 3600 },
    removeOnFail: { count: 50 },
    attempts: 3,
    backoff: { type: 'exponential' as const, delay: 2000 },
  },
};

export const DEAD_LETTER_QUEUE = 'dead-letter';
