import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface BillingCustomer {
  id: string;
  externalId?: string | null;
  name: string;
  email?: string | null;
}

@Injectable()
export class BillingService {
  constructor(private config: ConfigService) {}

  private get baseUrl(): string {
    const url = this.config.get<string>('BILLING_API_URL');
    if (!url) throw new Error('BILLING_API_URL not configured');
    return url.replace(/\/$/, '');
  }

  private get apiKey(): string {
    const key = this.config.get<string>('BILLING_API_KEY');
    if (!key) throw new Error('BILLING_API_KEY not configured');
    return key;
  }

  isConfigured(): boolean {
    return !!(this.config.get<string>('BILLING_API_URL') && this.config.get<string>('BILLING_API_KEY'));
  }

  async createOrLinkCustomer(params: {
    externalId: string;
    name: string;
    email?: string | null;
  }): Promise<BillingCustomer> {
    const res = await fetch(`${this.baseUrl}/api/v1/customers`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        externalId: params.externalId,
        name: params.name,
        email: params.email ?? undefined,
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Billing API error ${res.status}: ${err}`);
    }
    return res.json();
  }
}
