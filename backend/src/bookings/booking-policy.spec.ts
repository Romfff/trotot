import { describe, expect, it } from 'vitest';
import { validateStayPolicy } from './booking-dates.js';

const unit = {
  maxNights: 90, maxAdults: 2, maxChildren: 2, maxGuests: null,
  instantBook: true, sameDayBookingCutoff: new Date('1970-01-01T18:00:00Z'),
};
const input = { checkIn: '2026-10-04', checkOut: '2026-10-05', adults: 2, children: 0 };

describe('owner-approved per-unit stay policy', () => {
  it('allows today for Instant Book just before the Vietnam cutoff', () => {
    expect(validateStayPolicy(input, unit, new Date('2026-10-04T10:59:59.999Z')).totalNights).toBe(1);
  });
  it.each(['2026-10-04T11:00:00Z','2026-10-04T16:59:59Z'])('closes same-day Instant Book at/after cutoff %s', now => {
    expect(() => validateStayPolicy(input, unit, new Date(now))).toThrow(expect.objectContaining({ response: expect.objectContaining({ errorCode: 'SAME_DAY_BOOKING_CLOSED' }) }));
  });
  it('uses the room cutoff, including midnight and seconds, rather than a global 18:00', () => {
    const custom = { ...unit, sameDayBookingCutoff: new Date('1970-01-01T09:30:15Z') };
    expect(validateStayPolicy(input, custom, new Date('2026-10-04T02:30:14Z')).totalNights).toBe(1);
    expect(() => validateStayPolicy(input, custom, new Date('2026-10-04T02:30:15Z'))).toThrow();
    expect(() => validateStayPolicy(input, { ...unit, sameDayBookingCutoff: new Date('1970-01-01T00:00:00Z') }, new Date('2026-10-03T17:00:00Z'))).toThrow();
  });
  it('requires tomorrow for Request-to-Book even before the cutoff', () => {
    const now = new Date('2026-10-04T00:00:00Z');
    expect(() => validateStayPolicy(input, { ...unit, instantBook: false }, now)).toThrow(expect.objectContaining({ response: expect.objectContaining({ errorCode: 'INVALID_CHECK_IN_DATE' }) }));
    expect(validateStayPolicy({ ...input, checkIn: '2026-10-05', checkOut: '2026-10-06' }, { ...unit, instantBook: false }, now).totalNights).toBe(1);
  });
  it('rejects yesterday when UTC is still on yesterday but Vietnam has crossed midnight', () => {
    expect(() => validateStayPolicy(input, unit, new Date('2026-10-04T17:00:00Z'))).toThrow(expect.objectContaining({ response: expect.objectContaining({ errorCode: 'INVALID_CHECK_IN_DATE' }) }));
  });
  it('accepts exactly 90 nights but rejects 91, and obeys a smaller room limit', () => {
    const now = new Date('2026-10-03T00:00:00Z');
    expect(validateStayPolicy({ ...input, checkOut: '2027-01-02' }, unit, now).totalNights).toBe(90);
    expect(() => validateStayPolicy({ ...input, checkOut: '2027-01-03' }, unit, now)).toThrow(expect.objectContaining({ response: expect.objectContaining({ errorCode: 'STAY_TOO_LONG' }) }));
    expect(validateStayPolicy(input, { ...unit, maxNights: 1 }, now).totalNights).toBe(1);
    expect(() => validateStayPolicy({ ...input, checkOut: '2026-10-06' }, { ...unit, maxNights: 1 }, now)).toThrow();
  });
  it('enforces an optional combined capacity independently of adult/child capacities', () => {
    const now = new Date('2026-10-03T00:00:00Z');
    expect(validateStayPolicy({ ...input, children: 2 }, unit, now)).toBeDefined();
    expect(() => validateStayPolicy({ ...input, children: 2 }, { ...unit, maxGuests: 3 }, now)).toThrow(expect.objectContaining({ response: expect.objectContaining({ errorCode: 'INVALID_CAPACITY' }) }));
    expect(validateStayPolicy({ ...input, children: 1 }, { ...unit, maxGuests: 3 }, now)).toBeDefined();
  });
  it.each([{ adults: 0 }, { adults: 3 }, { adults: 1.5 }, { adults: NaN }, { children: -1 }, { children: 3 }, { children: 0.5 }])('rejects invalid guests %j', guests => {
    expect(() => validateStayPolicy({ ...input, ...guests }, unit, new Date('2026-10-03T00:00:00Z'))).toThrow(expect.objectContaining({ response: expect.objectContaining({ errorCode: 'INVALID_CAPACITY' }) }));
  });
});
