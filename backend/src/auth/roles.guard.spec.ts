import { describe, expect, it } from 'vitest';
import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard.js';
import { ROLES_KEY } from './roles.decorator.js';

describe('RolesGuard', () => {
  it('allows an allowed role and rejects a tenant on a host-only route', () => {
    const guard = new RolesGuard(new Reflector());
    const handler = () => undefined;
    Reflect.defineMetadata(ROLES_KEY, ['HOST', 'ADMIN'], handler);
    const context = (role: string) => ({
      getHandler: () => handler,
      getClass: () => class TestController {},
      switchToHttp: () => ({ getRequest: () => ({ user: { id: 'user-id', role } }) }),
    }) as unknown as ExecutionContext;

    expect(guard.canActivate(context('HOST'))).toBe(true);
    expect(() => guard.canActivate(context('TENANT'))).toThrow(ForbiddenException);
  });
});
