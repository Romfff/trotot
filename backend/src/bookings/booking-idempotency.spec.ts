import { describe, expect, it } from 'vitest';
import { assertBookingIdempotencyKey,bookingRequestHash, BOOKING_IDEMPOTENCY_MS } from './booking-idempotency.js';

describe('booking request identity', () => {
  it.each(['!', 'X'.repeat(128), 'key:123/valid'])('accepts exact booking key bounds %s',key=>expect(()=>assertBookingIdempotencyKey(key)).not.toThrow());
  it.each([undefined,null,12,'','X'.repeat(129),' key','key ','key\n','key\u007f','khóa'])('rejects missing, non-ASCII, whitespace and oversized keys (%j)',key=>expect(()=>assertBookingIdempotencyKey(key)).toThrow('Idempotency-Key không hợp lệ.'));
  it('uses sha256 and ignores only JSON object-key ordering, including nested objects', () => {
    const a = { unitId: 'fixture', guests: { children: 0, adults: 2 }, dates: ['2026-10-22','2026-10-26'] };
    const b = { dates: ['2026-10-22','2026-10-26'], guests: { adults: 2, children: 0 }, unitId: 'fixture' };
    expect(bookingRequestHash(a)).toMatch(/^[a-f0-9]{64}$/);
    expect(bookingRequestHash(a)).toBe(bookingRequestHash(b));
  });
  it('preserves array order, case, whitespace, null and numeric/string distinctions', () => {
    const values = [{ names: ['A','B'] }, { names: ['B','A'] }, { name: 'A' }, { name: 'a' },
      { name: ' A' }, { name: null }, {}, { numAdults: 2 }, { numAdults: '2' }];
    expect(new Set(values.map(bookingRequestHash)).size).toBe(values.length);
  });
  it.each([NaN, Infinity, -Infinity, undefined, 1n, new Date(), new Map(), Array.from({ length: 1 }), { nested: undefined }].map(value => [value]))(
    'rejects non-JSON request data rather than hashing it as null or omitted (%s)', value => {
      expect(() => bookingRequestHash(value)).toThrow('Nội dung yêu cầu không hợp lệ.');
    });
  it('treats special object keys as data without changing prototypes', () => {
    expect(bookingRequestHash(JSON.parse('{"__proto__":{"value":1},"constructor":"literal"}')))
      .toBe(bookingRequestHash(JSON.parse('{"constructor":"literal","__proto__":{"value":1}}')));
    expect(bookingRequestHash(Object.assign(Object.create(null), { a: 1 }))).toBe(bookingRequestHash({ a: 1 }));
  });
  it('retains a response for exactly seven 24-hour days', () => {
    expect(BOOKING_IDEMPOTENCY_MS).toBe(604800000);
  });
});
