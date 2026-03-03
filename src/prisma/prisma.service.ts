import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const connectionTimeoutSeconds = 10;
function buildConnectionString(): string {
  const url = process.env.DATABASE_URL ?? '';
  if (!url) return url;
  if (url.includes('connect_timeout=')) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}connect_timeout=${connectionTimeoutSeconds}`;
}

/** Redacted host (and optionally port) for logging; no credentials. */
function redactedDatabaseHint(): string {
  const url = process.env.DATABASE_URL ?? '';
  if (!url) return '(no DATABASE_URL)';
  try {
    const u = new URL(url.replace(/^postgresql:\/\//, 'https://'));
    const port = u.port && u.port !== '5432' ? `:${u.port}` : '';
    return `${u.hostname}${port}`;
  } catch {
    return '(invalid URL)';
  }
}

const connectionString = buildConnectionString();
const adapter = new PrismaPg({
  connectionString,
  ssl: connectionString.includes('sslmode=require') || connectionString.includes('sslmode=no-verify')
    ? { rejectUnauthorized: false }
    : undefined,
});

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({ adapter });
  }
  async onModuleInit() {
    const hint = redactedDatabaseHint();
    this.logger.log(`Prisma: connecting to database (${hint})`);
    try {
      await this.$connect();
      this.logger.log('Prisma: connected successfully');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const code = err && typeof (err as NodeJS.ErrnoException).code === 'string' ? (err as NodeJS.ErrnoException).code : undefined;
      const stack = err instanceof Error ? err.stack : undefined;
      this.logger.error(`Prisma: connection failed — ${msg}${code ? ` [${code}]` : ''}${stack ? ` ${stack}` : ''}`, stack, PrismaService.name);
      throw err;
    }
  }
  async onModuleDestroy() {
    await this.$disconnect();
  }
}
