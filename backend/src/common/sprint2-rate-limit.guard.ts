import { type CanActivate, type ExecutionContext, HttpException, HttpStatus, Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { createHash } from 'node:crypto';
import { resolveClientIp } from '../auth/client-ip.js';
import { RedisService } from '../redis/redis.service.js';

// Technical anti-spam limits (03 DoD). Separate from the approved FREE listing quota.
export const sprint2RateLimits = { ip: 240, read: 120, write: 30, windowSeconds: 60 } as const;

async function enforce(redis: RedisService, scope: 'ip' | 'read' | 'write', identity: string) {
  const key = `sprint2:limit:${scope}:${createHash('sha256').update(identity).digest('hex')}`;
  let count: number;
  try {
    count = await redis.incrementWithTtl(key, sprint2RateLimits.windowSeconds);
  } catch {
    throw new ServiceUnavailableException({ errorCode: 'RATE_LIMIT_UNAVAILABLE', message: 'Chưa thể xử lý yêu cầu. Vui lòng thử lại sau.' });
  }
  if (count > sprint2RateLimits[scope]) {
    throw new HttpException({ errorCode: 'RATE_LIMITED', message: 'Bạn thao tác quá nhanh. Vui lòng thử lại sau.', retryAfter: sprint2RateLimits.windowSeconds }, HttpStatus.TOO_MANY_REQUESTS);
  }
}

@Injectable()
export class Sprint2IpRateLimitGuard implements CanActivate {
  constructor(private readonly redis: RedisService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    // A signed local BFF may have no edge IP. Keep a shared transport bucket in that case.
    // Unsigned forwarding headers never provide an identity or a way to reset the bucket.
    const ip = resolveClientIp(request) || request.socket?.remoteAddress || request.ip || 'unknown';
    await enforce(this.redis, 'ip', ip);
    return true;
  }
}

@Injectable()
export class Sprint2UserRateLimitGuard implements CanActivate {
  constructor(private readonly redis: RedisService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    if (!request.user?.id) throw new UnauthorizedException({ errorCode: 'ACCESS_TOKEN_REQUIRED', message: 'Cần đăng nhập để tiếp tục.' });
    // All write actions share one user bucket, even across different routes/property IDs/tokens.
    await enforce(this.redis, ['GET', 'HEAD'].includes(request.method) ? 'read' : 'write', request.user.id);
    return true;
  }
}
