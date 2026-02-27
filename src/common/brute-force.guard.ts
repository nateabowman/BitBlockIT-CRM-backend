import { Injectable, CanActivate, ExecutionContext, TooManyRequestsException } from '@nestjs/common';

const loginAttempts = new Map<string, { count: number; lockedUntil?: number }>();
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes
const WINDOW_MS = 10 * 60 * 1000; // 10 minute window

@Injectable()
export class BruteForceGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const ip = request.headers['x-forwarded-for']?.split(',')[0]?.trim() ?? request.connection?.remoteAddress ?? 'unknown';
    const key = `login:${ip}`;
    const now = Date.now();

    const record = loginAttempts.get(key);
    if (record?.lockedUntil && record.lockedUntil > now) {
      const waitMinutes = Math.ceil((record.lockedUntil - now) / 60000);
      throw new TooManyRequestsException(`Too many failed login attempts. Try again in ${waitMinutes} minute${waitMinutes !== 1 ? 's' : ''}.`);
    }

    if (record?.lockedUntil && record.lockedUntil <= now) {
      loginAttempts.delete(key);
    }

    return true;
  }
}

export function recordFailedLogin(ip: string): void {
  const key = `login:${ip}`;
  const now = Date.now();
  const existing = loginAttempts.get(key) ?? { count: 0 };
  const newCount = existing.count + 1;
  if (newCount >= MAX_ATTEMPTS) {
    loginAttempts.set(key, { count: newCount, lockedUntil: now + LOCKOUT_MS });
  } else {
    loginAttempts.set(key, { count: newCount });
    setTimeout(() => loginAttempts.delete(key), WINDOW_MS);
  }
}

export function clearLoginAttempts(ip: string): void {
  loginAttempts.delete(`login:${ip}`);
}
