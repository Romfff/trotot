import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { SignJWT, jwtVerify, errors } from 'jose';
import { bookingRequestHash } from './booking-idempotency.js';
import type { CancellationSnapshot, calculateCancellationRefund } from './booking-refund.js';

export const REFUND_QUOTE_SECONDS = 120;
const typ = 'trotot-refund-quote+jwt';
type Refund = ReturnType<typeof calculateCancellationRefund>;
export type RefundQuoteBinding = { userId: string; bookingId: string; version: number };
function key() {
  const secret = process.env.HOMESTAY_QUOTE_SECRET?.trim();
  if (!secret || secret.length < 32 || [process.env.JWT_ACCESS_SECRET?.trim(), process.env.JWT_REFRESH_SECRET?.trim()].includes(secret))
    throw new ServiceUnavailableException({ errorCode: 'QUOTE_SIGNING_NOT_CONFIGURED', message: 'Chưa cấu hình chữ ký báo giá.' });
  return new TextEncoder().encode(secret);
}
function fingerprint(snapshot: CancellationSnapshot, refund: Refund) {
  return bookingRequestHash({ snapshot: Object.fromEntries(Object.entries(snapshot).map(([k,v]) => [k,String(v)])),
    refund: Object.fromEntries(Object.entries(refund).map(([k,v]) => [k,v instanceof Date ? v.toISOString() : String(v)])) });
}
export async function signRefundQuote(binding: RefundQuoteBinding, snapshot: CancellationSnapshot, refund: Refund, now: Date) {
  const issued = Math.floor(now.getTime()/1000), expires = issued + REFUND_QUOTE_SECONDS;
  const refundQuoteToken = await new SignJWT({ ...binding, schemaVersion: 1, fingerprint: fingerprint(snapshot,refund) })
    .setProtectedHeader({ alg: 'HS256',typ }).setIssuer('trotot').setAudience('refund-quote')
    .setIssuedAt(issued).setExpirationTime(expires).sign(key());
  return { bookingId: binding.bookingId, version: binding.version, policy: refund.policy, refundPercent: refund.percent,
    checkInAt: refund.checkInAt.toISOString(), refundQuoteToken, quoteExpiresAt: new Date(expires*1000).toISOString(),
    refund: { room: refund.refundBaseAmount.toNumber(), cleaning: refund.refundCleaningFee.toNumber(),
      service: refund.refundServiceFee.toNumber(), tax: refund.refundTaxAmount.toNumber(), total: refund.refundTotal.toNumber() },
    disclaimer: 'Đây là số tiền dự kiến hoàn. Hủy đơn không có nghĩa tiền đã được chuyển trả.' };
}
// Recompute from locked DB snapshot/current DB clock before a future cancellation mutation.
// Purpose-separated from hold quotes, auth tokens and HTTP Idempotency-Key.
export async function verifyRefundQuote(token: string, binding: RefundQuoteBinding, snapshot: CancellationSnapshot, refund: Refund, now: Date) {
  const secret = key();
  try {
    if (typeof token !== 'string' || token.length < 1 || token.length > 2048) throw new Error('Invalid token');
    const { payload } = await jwtVerify(token,secret,{ algorithms: ['HS256'],typ,issuer: 'trotot',audience: 'refund-quote',currentDate: now,
      requiredClaims: ['iat','exp','schemaVersion','bookingId','userId','version','fingerprint'] });
    if (payload.schemaVersion !== 1 || !Number.isSafeInteger(payload.iat) || !Number.isSafeInteger(payload.exp)
      || payload.exp! - payload.iat! !== REFUND_QUOTE_SECONDS || payload.iat! > Math.floor(now.getTime()/1000)
      || payload.userId !== binding.userId || payload.bookingId !== binding.bookingId || payload.version !== binding.version
      || typeof payload.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(payload.fingerprint)) throw new Error('Invalid binding');
    return { refundChanged: payload.fingerprint !== fingerprint(snapshot,refund) };
  } catch (error) {
    if (error instanceof errors.JWTExpired) throw new BadRequestException({ errorCode: 'REFUND_QUOTE_EXPIRED', message: 'Dự kiến hoàn tiền đã hết hạn. Vui lòng kiểm tra lại.' });
    throw new BadRequestException({ errorCode: 'INVALID_REFUND_QUOTE', message: 'Dự kiến hoàn tiền không hợp lệ. Vui lòng kiểm tra lại.' });
  }
}
