import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { jwtVerify } from 'jose';
import type { Request } from 'express';
import { PrismaService } from '../database/prisma.service.js';
import { requiredEnv } from '../config/environment.js';
import type { UserRole } from './auth.types.js';

@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const [scheme, token] = (request.headers.authorization ?? '').split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !token) {
      throw new UnauthorizedException({ errorCode: 'ACCESS_TOKEN_REQUIRED', message: 'Cần đăng nhập để tiếp tục.' });
    }

    const authenticated = await this.authenticate(token);
    request.user = authenticated.user;
    return true;
  }

  // Shared transport-independent check; HTTP authorization/error semantics are unchanged.
  async authenticate(token: string) {
    let payload;
    try {
      ({ payload } = await jwtVerify(
        token,
        new TextEncoder().encode(requiredEnv('JWT_ACCESS_SECRET')),
        { algorithms: ['HS256'] },
      ));
    } catch {
      throw new UnauthorizedException({ errorCode: 'INVALID_ACCESS_TOKEN', message: 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn.' });
    }

    if (payload.tokenType !== 'access' || typeof payload.sub !== 'string') {
      throw new UnauthorizedException({ errorCode: 'INVALID_ACCESS_TOKEN', message: 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn.' });
    }
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, role: true, status: true, sessionVersion: true },
    });
    if (!user || user.status !== 'ACTIVE' || !this.isRole(user.role)
      || !Number.isSafeInteger(payload.sessionVersion) || payload.sessionVersion !== user.sessionVersion) {
      throw new UnauthorizedException({ errorCode: 'INVALID_ACCESS_TOKEN', message: 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn.' });
    }
    return { user: { id: user.id, role: user.role }, expiresAt: payload.exp };
  }

  private isRole(role: string): role is UserRole {
    return role === 'TENANT' || role === 'HOST' || role === 'ADMIN';
  }
}
