import { Injectable } from '@nestjs/common';
import { register, Counter, Histogram } from 'prom-client';

@Injectable()
export class MetricsService {
  private readonly requestTotal: Counter<string>;
  private readonly requestDuration: Histogram<string>;

  constructor() {
    this.requestTotal = new Counter({
      name: 'http_requests_total',
      help: 'Total HTTP requests',
      labelNames: ['method', 'path', 'status'],
      registers: [register],
    });
    this.requestDuration = new Histogram({
      name: 'http_request_duration_seconds',
      help: 'HTTP request duration in seconds',
      labelNames: ['method', 'path'],
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
      registers: [register],
    });
  }

  recordRequest(method: string, path: string, statusCode: number, durationSeconds: number): void {
    const pathNorm = this.normalizePath(path);
    this.requestTotal.inc({ method, path: pathNorm, status: String(statusCode) });
    this.requestDuration.observe({ method, path: pathNorm }, durationSeconds);
  }

  async getMetrics(): Promise<string> {
    return register.metrics();
  }

  getContentType(): string {
    return register.contentType;
  }

  private normalizePath(path: string): string {
    const segments = path.split('?')[0].split('/').filter(Boolean);
    const normalized = segments.map((seg) => {
      if (/^[a-z0-9]{20,}$/i.test(seg) || /^[0-9a-f-]{36}$/i.test(seg)) return ':id';
      return seg;
    });
    return '/' + normalized.join('/');
  }
}
