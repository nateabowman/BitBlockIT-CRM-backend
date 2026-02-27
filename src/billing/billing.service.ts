import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface BillingCustomer {
  id: string;
  externalId?: string | null;
  name: string;
  email?: string | null;
  creditBalance?: number;
}

export interface BillingInvoice {
  id: string;
  invoiceNumber?: string | null;
  amount: number;
  currency: string;
  status: string;
  dueDate?: string | null;
  paidAt?: string | null;
  createdAt: string;
}

export interface BillingSubscription {
  id: string;
  planId: string;
  status: string;
  currentPeriodEnd?: string | null;
  quantity: number;
}

export interface BillingSummary {
  ltvCents: number;
  paymentCount: number;
  customerId: string;
}

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

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

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    // Item 434: Retry with exponential backoff
    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await fetch(url, {
          method,
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.apiKey}`,
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
          signal: AbortSignal.timeout(10000),
        });
        if (!res.ok) {
          const err = await res.text();
          throw new Error(`Billing API ${res.status}: ${err}`);
        }
        return res.json() as Promise<T>;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        this.logger.warn(`Billing API attempt ${attempt} failed: ${lastError.message}`);
        if (attempt < 3) await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 500));
      }
    }
    throw lastError;
  }

  // Existing: Create/link customer
  async createOrLinkCustomer(params: { externalId: string; name: string; email?: string | null }): Promise<BillingCustomer> {
    return this.request<BillingCustomer>('POST', '/api/v1/customers', {
      externalId: params.externalId,
      name: params.name,
      email: params.email ?? undefined,
    });
  }

  // Item 437: Get invoices for org
  async getInvoices(billingCustomerId: string): Promise<{ data: BillingInvoice[] }> {
    return this.request<{ data: BillingInvoice[] }>('GET', `/api/v1/invoices?customerId=${billingCustomerId}&limit=50`);
  }

  // Item 438: Create invoice for org
  async createInvoice(billingCustomerId: string, dto: {
    amount?: number;
    lineItems?: Array<{ description: string; unitPrice: number; quantity?: number }>;
    dueDate?: string;
    description?: string;
    currency?: string;
  }): Promise<BillingInvoice> {
    return this.request<BillingInvoice>('POST', '/api/v1/invoices', {
      customerId: billingCustomerId,
      ...dto,
    });
  }

  // Item 439: Get subscriptions for org
  async getSubscriptions(billingCustomerId: string): Promise<{ data: BillingSubscription[] }> {
    return this.request<{ data: BillingSubscription[] }>('GET', `/api/v1/subscriptions?customerId=${billingCustomerId}`);
  }

  // Item 440: Get payments for org
  async getPayments(billingCustomerId: string): Promise<{ data: Record<string, unknown>[] }> {
    return this.request<{ data: Record<string, unknown>[] }>('GET', `/api/v1/customers/${billingCustomerId}/payments`);
  }

  // Item 441: Get billing summary (LTV)
  async getBillingSummary(billingCustomerId: string): Promise<BillingSummary> {
    return this.request<BillingSummary>('GET', `/api/v1/customers/${billingCustomerId}/ltv`);
  }

  // Utility: safe call that doesn't throw
  async safeGetInvoices(billingCustomerId: string): Promise<BillingInvoice[]> {
    try {
      const result = await this.getInvoices(billingCustomerId);
      return result.data;
    } catch (err) {
      this.logger.warn(`Failed to fetch invoices for ${billingCustomerId}: ${err}`);
      return [];
    }
  }

  async safeGetSubscriptions(billingCustomerId: string): Promise<BillingSubscription[]> {
    try {
      const result = await this.getSubscriptions(billingCustomerId);
      return result.data;
    } catch (err) {
      this.logger.warn(`Failed to fetch subscriptions for ${billingCustomerId}: ${err}`);
      return [];
    }
  }
}
