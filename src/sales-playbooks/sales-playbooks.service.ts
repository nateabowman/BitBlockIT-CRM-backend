import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type PlaybookPayload = {
  intro?: { lines?: string[]; variables?: string[] };
  painDiscovery?: { questions?: string[]; variables?: string[] };
  objectionHandling?: {
    layers?: { objection: string; response: string }[];
    variables?: string[];
  };
  decisionTree?: { ifX?: string; suggestY?: string }[];
  bant?: { budget?: string; authority?: string; need?: string; timeline?: string };
  closes?: {
    soft?: string;
    direct?: string;
    riskReversal?: string;
  };
  pacing?: { fiveMin?: string; fifteenMin?: string; thirtyMin?: string };
  framing?: { lossAversion?: string; riskExposure?: string; complianceLiability?: string };
  variables?: string[];
};

@Injectable()
export class SalesPlaybooksService {
  constructor(private prisma: PrismaService) {}

  async findAll(slug?: string) {
    const where: { isActive?: boolean; slug?: string } = { isActive: true };
    if (slug) where.slug = slug;
    return this.prisma.salesPlaybook.findMany({
      where,
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        payload: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async findOne(id: string) {
    const playbook = await this.prisma.salesPlaybook.findUnique({
      where: { id },
    });
    if (!playbook) throw new NotFoundException('Sales playbook not found');
    return playbook;
  }

  async getBySlug(slug: string) {
    const playbook = await this.prisma.salesPlaybook.findFirst({
      where: { slug, isActive: true },
    });
    if (!playbook) throw new NotFoundException('Sales playbook not found');
    return playbook;
  }

  /**
   * Resolve variable placeholders in payload copy with context.
   * Returns a new payload object with {{Var}} replaced.
   */
  async resolveVariables(
    playbookId: string,
    context: Record<string, string | undefined>,
  ): Promise<PlaybookPayload> {
    const playbook = await this.findOne(playbookId);
    const payload = playbook.payload as PlaybookPayload;
    return this.replaceInPayload(payload, context);
  }

  private replaceInPayload(
    obj: unknown,
    context: Record<string, string | undefined>,
  ): PlaybookPayload {
    if (obj === null || obj === undefined) return obj as unknown as PlaybookPayload;
    if (typeof obj === 'string') {
      return this.replaceString(obj, context) as unknown as PlaybookPayload;
    }
    if (Array.isArray(obj)) {
      return obj.map((item) => this.replaceInPayload(item, context)) as unknown as PlaybookPayload;
    }
    if (typeof obj === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(obj)) {
        out[k] = this.replaceInPayload(v, context);
      }
      return out as PlaybookPayload;
    }
    return obj as PlaybookPayload;
  }

  private replaceString(
    s: string,
    context: Record<string, string | undefined>,
  ): string {
    return s.replace(/\{\{(\w+)\}\}/g, (_, key) => {
      const value = context[key] ?? context[key.replace(/([A-Z])/g, (m: string) => m.toLowerCase())];
      return value ?? `{{${key}}}`;
    });
  }

  async create(data: {
    name: string;
    slug: string;
    description?: string;
    payload: PlaybookPayload;
    isActive?: boolean;
  }) {
    return this.prisma.salesPlaybook.create({
      data: {
        name: data.name,
        slug: data.slug,
        description: data.description,
        payload: data.payload as object,
        isActive: data.isActive ?? true,
      },
    });
  }

  async update(
    id: string,
    data: {
      name?: string;
      slug?: string;
      description?: string;
      payload?: PlaybookPayload;
      isActive?: boolean;
    },
  ) {
    await this.findOne(id);
    return this.prisma.salesPlaybook.update({
      where: { id },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.slug !== undefined && { slug: data.slug }),
        ...(data.description !== undefined && { description: data.description }),
        ...(data.payload !== undefined && { payload: data.payload as object }),
        ...(data.isActive !== undefined && { isActive: data.isActive }),
      },
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.salesPlaybook.delete({ where: { id } });
    return { message: 'Sales playbook deleted' };
  }
}
