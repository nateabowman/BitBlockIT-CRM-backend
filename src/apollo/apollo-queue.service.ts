import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker, Job } from 'bullmq';
import { ApolloService } from './apollo.service';
import { PrismaService } from '../prisma/prisma.service';
import { LoggerService } from '../common/logger.service';

const QUEUE_NAME = 'apollo-enrich';

const getConnection = (redisUrl: string) => {
  try {
    const u = new URL(redisUrl);
    return {
      host: u.hostname,
      port: u.port ? parseInt(u.port, 10) : 6379,
      password: u.password || undefined,
    };
  } catch {
    return { host: 'localhost', port: 6379 };
  }
};

export interface ApolloEnrichJobData {
  leadId: string;
}

@Injectable()
export class ApolloQueueService implements OnModuleInit, OnModuleDestroy {
  private queue!: Queue;
  private worker!: Worker;

  constructor(
    private config: ConfigService,
    private apollo: ApolloService,
    private prisma: PrismaService,
    private logger: LoggerService,
  ) {}

  onModuleInit() {
    const redisUrl = this.config.get('REDIS_URL', 'redis://localhost:6379');
    const connection = getConnection(redisUrl);

    this.queue = new Queue(QUEUE_NAME, {
      connection,
      defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 3000 } },
    });

    this.worker = new Worker(
      QUEUE_NAME,
      async (job: Job<ApolloEnrichJobData>) => this.processJob(job),
      { connection, concurrency: 2 },
    );

    this.worker.on('failed', (job, err) => {
      this.logger.warn(`Apollo enrich job ${job?.id} failed: ${err?.message}`, 'ApolloQueueService');
    });
  }

  async onModuleDestroy() {
    await this.worker?.close();
    await this.queue?.close();
  }

  async addEnrichJob(leadId: string): Promise<void> {
    await this.queue.add('enrich', { leadId });
    this.logger.log(`Queued Apollo enrich for lead ${leadId}`, 'ApolloQueueService');
  }

  private async processJob(job: Job<ApolloEnrichJobData>): Promise<void> {
    const { leadId } = job.data;
    try {
      await this.doEnrich(leadId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('APOLLO_API_KEY') && msg.includes('not configured')) {
        this.logger.warn('Apollo enrich skipped: APOLLO_API_KEY not configured', 'ApolloQueueService');
        return;
      }
      throw err;
    }
  }

  private async doEnrich(leadId: string): Promise<void> {
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      include: { primaryContact: true, organization: true },
    });
    if (!lead || !lead.primaryContact?.email) return;

    const contact = lead.primaryContact;
    const org = lead.organization;

    const personRes = await this.apollo.enrichPerson({
      email: contact.email,
      organization_name: org?.name ?? undefined,
    });
    if (!personRes.person) return;

    const person = personRes.person;
    const cf = { ...((contact.customFields as Record<string, unknown>) || {}) };
    if (person.linkedin_url) cf.linkedin_url = person.linkedin_url;

    await this.prisma.contact.update({
      where: { id: contact.id },
      data: {
        ...(person.title ? { title: person.title } : {}),
        ...(person.id ? { apolloPersonId: person.id } : {}),
        ...(Object.keys(cf).length > 0 ? { customFields: cf as object } : {}),
      },
    });

    if (org && person.organization) {
      const ao = person.organization;
      await this.prisma.organization.update({
        where: { id: org.id },
        data: {
          ...(ao.industry ? { industry: ao.industry } : {}),
          ...(ao.primary_domain || ao.website_url ? { domain: ao.primary_domain ?? ao.website_url ?? undefined } : {}),
          ...(ao.id ? { apolloOrganizationId: ao.id } : {}),
        },
      });
    }

    this.logger.log(`Apollo enriched lead ${leadId}`, 'ApolloQueueService');
  }
}

