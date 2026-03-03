import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
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

const connectionString = buildConnectionString();
const adapter = new PrismaPg({
  connectionString,
  ssl: connectionString.includes('sslmode=require') || connectionString.includes('sslmode=no-verify')
    ? { rejectUnauthorized: false }
    : undefined,
});

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super({ adapter });
  }
  async onModuleInit() {
    await this.$connect();
  }
  async onModuleDestroy() {
    await this.$disconnect();
  }
}
