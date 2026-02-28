// Import Sentry first (must run before any other modules)
import './instrument';

import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import * as express from 'express';
import * as compression from 'compression';
import { AppModule } from './app.module';
import { LoggerService } from './common/logger.service';
import { MetricsService } from './common/metrics.service';

async function bootstrap() {
  const isProd = process.env.NODE_ENV === 'production';
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret || (isProd && jwtSecret.length < 32)) {
    throw new Error('JWT_SECRET must be set (min 32 chars in production). Generate with: openssl rand -base64 32');
  }

  const app = await NestFactory.create(AppModule);
  // Twilio webhooks: capture raw body for signature validation (must run before global body parser)
  const twilioVerify = (req: express.Request, _res: express.Response, buf: Buffer) => {
    (req as express.Request & { rawBody?: Buffer }).rawBody = buf;
  };
  app.use('/api/v1/twilio/voice/status', express.urlencoded({ verify: twilioVerify, extended: false }));
  app.use('/api/v1/twilio/voice/incoming', express.urlencoded({ verify: twilioVerify, extended: false }));
  app.use('/api/v1/twilio/voice/connect', express.urlencoded({ extended: false })); // POST from Twilio (no signature validation)
  app.use('/api/v1/twilio/sms/incoming', express.urlencoded({ verify: twilioVerify, extended: false }));
  app.use(compression({ threshold: 1024 }));
  app.use(helmet({
    contentSecurityPolicy: isProd ? undefined : false,
    crossOriginEmbedderPolicy: false,
  }));
  app.useLogger(app.get(LoggerService));
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );
  const allowedOrigins = (process.env.FRONTEND_URL || process.env.ALLOWED_ORIGINS || 'http://localhost:3000')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  const defaultOrigins = ['http://localhost:3000', 'https://crm.bitblockit.com', 'https://bit-block-it-crm.vercel.app'];
  const origins = [...new Set([...defaultOrigins, ...allowedOrigins])];
  app.enableCors({
    origin: (origin, cb) => {
      // Allow requests with no origin (e.g. same-origin, Postman, server-to-server)
      if (!origin) {
        cb(null, true);
        return;
      }
      if (origins.includes(origin)) {
        // Return the actual origin so Access-Control-Allow-Origin is set correctly (required for credentials)
        cb(null, origin);
        return;
      }
      cb(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Requested-With',
      'Accept',
      'Origin',
      'Accept-Language',
    ],
    exposedHeaders: ['Content-Type', 'Authorization'],
    optionsSuccessStatus: 204,
    preflightContinue: false,
  });

  if (!isProd) {
    const config = new DocumentBuilder()
      .setTitle('BitBlockIT CRM API')
      .setDescription('REST API for BitBlockIT CRM. Use **Authorize** to set a JWT bearer token for authenticated endpoints.')
      .setVersion('1.0')
      .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT', name: 'Authorization', in: 'header' })
      .addTag('auth', 'Login, register, password reset')
      .addTag('leads', 'Lead CRUD and pipeline')
      .addTag('organizations', 'Organizations')
      .addTag('contacts', 'Contacts')
      .addTag('pipelines', 'Pipelines and stages')
      .addTag('activities', 'Activities and tasks')
      .addTag('reports', 'Analytics and reports')
      .addTag('webhooks', 'Inbound (Zapier) and outbound webhook subscriptions')
      .addTag('apollo', 'Apollo.io enrichment, search, sequences, deals')
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api-docs', app, document, {
      swaggerOptions: { persistAuthorization: true },
    });
  }

  const http = app.getHttpAdapter().getInstance();
  http.get('/health', async (_req: unknown, res: { status: (n: number) => { send: (o: object) => void }; send: (o: object) => void }) => {
    const dbOk = await app.get('PrismaService')?.prisma?.$queryRaw`SELECT 1`.then(() => true).catch(() => false) ?? true;
    res.status(200).send({
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: Math.floor(process.uptime()),
      db: dbOk ? 'connected' : 'error',
      memory: Math.round(process.memoryUsage().rss / 1024 / 1024) + 'MB',
      version: process.env.npm_package_version ?? '1.0.0',
    });
  });

  const metricsSecret = process.env.METRICS_SECRET;
  const metricsService = app.get(MetricsService);
  http.get('/metrics', async (req: { headers?: { 'x-metrics-token'?: string; authorization?: string } }, res: { setHeader: (k: string, v: string) => void; status: (n: number) => { send: (s: string) => void }; send: (s: string) => void }) => {
    if (metricsSecret) {
      const token = req.headers?.['x-metrics-token'] ?? req.headers?.authorization?.replace(/^Bearer\s+/i, '').trim();
      if (token !== metricsSecret) {
        res.status(401).send('Unauthorized');
        return;
      }
    }
    res.setHeader('Content-Type', metricsService.getContentType());
    res.status(200).send(await metricsService.getMetrics());
  });

  const port = process.env.PORT || 3001;
  await app.listen(port);
  const logger = app.get(LoggerService);
  logger.log(`Backend running at http://localhost:${port}/api/v1`, 'Bootstrap');
  if (!isProd) logger.log(`API docs at http://localhost:${port}/api-docs`, 'Bootstrap');
  logger.log(`Health check at http://localhost:${port}/health`, 'Bootstrap');
  logger.log(`Metrics at http://localhost:${port}/metrics${metricsSecret ? ' (requires x-metrics-token)' : ''}`, 'Bootstrap');
}
bootstrap();
