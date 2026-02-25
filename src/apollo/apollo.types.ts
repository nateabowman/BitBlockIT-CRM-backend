/**
 * Apollo REST API types per docs.apollo.io
 */

export interface ApolloPersonEnrichmentParams {
  first_name?: string;
  last_name?: string;
  name?: string;
  email?: string;
  organization_name?: string;
  domain?: string;
  linkedin_url?: string;
  id?: string;
  reveal_personal_emails?: boolean;
  run_waterfall_email?: boolean;
  run_waterfall_phone?: boolean;
  reveal_phone_number?: boolean;
}

export interface ApolloPerson {
  id?: string;
  first_name?: string;
  last_name?: string;
  name?: string;
  title?: string;
  email?: string;
  linkedin_url?: string;
  organization?: ApolloOrganization;
  organization_name?: string;
  employment_history?: { title?: string; organization_name?: string }[];
  city?: string;
  state?: string;
  country?: string;
}

export interface ApolloOrganization {
  id?: string;
  name?: string;
  website_url?: string;
  primary_domain?: string;
  industry?: string;
  estimated_num_employees?: number;
  linkedin_url?: string;
  city?: string;
  state?: string;
  country?: string;
}

export interface ApolloPeopleEnrichmentResponse {
  person?: ApolloPerson;
  deductions?: unknown;
}

export interface ApolloOrganizationEnrichmentResponse {
  organization?: ApolloOrganization;
}

export interface ApolloPeopleSearchParams {
  person_titles?: string[];
  person_locations?: string[];
  q_organization_domains?: string[];
  q_keyword_tags?: string[];
  page?: number;
  per_page?: number;
  [key: string]: unknown;
}

export interface ApolloOrganizationSearchParams {
  q_organization_name?: string;
  q_organization_domains_list?: string[];
  organization_locations?: string[];
  page?: number;
  per_page?: number;
  [key: string]: unknown;
}

export interface ApolloContact {
  id: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  organization_id?: string;
  organization_name?: string;
  title?: string;
}

export interface ApolloAccount {
  id: string;
  name?: string;
  domain?: string;
}

export interface ApolloOpportunity {
  id: string;
  name?: string;
  account_id?: string;
  amount?: number;
  opportunity_stage_id?: string;
}
