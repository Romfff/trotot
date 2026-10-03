import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from './roles.decorator.js';
import type { UserRole } from './auth.types.js';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const allowed = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!allowed?.length) return true;

    const request = context.switchToHttp().getRequest<{ user?: { role?: string } }>();
    if (!request.user?.role || !allowed.includes(request.user.role as UserRole)) {
      throw new ForbiddenException({ errorCode: 'ROLE_FORBIDDEN', message: 'Tài khoản không có quyền thực hiện thao tác này.' });
    }
    return true;
  }
}
