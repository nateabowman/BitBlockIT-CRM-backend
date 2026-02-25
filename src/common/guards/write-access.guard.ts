import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtPayload } from '../decorators/current-user.decorator';

@Injectable()
export class WriteAccessGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const method = request.method?.toUpperCase();
    if (method === 'GET' || method === 'HEAD') return true;
    const user = request.user as JwtPayload | undefined;
    if (!user) return true;
    if (user.role === 'viewer') throw new ForbiddenException('Viewer role cannot perform this action');
    return true;
  }
}
