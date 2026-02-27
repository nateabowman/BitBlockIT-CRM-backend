import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { JwtPayload } from '../decorators/current-user.decorator';

const READ_ONLY_ROLES = ['read-only', 'viewer'] as const;

@Injectable()
export class ReadOnlyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const method = request.method?.toUpperCase();
    if (method === 'GET' || method === 'HEAD') return true;
    const user = request.user as JwtPayload | undefined;
    if (!user) return true;
    if (READ_ONLY_ROLES.includes(user.role as typeof READ_ONLY_ROLES[number])) {
      throw new ForbiddenException('Read-only role cannot perform write operations');
    }
    return true;
  }
}
