import { createParamDecorator, ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import type { Request } from 'express';

export function resolveClientIp(request: Request): string | undefined {
  const signature = request.get('x-trotot-proxy-signature');
  // Direct API callers never get to choose an IP via ordinary forwarding headers.
  if (!signature) return request.ip;
  const secret = process.env.BFF_PROXY_SECRET;
  const timestamp = request.get('x-trotot-proxy-timestamp') || '';
  const ip = request.get('x-trotot-client-ip') || '';
  if (!secret || secret.length < 32 || !/^\d{13}$/.test(timestamp)
    || Math.abs(Date.now() - Number(timestamp)) > 30_000 || (ip && !isIP(ip))
    || !/^[a-f0-9]{64}$/.test(signature)) {
    throw new ForbiddenException({ errorCode: 'INVALID_PROXY_CONTEXT', message: 'Nguồn chuyển tiếp không hợp lệ.' });
  }
  const expected = createHmac('sha256', secret)
    .update(`${timestamp}\n${request.method}\n${request.path}\n${ip}`).digest();
  if (!timingSafeEqual(Buffer.from(signature, 'hex'), expected)) {
    throw new ForbiddenException({ errorCode: 'INVALID_PROXY_CONTEXT', message: 'Nguồn chuyển tiếp không hợp lệ.' });
  }
  // With no trusted edge IP (local), account/OTP/session limits still apply.
  return ip || undefined;
}

export const ClientIp = createParamDecorator((_data: unknown, context: ExecutionContext) =>
  resolveClientIp(context.switchToHttp().getRequest<Request>()));
