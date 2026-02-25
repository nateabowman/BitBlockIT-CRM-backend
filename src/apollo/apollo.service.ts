import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APOLLO_API_BASE } from './apollo.constants';
import type {
  ApolloPersonEnrichmentParams,
  ApolloPeopleEnrichmentResponse,
  ApolloOrganizationEnrichmentResponse,
  ApolloPeopleSearchParams,
  ApolloOrganizationSearchParams,
  ApolloPerson,
  ApolloOrganization,
} from './apollo.types';

@Injectable()
export class ApolloService {
  private readonly apiKey: string;
  private readonly masterApiKey: string | undefined;
  private readonly baseUrl = APOLLO_API_BASE;

  constructor(private config: ConfigService) {
    this.apiKey = this.config.get<string>('APOLLO_API_KEY') ?? '';
    this.masterApiKey = this.config.get<string>('APOLLO_MASTER_API_KEY') || this.apiKey || undefined;
  }

  private ensureConfigured(): void {
    if (!this.apiKey?.trim()) {
      throw new Error('APOLLO_API_KEY is not configured. Set it in your environment to use Apollo integration.');
    }
  }

  private async request<T>(
    method: string,
    path: string,
    options?: {
      query?: Record<string, string | number | boolean | string[] | undefined>;
      body?: Record<string, unknown>;
      useMasterKey?: boolean;
    },
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    if (options?.query) {
      for (const [k, v] of Object.entries(options.query)) {
        if (v === undefined) continue;
        if (Array.isArray(v)) {
          v.forEach((val) => url.searchParams.append(`${k}[]`, String(val)));
        } else {
          url.searchParams.set(k, String(v));
        }
      }
    }
    const apiKey = options?.useMasterKey ? this.masterApiKey : this.apiKey;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
      'x-api-key': apiKey!,
    };
    const res = await fetch(url.toString(), {
      method,
      headers,
      body: options?.body ? JSON.stringify(options.body) : undefined,
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const err = (data.error as string) || data.message || res.statusText;
      throw new Error(`Apollo API error (${res.status}): ${String(err)}`);
    }
    return data as T;
  }

  async enrichPerson(params: ApolloPersonEnrichmentParams): Promise<ApolloPeopleEnrichmentResponse> {
    this.ensureConfigured();
    const query: Record<string, string | boolean | undefined> = {};
    if (params.first_name) query.first_name = params.first_name;
    if (params.last_name) query.last_name = params.last_name;
    if (params.name) query.name = params.name;
    if (params.email) query.email = params.email;
    if (params.organization_name) query.organization_name = params.organization_name;
    if (params.domain) query.domain = params.domain;
    if (params.linkedin_url) query.linkedin_url = params.linkedin_url;
    if (params.id) query.id = params.id;
    if (params.reveal_personal_emails) query.reveal_personal_emails = true;
    if (params.run_waterfall_email) query.run_waterfall_email = true;
    if (params.run_waterfall_phone) query.run_waterfall_phone = true;
    if (params.reveal_phone_number) query.reveal_phone_number = true;

    return this.request<ApolloPeopleEnrichmentResponse>('POST', '/people/match', {
      query: query as Record<string, string | number | boolean | string[] | undefined>,
    });
  }

  async enrichOrganization(domain: string): Promise<ApolloOrganizationEnrichmentResponse> {
    this.ensureConfigured();
    return this.request<ApolloOrganizationEnrichmentResponse>('GET', '/organizations/enrich', {
      query: { domain },
    });
  }

  async searchPeople(params: ApolloPeopleSearchParams): Promise<{ people: ApolloPerson[]; pagination: { total_entries: number; total_pages: number } }> {
    this.ensureConfigured();
    const body: Record<string, unknown> = {};
    if (params.person_titles?.length) body.person_titles = params.person_titles;
    if (params.person_locations?.length) body.person_locations = params.person_locations;
    if (params.q_organization_domains?.length) body.q_organization_domains = params.q_organization_domains;
    if (params.q_keyword_tags?.length) body.q_keyword_tags = params.q_keyword_tags;
    if (params.page != null) body.page = params.page;
    if (params.per_page != null) body.per_page = params.per_page;

    const res = await this.request<{ people: ApolloPerson[]; pagination: { total_entries: number; total_pages: number } }>(
      'POST',
      '/mixed_people/api_search',
      { body: Object.keys(body).length ? body : { page: 1, per_page: 25 } },
    );
    return res;
  }

  async searchOrganizations(
    params: ApolloOrganizationSearchParams,
  ): Promise<{ organizations: ApolloOrganization[]; pagination: { total_entries: number; total_pages: number } }> {
    this.ensureConfigured();
    const body: Record<string, unknown> = {};
    if (params.q_organization_name) body.q_organization_name = params.q_organization_name;
    if (params.q_organization_domains_list?.length) body.q_organization_domains_list = params.q_organization_domains_list;
    if (params.organization_locations?.length) body.organization_locations = params.organization_locations;
    if (params.page != null) body.page = params.page;
    if (params.per_page != null) body.per_page = params.per_page;

    const res = await this.request<{ organizations: ApolloOrganization[]; pagination: { total_entries: number; total_pages: number } }>(
      'POST',
      '/mixed_companies/search',
      { body: Object.keys(body).length ? body : { page: 1, per_page: 25 } },
    );
    return res;
  }

  async createContact(data: {
    first_name?: string;
    last_name?: string;
    email?: string;
    organization_name?: string;
    account_id?: string;
    title?: string;
    run_dedupe?: boolean;
  }): Promise<{ contact: { id: string } }> {
    this.ensureConfigured();
    return this.request<{ contact: { id: string } }>('POST', '/contacts', {
      body: data,
      useMasterKey: true,
    });
  }

  async createAccount(data: { name: string; domain?: string }): Promise<{ account: { id: string } }> {
    this.ensureConfigured();
    return this.request<{ account: { id: string } }>('POST', '/accounts', {
      body: data,
      useMasterKey: true,
    });
  }

  async createDeal(data: {
    name: string;
    account_id?: string;
    owner_id?: string;
    amount?: number | string;
    opportunity_stage_id?: string;
  }): Promise<{ opportunity: { id: string } }> {
    this.ensureConfigured();
    return this.request<{ opportunity: { id: string } }>('POST', '/opportunities', {
      body: data,
      useMasterKey: true,
    });
  }

  async addToSequence(params: {
    sequenceId: string;
    contactIds: string[];
    sendEmailFromEmailAccountId?: string;
  }): Promise<{ contacts?: unknown[] }> {
    this.ensureConfigured();
    const { sequenceId, contactIds, sendEmailFromEmailAccountId } = params;
    const query: Record<string, string | string[]> = {};
    query.emailer_campaign_id = sequenceId;
    query['contact_ids[]'] = contactIds;
    if (sendEmailFromEmailAccountId) query.send_email_from_email_account_id = sendEmailFromEmailAccountId;

    const url = new URL(`${this.baseUrl}/emailer_campaigns/${sequenceId}/add_contact_ids`);
    for (const [k, v] of Object.entries(query)) {
      if (Array.isArray(v)) {
        v.forEach((val) => url.searchParams.append(k, val));
      } else {
        url.searchParams.set(k, v);
      }
    }

    const res = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
        'x-api-key': this.masterApiKey!,
      },
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const err = (data.error as string) || data.message || res.statusText;
      throw new Error(`Apollo API error (${res.status}): ${String(err)}`);
    }
    return data as { contacts?: unknown[] };
  }

  async searchSequences(): Promise<{ emailer_campaigns: { id: string; name: string }[] }> {
    this.ensureConfigured();
    return this.request<{ emailer_campaigns: { id: string; name: string }[] }>('POST', '/emailer_campaigns/search', {
      body: {},
      useMasterKey: true,
    });
  }

  async listDealStages(): Promise<{ opportunity_stages: { id: string; name: string }[] }> {
    this.ensureConfigured();
    return this.request<{ opportunity_stages: { id: string; name: string }[] }>('GET', '/opportunity_stages', {
      useMasterKey: true,
    });
  }

  // --- Additional Apollo API functions ---

  async searchContacts(body: Record<string, unknown>): Promise<unknown> {
    this.ensureConfigured();
    return this.request<unknown>('POST', '/contacts/search', { body, useMasterKey: true });
  }

  async searchAccounts(body: Record<string, unknown>): Promise<unknown> {
    this.ensureConfigured();
    return this.request<unknown>('POST', '/accounts/search', { body, useMasterKey: true });
  }

  async updateContact(contactId: string, body: Record<string, unknown>): Promise<unknown> {
    this.ensureConfigured();
    return this.request<unknown>('PATCH', `/contacts/${contactId}`, { body, useMasterKey: true });
  }

  async bulkCreateContacts(body: Record<string, unknown>): Promise<unknown> {
    this.ensureConfigured();
    return this.request<unknown>('POST', '/contacts/bulk_create', { body, useMasterKey: true });
  }

  async bulkUpdateContacts(body: Record<string, unknown>): Promise<unknown> {
    this.ensureConfigured();
    return this.request<unknown>('POST', '/contacts/bulk_update', { body, useMasterKey: true });
  }

  async bulkCreateAccounts(body: Record<string, unknown>): Promise<unknown> {
    this.ensureConfigured();
    return this.request<unknown>('POST', '/accounts/bulk_create', { body, useMasterKey: true });
  }

  async bulkEnrichPeople(body: Record<string, unknown>, query?: Record<string, string | boolean>): Promise<unknown> {
    this.ensureConfigured();
    return this.request<unknown>('POST', '/people/bulk_match', { body, query, useMasterKey: false });
  }

  async showPerson(personId: string): Promise<unknown> {
    this.ensureConfigured();
    return this.request<unknown>('GET', '/people/show', { query: { id: personId } });
  }

  async showOrganization(organizationId: string): Promise<unknown> {
    this.ensureConfigured();
    return this.request<unknown>('GET', '/organizations/show', { query: { id: organizationId } });
  }

  async searchOrganizationsInAccount(body: Record<string, unknown>): Promise<unknown> {
    this.ensureConfigured();
    return this.request<unknown>('POST', '/organizations/search', { body, useMasterKey: true });
  }

  async bulkEnrichOrganizations(domains: string[]): Promise<unknown> {
    this.ensureConfigured();
    return this.request<unknown>('POST', '/organizations/bulk_enrich', {
      query: { domains } as unknown as Record<string, string | number | boolean | string[] | undefined>,
    });
  }

  async getOrganizationJobPostings(organizationId: string, page?: number, perPage?: number): Promise<unknown> {
    this.ensureConfigured();
    const query: Record<string, string | number> = {};
    if (page != null) query.page = page;
    if (perPage != null) query.per_page = perPage;
    return this.request<unknown>('GET', `/organizations/${organizationId}/job_postings`, { query });
  }

  async getOrganizationTopPeople(body: Record<string, unknown>): Promise<unknown> {
    this.ensureConfigured();
    return this.request<unknown>('POST', '/mixed_people/organization_top_people', { body });
  }

  async getSyncReport(body: Record<string, unknown>): Promise<unknown> {
    this.ensureConfigured();
    return this.request<unknown>('POST', '/reports/sync_report', { body, useMasterKey: true });
  }

  async createField(body: Record<string, unknown>): Promise<unknown> {
    this.ensureConfigured();
    return this.request<unknown>('POST', '/fields/create', { body, useMasterKey: true });
  }

  /** Pass-through to Apollo /mixed_companies/search */
  async mixedCompaniesSearch(body: Record<string, unknown>): Promise<unknown> {
    this.ensureConfigured();
    return this.request<unknown>('POST', '/mixed_companies/search', {
      body: Object.keys(body).length ? body : { page: 1, per_page: 25 },
    });
  }

  /** Pass-through to Apollo /mixed_people/api_search */
  async mixedPeopleSearch(body: Record<string, unknown>): Promise<unknown> {
    this.ensureConfigured();
    return this.request<unknown>('POST', '/mixed_people/api_search', {
      body: Object.keys(body).length ? body : { page: 1, per_page: 25 },
    });
  }
}
