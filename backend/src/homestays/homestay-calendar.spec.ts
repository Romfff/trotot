import { describe,expect,it } from 'vitest';
import { calendarMonthDates,PUBLIC_CALENDAR_TTL_SECONDS } from './homestay-calendar.service.js';
import { calculateNightPrice } from '../bookings/booking-pricing.js';

describe('public calendar month and price', () => {
  it.each([['2026-02',28],['2028-02',29],['2026-04',30],['2026-12',31],['0001-02',28],['9999-12',31]])(
    'lists real calendar days in %s without UTC year rollover (%i)',(month,size) => {
      const dates = calendarMonthDates(month as string);
      expect(dates).toHaveLength(size as number); expect(dates[0]).toBe(`${month}-01`);
      expect(dates.at(-1)).toBe(`${month}-${size}`);
    });
  it.each(['0000-01','2026-00','2026-13','2026-1',' 2026-01','2026-01-01','10000-01'])('rejects invalid month %s',month => {
    expect(() => calendarMonthDates(month)).toThrow('Tháng xem lịch không hợp lệ.');
  });
  it('uses the canonical per-night price helper including the last supported calendar date',() => {
    const pricing = { basePricePerNight:'100.50',weekendPricePerNight:'110.49',customPrices:new Map([['2026-10-23','150.50']]) };
    expect(calculateNightPrice('2026-10-22',pricing).toString()).toBe('101');
    expect(calculateNightPrice('2026-10-23',pricing).toString()).toBe('151');
    expect(calculateNightPrice('2026-10-24',pricing).toString()).toBe('110');
    expect(calculateNightPrice('9999-12-31',pricing).isInteger()).toBe(true);
    expect(() => calculateNightPrice('2026-02-30',pricing)).toThrow();
  });
  it('keeps public inventory cache short; signed quotes have a separate lifetime and are never cached',() => {
    expect(PUBLIC_CALENDAR_TTL_SECONDS).toBe(15);
  });
});
