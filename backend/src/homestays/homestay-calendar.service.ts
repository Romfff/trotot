import { BadRequestException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';
import { RedisService } from '../redis/redis.service.js';
import { validateGuestCapacity,validateStayPolicy } from '../bookings/booking-dates.js';
import { calculateNightPrice } from '../bookings/booking-pricing.js';
import { bookingRequestHash } from '../bookings/booking-idempotency.js';
import { publishedHomestayUnit } from './homestay-availability.service.js';

export const PUBLIC_CALENDAR_TTL_SECONDS = 15;
type CachedDay = { date:string;inventoryAvailable:boolean;price:number };

export function calendarMonthDates(month: string): string[] {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || month.startsWith('0000-')) {
    throw new BadRequestException({ errorCode:'INVALID_CALENDAR_MONTH',message:'Tháng xem lịch không hợp lệ.' });
  }
  const start = new Date(`${month}-01T00:00:00Z`), dates:string[] = [];
  for (let date = start; date.toISOString().slice(0,7) === month; date = new Date(date.getTime()+86400000)) {
    dates.push(date.toISOString().slice(0,10));
  }
  return dates;
}

function cachedDays(raw:string|null,dates:string[]):CachedDay[]|null {
  if (!raw) return null;
  try {
    const rows:unknown = JSON.parse(raw);
    if (!Array.isArray(rows) || rows.length !== dates.length || !rows.every((row,index) => row && typeof row === 'object'
      && row.date === dates[index] && typeof row.inventoryAvailable === 'boolean' && Number.isSafeInteger(row.price) && row.price >= 0)) return null;
    return rows as CachedDay[];
  } catch { return null; }
}

@Injectable()
export class HomestayCalendarService {
  constructor(private readonly prisma:PrismaService,private readonly redis:RedisService) {}

  // Call after a committed hold/cancel/block/expiry write. Generation prevents late cache fills reviving stale data.
  // Hold/cancel/calendar writes and the expiry worker invalidate after their DB commit.
  async invalidate(unitId:string):Promise<void> {
    try { await this.redis.client.incr(`homestay:calendar:generation:${unitId}`); }
    catch { throw new ServiceUnavailableException({ errorCode:'CALENDAR_CACHE_UNAVAILABLE',message:'Chưa thể cập nhật lịch phòng.' }); }
  }

  async read(unitId:string,input:{ month:string;adults:number;children:number }) {
    const dates = calendarMonthDates(input.month);
    const generationKey = `homestay:calendar:generation:${unitId}`;
    let generation:string;
    try { generation = await this.redis.client.get(generationKey) ?? '0'; }
    catch { throw new ServiceUnavailableException({ errorCode:'CALENDAR_CACHE_UNAVAILABLE',message:'Chưa thể tải lịch phòng.' }); }
    return this.prisma.$transaction(async tx => {
      const [{ now }] = await tx.$queryRaw<{ now:Date }[]>`SELECT clock_timestamp() AS now`;
      const unit = await tx.homestayUnit.findFirst({ where:{ ...publishedHomestayUnit,id:unitId } });
      if (!unit) throw new NotFoundException({ errorCode:'UNIT_NOT_FOUND',message:'Không tìm thấy phòng.' });
      validateGuestCapacity(input,unit);
      const configHash = bookingRequestHash({ base:unit.basePricePerNight.toString(),weekend:unit.weekendPricePerNight?.toString() ?? null });
      const cacheKey = `homestay:calendar:${unitId}:${input.month}:${generation}:${configHash}`;
      let rows:CachedDay[]|null;
      try { rows = cachedDays(await this.redis.client.get(cacheKey),dates); }
      catch { throw new ServiceUnavailableException({ errorCode:'CALENDAR_CACHE_UNAVAILABLE',message:'Chưa thể tải lịch phòng.' }); }
      if (!rows) {
        const start = new Date(dates[0]), last = new Date(dates.at(-1)!);
        const calendar = await tx.calendarPricing.findMany({ where:{ homestayUnitId:unitId,date:{ gte:start,lte:last } },select:{ date:true,customPrice:true,status:true } });
        const bookings = await tx.booking.findMany({ where:{ homestayUnitId:unitId,
          checkInDate:{ lte:last },checkOutDate:{ gt:start },OR:[
            { bookingStatus:{ in:['CONFIRMED','CHECKED_IN'] } },
            { bookingStatus:{ in:['PENDING_HOST_APPROVAL','PENDING_PAYMENT'] },expiresAt:{ gt:now } },
          ],
        },select:{ checkInDate:true,checkOutDate:true,expiresAt:true,bookingStatus:true } });
        const byDate = new Map(calendar.map(day => [day.date.toISOString().slice(0,10),day]));
        const pricing = { basePricePerNight:unit.basePricePerNight,weekendPricePerNight:unit.weekendPricePerNight,
          customPrices:new Map(calendar.filter(day => day.customPrice !== null).map(day => [day.date.toISOString().slice(0,10),day.customPrice!])) };
        rows = dates.map(date => {
          const day = byDate.get(date);
          // Price is one rounded night only, not a complete-stay quote with cleaning/tax/service.
          const price = calculateNightPrice(date,pricing);
          return { date,price:price.toNumber(),inventoryAvailable:(!day || day.status === 'AVAILABLE')
            && !bookings.some(b => b.checkInDate.toISOString().slice(0,10) <= date && date < b.checkOutDate.toISOString().slice(0,10)) };
        });
        try { await this.redis.client.set(cacheKey,JSON.stringify(rows),'EX',PUBLIC_CALENDAR_TTL_SECONDS); }
        catch { throw new ServiceUnavailableException({ errorCode:'CALENDAR_CACHE_UNAVAILABLE',message:'Chưa thể tải lịch phòng.' }); }
      }
      // Eligibility is always evaluated live: a cached inventory row must not bypass today's cutoff/capacity.
      return { unitId,month:input.month,timeZone:'Asia/Ho_Chi_Minh',days:rows.map(day => {
        let eligible = true;
        try { validateStayPolicy({ ...input,checkIn:day.date,checkOut:new Date(new Date(day.date).getTime()+86400000).toISOString().slice(0,10) },unit,now); }
        catch { eligible = false; }
        return { date:day.date,isAvailable:day.inventoryAvailable && eligible,price:day.price };
      }) };
    },{ isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead });
  }
}
