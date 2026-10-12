import { type CanActivate, type ExecutionContext, HttpException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { Request } from 'express';
import { createHmac } from 'node:crypto';
import { AccessTokenGuard } from '../auth/access-token.guard.js';
import { resolveClientIp } from '../auth/client-ip.js';
import { PrismaService } from '../database/prisma.service.js';
import { positiveIntegerEnv, requiredEnv } from '../config/environment.js';
import { RedisService } from '../redis/redis.service.js';

@Injectable()
export class OptionalContactTokenGuard extends AccessTokenGuard {
  constructor(prisma: PrismaService) { super(prisma); }
  override canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    return request.headers.authorization === undefined ? Promise.resolve(true) : super.canActivate(context);
  }
}

@Injectable()
export class ListingContactRateLimitGuard implements CanActivate {
  private readonly ipLimit = positiveIntegerEnv('LISTING_CONTACT_IP_LIMIT_PER_MINUTE', 10);
  private readonly userLimit = positiveIntegerEnv('LISTING_CONTACT_USER_LIMIT_PER_MINUTE', 5);
  private readonly secret = requiredEnv('JWT_ACCESS_SECRET');
  constructor(private readonly redis: RedisService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const ip = resolveClientIp(request) || request.socket?.remoteAddress || request.ip || 'unknown';
    const buckets: [string, string, number][] = [['ip', ip, this.ipLimit]];
    if (request.user?.id) buckets.push(['user', request.user.id, this.userLimit]);
    for (const [scope, identity, limit] of buckets) {
      const digest = createHmac('sha256', this.secret).update(`${scope}:${identity}`).digest('hex');
      const key = `sprint2:limit:contact:${scope}:${digest}`;
      let count: number;
      try { count = await this.redis.incrementWithTtl(key, 60); }
      catch { throw new ServiceUnavailableException({ errorCode: 'RATE_LIMIT_UNAVAILABLE', message: 'Chưa thể xem số liên hệ. Vui lòng thử lại sau.' }); }
      if (count > limit) throw new HttpException({ errorCode: 'RATE_LIMITED', message: 'Bạn xem số liên hệ quá nhiều lần. Vui lòng chờ một phút rồi thử lại.', retryAfter: 60 }, 429);
    }
    return true;
  }
}
