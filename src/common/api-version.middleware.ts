import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

const API_VERSION = '1.0.0';
const SUNSET_DATE = '2026-12-31';

const DEPRECATED_ENDPOINTS: Record<string, { sunset: string; replacement?: string }> = {};

@Injectable()
export class ApiVersionMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    res.setHeader('API-Version', API_VERSION);
    const deprecated = DEPRECATED_ENDPOINTS[req.path];
    if (deprecated) {
      res.setHeader('Deprecation', `date="${deprecated.sunset}"`);
      res.setHeader('Sunset', deprecated.sunset);
      if (deprecated.replacement) {
        res.setHeader('Link', `<${deprecated.replacement}>; rel="successor-version"`);
      }
    }
    next();
  }
}
