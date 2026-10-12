import { BadRequestException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { dateEpoch,stayDates } from './booking-dates.js';

type Price = Prisma.Decimal | string | number;

function decimalPrice(value: Price): Prisma.Decimal {
  try {
    const amount = new Prisma.Decimal(value);
    if (amount.isFinite() && amount.gte(0) && amount.decimalPlaces() <= 2 && amount.lte('9999999999999.99')) return amount;
  } catch { /* Report an input error instead of leaking the Decimal parser error. */ }
  throw new BadRequestException({ errorCode: 'INVALID_PRICE', message: 'Giá phòng phải là số tiền hợp lệ, không âm.' });
}

// Same calendar/rounding logic is reused by the full server quote below.
// Prices must come from server unit/calendar records, never a client-supplied total.
export function calculateNightPrice(date:string,pricing:{ basePricePerNight:Price;weekendPricePerNight:Price|null;customPrices:ReadonlyMap<string,Price> }) {
  const weekday = new Date(dateEpoch(date)).getUTCDay();
  const base = decimalPrice(pricing.basePricePerNight);
  const weekend = pricing.weekendPricePerNight === null ? base : decimalPrice(pricing.weekendPricePerNight);
  const custom = pricing.customPrices.get(date);
  return decimalPrice((custom === undefined ? ([5,6].includes(weekday) ? weekend : base) : decimalPrice(custom))
    .toDecimalPlaces(0,Prisma.Decimal.ROUND_HALF_UP));
}

export function calculateNightlySubtotal(
  checkIn: string,
  checkOut: string,
  pricing: {
    basePricePerNight: Price;
    weekendPricePerNight: Price | null;
    customPrices: ReadonlyMap<string, Price>;
  },
) {
  const nightlyPrices: { date: string; price: Prisma.Decimal }[] = [];
  let baseAmount = new Prisma.Decimal(0);
  for (const date of stayDates(checkIn, checkOut)) {
    const price = calculateNightPrice(date,pricing);
    baseAmount = baseAmount.plus(price);
    nightlyPrices.push({ date, price });
  }
  // NUMERIC(15,2) is the existing schema's monetary storage boundary.
  decimalPrice(baseAmount);
  return { totalNights: nightlyPrices.length, nightlyPrices, baseAmount };
}

function rate(value: Price, minimum = 0, maximum = 100): Prisma.Decimal {
  const amount = decimalPrice(value);
  if (amount.lt(minimum) || amount.gt(maximum)) {
    throw new BadRequestException({ errorCode: 'INVALID_PRICING_RATE', message: 'Tỷ lệ phí không hợp lệ.' });
  }
  return amount;
}

export function calculateStayPrice(
  checkIn: string, checkOut: string,
  pricing: Parameters<typeof calculateNightlySubtotal>[2] & {
    cleaningFee: Price; serviceFeeRate: Price; taxRate: Price; commissionRate: Price;
  },
) {
  const nights = calculateNightlySubtotal(checkIn, checkOut, pricing);
  const cleaningFee = decimalPrice(pricing.cleaningFee).toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP);
  const serviceFeeRate = rate(pricing.serviceFeeRate);
  const taxRate = rate(pricing.taxRate);
  const commissionRate = rate(pricing.commissionRate, 8, 12);
  const hostGross = nights.baseAmount.plus(cleaningFee);
  const serviceFee = hostGross.times(serviceFeeRate).dividedBy(100).toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP);
  const taxAmount = hostGross.plus(serviceFee).times(taxRate).dividedBy(100).toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP);
  const totalAmount = hostGross.plus(serviceFee).plus(taxAmount);
  decimalPrice(totalAmount);
  const commissionAmount = hostGross.times(commissionRate).dividedBy(100).toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP);
  const hostPayoutAmount = hostGross.minus(commissionAmount);
  return { ...nights, cleaningFee, serviceFee, taxAmount, totalAmount, commissionAmount, hostPayoutAmount,
    rates: { serviceFeeRate, taxRate, commissionRate } };
}
