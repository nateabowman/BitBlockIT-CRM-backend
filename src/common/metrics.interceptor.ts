import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Request } from 'express';
import { MetricsService } from './metrics.service';

@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  constructor(private metrics: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse();
    const start = Date.now();
    const method = req.method;
    const path = (req.originalUrl ?? req.url ?? '').split('?')[0] || req.path || '/';

    return next.handle().pipe(
      tap({
        next: () => {
          const duration = (Date.now() - start) / 1000;
          this.metrics.recordRequest(method, path, res.statusCode, duration);
        },
        error: (err: { status?: number }) => {
          const status = err?.status && typeof err.status === 'number' ? err.status : 500;
          const duration = (Date.now() - start) / 1000;
          this.metrics.recordRequest(method, path, status, duration);
        },
      }),
    );
  }
}
