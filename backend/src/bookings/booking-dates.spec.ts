import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { parseStay, stayDates, staysOverlap, vietnamToday } from './booking-dates.js';

describe('booking calendar dates — approved half-open range / Vietnam timezone', () => {
  it.each([
    ['2028-02-28', '2028-03-01', 2],
    ['2027-02-28', '2027-03-01', 1],
    ['2026-12-31', '2027-01-02', 2],
    ['0099-12-31', '0100-01-01', 1],
  ])('counts nights for %s → %s', (checkIn, checkOut, totalNights) => {
    expect(parseStay(checkIn, checkOut)).toEqual({ checkIn, checkOut, totalNights });
    const dates = [...stayDates(checkIn, checkOut)];
    expect(dates).toHaveLength(totalNights);
    expect(dates[0]).toBe(checkIn);
    expect(dates).not.toContain(checkOut);
  });

  it.each([
    ['2027-02-29', '2027-03-02'],
    ['2028-02-30', '2028-03-02'],
    ['2026-04-31', '2026-05-02'],
    ['2026-13-01', '2027-01-02'],
    ['2026-01-00', '2026-01-02'],
    ['0000-01-01', '0001-01-01'],
    ['2026-1-01', '2026-01-02'],
    ['2026-01-01T00:00:00Z', '2026-01-02'],
    ['2026-01-01 ', '2026-01-02'],
    ['2026-01-02', '2026-01-02'],
    ['2026-01-03', '2026-01-02'],
    ['2026-01-01', '2026-02-30'],
  ])('rejects invalid range %s → %s', (checkIn, checkOut) => {
    expect(() => parseStay(checkIn, checkOut)).toThrow(BadRequestException);
    expect(() => [...stayDates(checkIn, checkOut)]).toThrow(BadRequestException);
    try { parseStay(checkIn, checkOut); } catch (error) {
      expect((error as BadRequestException).getResponse()).toMatchObject({ errorCode: 'INVALID_DATE_RANGE' });
    }
  });

  it.each([
    ['2026-10-20', '2026-10-23', true],
    ['2026-10-19', '2026-10-21', true],
    ['2026-10-22', '2026-10-24', true],
    ['2026-10-21', '2026-10-22', true],
    ['2026-10-19', '2026-10-24', true],
    ['2026-10-18', '2026-10-20', false],
    ['2026-10-23', '2026-10-24', false],
  ])('checks overlap with %s → %s', (checkIn, checkOut, expected) => {
    const first = { checkIn: '2026-10-20', checkOut: '2026-10-23' };
    const second = { checkIn, checkOut };
    expect(staysOverlap(first, second)).toBe(expected);
    expect(staysOverlap(second, first)).toBe(expected);
  });

  it('does not compare invalid dates as strings', () => {
    expect(() => staysOverlap(
      { checkIn: '2026-10-20', checkOut: '2026-10-23' },
      { checkIn: '2026-02-30', checkOut: '2026-03-02' },
    )).toThrow(BadRequestException);
  });

  it('enumerates leap day but excludes checkout', () => {
    expect([...stayDates('2028-02-28', '2028-03-01')]).toEqual(['2028-02-28', '2028-02-29']);
  });

  it('uses midnight in Vietnam rather than UTC or the machine timezone', () => {
    expect(vietnamToday(new Date('2026-12-31T16:59:59.999Z'))).toBe('2026-12-31');
    expect(vietnamToday(new Date('2026-12-31T17:00:00.000Z'))).toBe('2027-01-01');
  });
});
