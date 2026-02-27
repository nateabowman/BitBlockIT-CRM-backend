import { Injectable, NestInterceptor, ExecutionContext, CallHandler, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, of } from 'rxjs';
import { tap } from 'rxjs/operators';

export const CACHE_TTL_KEY = 'cache_ttl';
export const CacheTTL = (ttlMs: number) => SetMetadata(CACHE_TTL_KEY, ttlMs);

const cache = new Map<string, { data: unknown; expiresAt: number }>();

@Injectable()
export class InMemoryCacheInterceptor implements NestInterceptor {
  constructor(private reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest();
    if (request.method !== 'GET') return next.handle();

    const ttl = this.reflector.getAllAndOverride<number>(CACHE_TTL_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!ttl) return next.handle();

    const userId = request.user?.sub ?? 'anon';
    const cacheKey = `${userId}:${request.url}`;
    const cached = cache.get(cacheKey);

    if (cached && cached.expiresAt > Date.now()) {
      return of(cached.data);
    }

    return next.handle().pipe(
      tap((data) => {
        cache.set(cacheKey, { data, expiresAt: Date.now() + ttl });
        // Evict oldest entries when cache grows large
        if (cache.size > 1000) {
          const oldest = cache.keys().next().value;
          if (oldest) cache.delete(oldest);
        }
      }),
    );
  }
}

/** Invalidate all cache entries for a user or pattern */
export function invalidateCache(pattern: string) {
  for (const key of cache.keys()) {
    if (key.includes(pattern)) cache.delete(key);
  }
}
