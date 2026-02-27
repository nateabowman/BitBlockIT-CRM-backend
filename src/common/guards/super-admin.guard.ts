import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { JwtPayload } from '../decorators/current-user.decorator';

const SUPER_ADMIN_ROLES = ['super-admin', 'admin'] as const;

@Injectable()
export class SuperAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user as JwtPayload | undefined;
    if (!user?.role) throw new ForbiddenException('Authentication required');
    if (!SUPER_ADMIN_ROLES.includes(user.role as typeof SUPER_ADMIN_ROLES[number])) {
      throw new ForbiddenException('Super-admin role required');
    }
    return true;
  }
}
