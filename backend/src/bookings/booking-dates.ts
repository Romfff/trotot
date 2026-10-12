import { BadRequestException } from '@nestjs/common';

const DAY_MS = 86_400_000;
const vietnamDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit',
});

function invalidDateRange(): never {
  throw new BadRequestException({
    errorCode: 'INVALID_DATE_RANGE',
    message: 'Ngày lưu trú phải hợp lệ và ngày trả phòng phải sau ngày nhận phòng.',
  });
}

// Calendar dates, not timestamps: UTC is only used for date arithmetic.
export function dateEpoch(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000-')) invalidDateRange();
  const epoch = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(epoch) || new Date(epoch).toISOString().slice(0, 10) !== value) invalidDateRange();
  return epoch;
}

export function parseStay(checkIn: string, checkOut: string) {
  const start = dateEpoch(checkIn);
  const end = dateEpoch(checkOut);
  if (end <= start) invalidDateRange();
  return { checkIn, checkOut, totalNights: (end - start) / DAY_MS };
}

export function staysOverlap(first: { checkIn: string; checkOut: string }, second: { checkIn: string; checkOut: string }): boolean {
  const a = parseStay(first.checkIn, first.checkOut);
  const b = parseStay(second.checkIn, second.checkOut);
  return a.checkIn < b.checkOut && b.checkIn < a.checkOut;
}

export function* stayDates(checkIn: string, checkOut: string): Generator<string> {
  const stay = parseStay(checkIn, checkOut);
  const start = dateEpoch(stay.checkIn);
  for (let night = 0; night < stay.totalNights; night++) {
    yield new Date(start + night * DAY_MS).toISOString().slice(0, 10);
  }
}

export function vietnamToday(now = new Date()): string {
  const parts = vietnamDateFormatter.formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)!.value;
  return `${get('year').padStart(4, '0')}-${get('month')}-${get('day')}`;
}

const vietnamTimeFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

export function validateGuestCapacity(
  input: { adults:number;children:number },
  unit: { maxAdults:number;maxChildren:number;maxGuests:number|null },
) {
  if (!Number.isSafeInteger(input.adults) || input.adults < 1 || !Number.isSafeInteger(input.children) || input.children < 0
    || input.adults > unit.maxAdults || input.children > unit.maxChildren
    || unit.maxGuests !== null && input.adults + input.children > unit.maxGuests) {
    throw new BadRequestException({ errorCode:'INVALID_CAPACITY',message:'Số lượng khách không hợp lệ hoặc vượt sức chứa của phòng.' });
  }
}

export function validateStayPolicy(
  input: { checkIn: string; checkOut: string; adults: number; children: number },
  unit: { maxNights: number; instantBook: boolean; sameDayBookingCutoff: Date; maxAdults: number; maxChildren: number; maxGuests: number | null },
  now = new Date(),
) {
  const stay = parseStay(input.checkIn, input.checkOut);
  const today = vietnamToday(now);
  if (stay.totalNights > unit.maxNights) {
    throw new BadRequestException({ errorCode: 'STAY_TOO_LONG', message: `Phòng này cho phép lưu trú tối đa ${unit.maxNights} đêm.` });
  }
  if (stay.checkIn < today || !unit.instantBook && stay.checkIn === today) {
    throw new BadRequestException({ errorCode: 'INVALID_CHECK_IN_DATE', message: 'Ngày nhận phòng không phù hợp với thời gian đặt và chế độ của phòng.' });
  }
  if (stay.checkIn === today
    && vietnamTimeFormatter.format(now) >= unit.sameDayBookingCutoff.toISOString().slice(11, 19)) {
    throw new BadRequestException({ errorCode: 'SAME_DAY_BOOKING_CLOSED', message: 'Đã qua giờ chốt đặt phòng trong ngày. Vui lòng chọn ngày tiếp theo.' });
  }
  validateGuestCapacity(input,unit);
  return stay;
}
