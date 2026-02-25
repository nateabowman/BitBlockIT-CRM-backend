import { Injectable } from '@nestjs/common';

export interface WebhookLeadAttempt {
  timestamp: string;
  statusCode: number;
  message: string;
  details?: string[];
}

/**
 * In-memory log of the last POST /webhooks/leads attempt.
 * Used so admins can see why a webhook lead failed without checking server logs.
 */
@Injectable()
export class WebhookLeadsLogService {
  private lastAttempt: WebhookLeadAttempt | null = null;

  record(attempt: WebhookLeadAttempt) {
    this.lastAttempt = attempt;
  }

  getLast(): WebhookLeadAttempt | null {
    return this.lastAttempt;
  }
}
