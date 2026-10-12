import { createHash } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';

export const BOOKING_IDEMPOTENCY_MS = 7 * 24 * 60 * 60 * 1000;

export function assertBookingIdempotencyKey(key:unknown):asserts key is string {
  if(typeof key!=='string' || key.length<1 || key.length>128 || /[^\x21-\x7e]/.test(key))
    throw new BadRequestException({errorCode:'INVALID_IDEMPOTENCY_KEY',message:'Idempotency-Key không hợp lệ.'});
}

// JSON keys are unordered, but array order and literal string contents are significant.
function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${Array.from(value, canonicalJson).join(',')}]`;
  if (typeof value === 'object' && value !== null
    && [Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
  }
  throw new BadRequestException({ errorCode: 'INVALID_IDEMPOTENCY_BODY', message: 'Nội dung yêu cầu không hợp lệ.' });
}

export function bookingRequestHash(body: unknown): string {
  return createHash('sha256').update(canonicalJson(body)).digest('hex');
}
