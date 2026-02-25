import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';

export const REVENUE_INTELLIGENCE_HEADER = 'x-revenue-intelligence-key';

@Injectable()
export class RevenueIntelligenceKeyGuard implements CanActivate {
  constructor(private config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const key = this.config.get<string>('REVENUE_INTELLIGENCE_API_KEY');
    if (!key || !key.trim()) {
      throw new UnauthorizedException('Revenue Intelligence API is not configured');
    }
    const provided =
      request.headers[REVENUE_INTELLIGENCE_HEADER] ??
      request.headers['x-revenue-intelligence-key'];
    const providedStr = Array.isArray(provided) ? provided[0] : provided;
    if (providedStr !== key) {
      throw new UnauthorizedException('Invalid or missing Revenue Intelligence API key');
    }
    return true;
  }
}
