import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { WebhookLeadsLogService } from './webhook-leads-log.service';

@Catch()
export class WebhookLeadsLogFilter implements ExceptionFilter {
  private readonly logger = new Logger(WebhookLeadsLogFilter.name);

  constructor(private readonly logService: WebhookLeadsLogService) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();

    const path = req.originalUrl ?? req.url ?? '';
    const isWebhookLeads = req.method === 'POST' && path.includes('webhooks/leads');
    if (!isWebhookLeads) {
      throw exception;
    }

    let statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let details: string[] | undefined;

    if (exception instanceof HttpException) {
      statusCode = exception.getStatus();
      const resp = exception.getResponse();
      if (typeof resp === 'object' && resp !== null) {
        const r = resp as { message?: string | string[]; error?: string };
        if (Array.isArray(r.message)) {
          message = 'Validation failed';
          details = r.message;
        } else if (typeof r.message === 'string') {
          message = r.message;
        }
      }
    } else if (exception instanceof Error) {
      message = exception.message;
    }

    this.logService.record({
      timestamp: new Date().toISOString(),
      statusCode,
      message,
      details,
    });
    this.logger.warn(`Webhook leads failed: ${statusCode} - ${message}${details?.length ? ` [${details.join('; ')}]` : ''}`);

    if (exception instanceof HttpException) {
      res.status(exception.getStatus()).json(exception.getResponse());
    } else {
      res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        statusCode: 500,
        error: 'Internal Server Error',
        message: exception instanceof Error ? exception.message : 'Unknown error',
      });
    }
  }
}
