import {
  Controller,
  Post,
  Get,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ApolloService } from './apollo.service';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('apollo')
@Controller('apollo')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class ApolloController {
  constructor(
    private apollo: ApolloService,
    private prisma: PrismaService,
  ) {}

  @Post('enrich-lead/:id')
  @ApiOperation({ summary: 'Enrich a lead with Apollo data' })
  @ApiResponse({ status: 200, description: 'Lead enriched' })
  async enrichLead(@Param('id') leadId: string) {
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      include: { primaryContact: true, organization: true },
    });
    if (!lead) throw new NotFoundException('Lead not found');
    const contact = lead.primaryContact;
    const org = lead.organization;
    if (!contact) throw new BadRequestException('Lead has no primary contact');
    if (!contact.email) throw new BadRequestException('Lead contact has no email');

    const personRes = await this.apollo.enrichPerson({
      email: contact.email,
      organization_name: org?.name ?? undefined,
    });
    if (!personRes.person) {
      return { data: { enriched: false, message: 'No matching person found in Apollo' } };
    }

    const person = personRes.person;
    const updates: { contact?: object; organization?: object } = {};

    const contactData: Record<string, unknown> = {};
    const cf = { ...((contact.customFields as Record<string, unknown>) || {}) };
    if (person.title) contactData.title = person.title;
    if (person.linkedin_url) cf.linkedin_url = person.linkedin_url;
    if (Object.keys(cf).length > 0) contactData.customFields = cf;
    if (person.title || person.id || Object.keys(cf).length > 0) {
      await this.prisma.contact.update({
        where: { id: contact.id },
        data: {
          ...(person.title ? { title: person.title } : {}),
          ...(person.id ? { apolloPersonId: person.id } : {}),
          ...(Object.keys(cf).length > 0 ? { customFields: cf as object } : {}),
        },
      });
      updates.contact = contactData;
    }

    if (org && person.organization) {
      const orgData: Record<string, unknown> = {};
      const apolloOrg = person.organization;
      if (apolloOrg.industry) orgData.industry = apolloOrg.industry;
      if (apolloOrg.id) orgData.apolloOrganizationId = apolloOrg.id;
      if (Object.keys(orgData).length > 0) {
        await this.prisma.organization.update({
          where: { id: org.id },
          data: orgData as { industry?: string; apolloOrganizationId?: string },
        });
        updates.organization = orgData;
      }
    } else if (org && person.organization_name && !org.domain) {
      const domainRes = await this.apollo.enrichOrganization(
        person.organization_name.toLowerCase().replace(/\s+/g, '') + '.com',
      ).catch(() => null);
      if (domainRes?.organization) {
        const ao = domainRes.organization;
        await this.prisma.organization.update({
          where: { id: org.id },
          data: {
            domain: ao.primary_domain ?? ao.website_url ?? undefined,
            industry: ao.industry ?? undefined,
            apolloOrganizationId: ao.id ?? undefined,
          },
        });
        updates.organization = { domain: ao.primary_domain, industry: ao.industry };
      }
    }

    return { data: { enriched: true, person, updates } };
  }

  @Post('enrich-contact/:id')
  @ApiOperation({ summary: 'Enrich a contact with Apollo data' })
  @ApiResponse({ status: 200, description: 'Contact enriched' })
  async enrichContact(@Param('id') contactId: string) {
    const contact = await this.prisma.contact.findUnique({
      where: { id: contactId },
      include: { organization: true },
    });
    if (!contact) throw new NotFoundException('Contact not found');
    if (!contact.email) throw new BadRequestException('Contact has no email');

    const personRes = await this.apollo.enrichPerson({
      email: contact.email,
      organization_name: contact.organization?.name ?? undefined,
    });
    if (!personRes.person) {
      return { data: { enriched: false, message: 'No matching person found in Apollo' } };
    }

    const person = personRes.person;
    const cf = (contact.customFields as Record<string, unknown>) || {};
    if (person.linkedin_url) cf.linkedin_url = person.linkedin_url;

    await this.prisma.contact.update({
      where: { id: contact.id },
      data: {
        ...(person.title ? { title: person.title } : {}),
        ...(person.id ? { apolloPersonId: person.id } : {}),
        ...(Object.keys(cf).length > 0 ? { customFields: cf as object } : {}),
      },
    });

    if (contact.organization && person.organization) {
      const ao = person.organization;
      await this.prisma.organization.update({
        where: { id: contact.organization.id },
        data: {
          industry: ao.industry ?? undefined,
          domain: ao.primary_domain ?? ao.website_url ?? undefined,
          apolloOrganizationId: ao.id ?? undefined,
        },
      });
    }

    return { data: { enriched: true, person } };
  }

  @Post('search/people')
  @ApiOperation({ summary: 'Search people in Apollo' })
  @ApiResponse({ status: 200, description: 'People search results' })
  async searchPeople(
    @Body() body: { person_titles?: string[]; person_locations?: string[]; q_organization_domains?: string[]; page?: number; per_page?: number },
  ) {
    const res = await this.apollo.searchPeople({
      person_titles: body.person_titles,
      person_locations: body.person_locations,
      q_organization_domains: body.q_organization_domains,
      page: body.page ?? 1,
      per_page: Math.min(body.per_page ?? 25, 100),
    });
    return { data: res };
  }

  @Post('search/organizations')
  @ApiOperation({ summary: 'Search organizations in Apollo' })
  @ApiResponse({ status: 200, description: 'Organization search results' })
  async searchOrganizations(
    @Body() body: { q_organization_name?: string; q_organization_domains_list?: string[]; organization_locations?: string[]; page?: number; per_page?: number },
  ) {
    const res = await this.apollo.searchOrganizations({
      q_organization_name: body.q_organization_name,
      q_organization_domains_list: body.q_organization_domains_list,
      organization_locations: body.organization_locations,
      page: body.page ?? 1,
      per_page: Math.min(body.per_page ?? 25, 100),
    });
    return { data: res };
  }

  @Post('lead/:id/add-to-sequence')
  @ApiOperation({ summary: 'Add lead primary contact to an Apollo sequence' })
  @ApiResponse({ status: 200, description: 'Contact added to sequence' })
  async addLeadToSequence(
    @Param('id') leadId: string,
    @Body() body: { sequenceId: string; createInApolloFirst?: boolean },
  ) {
    const { sequenceId, createInApolloFirst } = body;
    if (!sequenceId) throw new BadRequestException('sequenceId is required');

    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      include: { primaryContact: true, organization: true },
    });
    if (!lead) throw new NotFoundException('Lead not found');
    const contact = lead.primaryContact;
    if (!contact) throw new BadRequestException('Lead has no primary contact');
    if (!contact.email) throw new BadRequestException('Contact has no email');

    let apolloContactId: string | undefined = contact.apolloContactId ?? undefined;
    if (!apolloContactId && createInApolloFirst !== false) {
      const createRes = await this.apollo.createContact({
        first_name: contact.firstName,
        last_name: contact.lastName,
        email: contact.email,
        organization_name: lead.organization?.name ?? undefined,
        title: contact.title ?? undefined,
        run_dedupe: true,
      });
      apolloContactId = createRes.contact?.id;
      if (apolloContactId) {
        await this.prisma.contact.update({
          where: { id: contact.id },
          data: { apolloContactId },
        });
      }
    }

    if (!apolloContactId) {
      throw new BadRequestException(
        'Contact is not in Apollo. Create in Apollo first or set createInApolloFirst to true.',
      );
    }

    await this.apollo.addToSequence({ sequenceId, contactIds: [apolloContactId] });
    return { data: { added: true, apolloContactId } };
  }

  @Post('lead/:id/create-deal')
  @ApiOperation({ summary: 'Create Apollo deal from lead' })
  @ApiResponse({ status: 200, description: 'Deal created in Apollo' })
  async createDeal(
    @Param('id') leadId: string,
    @Body() body: { name?: string; amount?: number; opportunityStageId?: string },
  ) {
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      include: { organization: true },
    });
    if (!lead) throw new NotFoundException('Lead not found');

    let accountId: string | undefined;
    const org = lead.organization;
    if (org) {
      if (org.apolloOrganizationId) {
        accountId = org.apolloOrganizationId;
      } else {
        const domain = org.domain ?? org.name?.toLowerCase().replace(/\s+/g, '') + '.com';
        const searchRes = await this.apollo.searchOrganizations({ q_organization_domains_list: [domain], per_page: 1 });
        if (searchRes.organizations?.length) {
          accountId = searchRes.organizations[0].id;
          await this.prisma.organization.update({
            where: { id: org.id },
            data: { apolloOrganizationId: accountId },
          });
        } else {
          const createRes = await this.apollo.createAccount({ name: org.name, domain: org.domain ?? undefined });
          accountId = createRes.account?.id;
          if (accountId) {
            await this.prisma.organization.update({
              where: { id: org.id },
              data: { apolloOrganizationId: accountId },
            });
          }
        }
      }
    }

    const dealName = body.name ?? lead.title ?? 'Deal from CRM';
    const dealRes = await this.apollo.createDeal({
      name: dealName,
      account_id: accountId,
      amount: body.amount ?? (lead.amount ? Number(lead.amount) : undefined),
      opportunity_stage_id: body.opportunityStageId,
    });
    return { data: { created: true, opportunity: dealRes.opportunity } };
  }

  @Get('sequences')
  @ApiOperation({ summary: 'List Apollo sequences' })
  @ApiResponse({ status: 200, description: 'Sequences list' })
  async listSequences() {
    const res = await this.apollo.searchSequences();
    return { data: res.emailer_campaigns ?? [] };
  }

  @Get('deal-stages')
  @ApiOperation({ summary: 'List Apollo deal stages' })
  @ApiResponse({ status: 200, description: 'Deal stages list' })
  async listDealStages() {
    const res = await this.apollo.listDealStages();
    return { data: res.opportunity_stages ?? [] };
  }

  // --- Apollo API proxy endpoints (pass-through to Apollo) ---

  @Post('contacts/search')
  @ApiOperation({ summary: 'Search Apollo contacts' })
  async contactsSearch(@Body() body: Record<string, unknown>) {
    return this.apollo.searchContacts(body);
  }

  @Post('accounts/search')
  @ApiOperation({ summary: 'Search Apollo accounts' })
  async accountsSearch(@Body() body: Record<string, unknown>) {
    return this.apollo.searchAccounts(body);
  }

  @Post('contacts/create')
  @ApiOperation({ summary: 'Create Apollo contact' })
  async contactsCreate(@Body() body: Record<string, unknown>) {
    return this.apollo.createContact(body as Parameters<typeof this.apollo.createContact>[0]);
  }

  @Patch('contacts/:contactId')
  @ApiOperation({ summary: 'Update Apollo contact' })
  async contactsUpdate(@Param('contactId') contactId: string, @Body() body: Record<string, unknown>) {
    return this.apollo.updateContact(contactId, body);
  }

  @Post('contacts/bulk_create')
  @ApiOperation({ summary: 'Bulk create Apollo contacts' })
  async contactsBulkCreate(@Body() body: Record<string, unknown>) {
    return this.apollo.bulkCreateContacts(body);
  }

  @Post('contacts/bulk_update')
  @ApiOperation({ summary: 'Bulk update Apollo contacts' })
  async contactsBulkUpdate(@Body() body: Record<string, unknown>) {
    return this.apollo.bulkUpdateContacts(body);
  }

  @Post('accounts/bulk_create')
  @ApiOperation({ summary: 'Bulk create Apollo accounts' })
  async accountsBulkCreate(@Body() body: Record<string, unknown>) {
    return this.apollo.bulkCreateAccounts(body);
  }

  @Post('people/match')
  @ApiOperation({ summary: 'People enrichment (match)' })
  async peopleMatch(@Body() body: Record<string, unknown>) {
    const params = body as unknown as Parameters<typeof this.apollo.enrichPerson>[0];
    return this.apollo.enrichPerson(params);
  }

  @Post('people/bulk_match')
  @ApiOperation({ summary: 'Bulk people enrichment' })
  async peopleBulkMatch(
    @Body() body: Record<string, unknown>,
    @Query('reveal_personal_emails') revealPersonalEmails?: string,
    @Query('reveal_phone_number') revealPhoneNumber?: string,
    @Query('run_waterfall_email') runWaterfallEmail?: string,
    @Query('run_waterfall_phone') runWaterfallPhone?: string,
    @Query('webhook_url') webhookUrl?: string,
  ) {
    const query: Record<string, string | boolean> = {};
    if (revealPersonalEmails === 'true') query.reveal_personal_emails = true;
    if (revealPhoneNumber === 'true') query.reveal_phone_number = true;
    if (runWaterfallEmail === 'true') query.run_waterfall_email = true;
    if (runWaterfallPhone === 'true') query.run_waterfall_phone = true;
    if (webhookUrl) query.webhook_url = webhookUrl;
    return this.apollo.bulkEnrichPeople(body, Object.keys(query).length ? query : undefined);
  }

  @Get('people/show')
  @ApiOperation({ summary: 'Get person by ID' })
  async peopleShow(@Query('id') personId: string) {
    if (!personId) throw new BadRequestException('id query param is required');
    return this.apollo.showPerson(personId);
  }

  @Get('organizations/show')
  @ApiOperation({ summary: 'Get organization by ID' })
  async organizationsShow(@Query('id') organizationId: string) {
    if (!organizationId) throw new BadRequestException('id query param is required');
    return this.apollo.showOrganization(organizationId);
  }

  @Post('organizations/search')
  @ApiOperation({ summary: 'Search organizations in Apollo account' })
  async organizationsSearch(@Body() body: Record<string, unknown>) {
    return this.apollo.searchOrganizationsInAccount(body);
  }

  @Get('organizations/enrich')
  @ApiOperation({ summary: 'Enrich organization by domain' })
  async organizationsEnrich(@Query('domain') domain: string) {
    if (!domain) throw new BadRequestException('domain query param is required');
    return this.apollo.enrichOrganization(domain);
  }

  @Post('organizations/bulk_enrich')
  @ApiOperation({ summary: 'Bulk enrich organizations' })
  async organizationsBulkEnrich(@Body() body: { domains?: string[] }) {
    const domains = Array.isArray(body?.domains) ? body.domains : [];
    if (domains.length === 0) throw new BadRequestException('domains array is required');
    return this.apollo.bulkEnrichOrganizations(domains);
  }

  @Get('organizations/:organizationId/job_postings')
  @ApiOperation({ summary: 'Get organization job postings' })
  async organizationsJobPostings(
    @Param('organizationId') organizationId: string,
    @Query('page') page?: string,
    @Query('per_page') perPage?: string,
  ) {
    return this.apollo.getOrganizationJobPostings(
      organizationId,
      page ? parseInt(page, 10) : undefined,
      perPage ? parseInt(perPage, 10) : undefined,
    );
  }

  @Post('mixed_people/organization_top_people')
  @ApiOperation({ summary: 'Get top people at organization' })
  async mixedPeopleOrganizationTopPeople(@Body() body: Record<string, unknown>) {
    return this.apollo.getOrganizationTopPeople(body);
  }

  @Post('reports/sync_report')
  @ApiOperation({ summary: 'Get sync report' })
  async reportsSyncReport(@Body() body: Record<string, unknown>) {
    return this.apollo.getSyncReport(body);
  }

  @Post('fields/create')
  @ApiOperation({ summary: 'Create custom field' })
  async fieldsCreate(@Body() body: Record<string, unknown>) {
    return this.apollo.createField(body);
  }

  @Post('mixed_companies/search')
  @ApiOperation({ summary: 'Search companies in Apollo DB (mixed_companies)' })
  async mixedCompaniesSearch(@Body() body: Record<string, unknown>) {
    return this.apollo.mixedCompaniesSearch(body);
  }

  @Post('mixed_people/api_search')
  @ApiOperation({ summary: 'Search people in Apollo DB (mixed_people)' })
  async mixedPeopleApiSearch(@Body() body: Record<string, unknown>) {
    return this.apollo.mixedPeopleSearch(body);
  }
}
