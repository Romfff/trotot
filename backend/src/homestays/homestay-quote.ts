import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { SignJWT, jwtVerify, errors } from 'jose';
import { bookingRequestHash } from '../bookings/booking-idempotency.js';
import type { calculateStayPrice } from '../bookings/booking-pricing.js';
import type { AvailabilityInput } from './homestay-availability.service.js';

export const HOMESTAY_QUOTE_SECONDS = 15 * 60;
const quoteType = 'trotot-homestay-quote+jwt';
type Price = ReturnType<typeof calculateStayPrice>;

function key(): Uint8Array {
  const secret = process.env.HOMESTAY_QUOTE_SECRET?.trim();
  if (!secret || secret.length < 32 || [process.env.JWT_ACCESS_SECRET?.trim(),process.env.JWT_REFRESH_SECRET?.trim()].includes(secret)) {
    throw new ServiceUnavailableException({ errorCode:'QUOTE_SIGNING_NOT_CONFIGURED',message:'Chưa cấu hình chữ ký báo giá.' });
  }
  return new TextEncoder().encode(secret);
}

function priceHash(price: Price): string {
  const amountFields = ['baseAmount','cleaningFee','serviceFee','taxAmount','totalAmount','commissionAmount','hostPayoutAmount'] as const;
  // A signed digest binds the complete server snapshot without exposing commission/payout rates.
  return bookingRequestHash({
    totalNights:price.totalNights,nightlyPrices:price.nightlyPrices.map(n => ({ date:n.date,price:n.price.toString() })),
    amounts:Object.fromEntries(amountFields.map(name => [name,price[name].toString()])),
    rates:Object.fromEntries(Object.entries(price.rates).map(([name,value]) => [name,value.toString()])),
  });
}

export async function signHomestayQuote(input: AvailabilityInput, price: Price, now = new Date()) {
  const issuedAt = Math.floor(now.getTime()/1000), expiresAt = issuedAt + HOMESTAY_QUOTE_SECONDS;
  const quoteToken = await new SignJWT({
    version:1,unitId:input.unitId,checkIn:input.checkIn,checkOut:input.checkOut,
    adults:input.adults,children:input.children,priceHash:priceHash(price),
  }).setProtectedHeader({ alg:'HS256',typ:quoteType }).setIssuer('trotot').setAudience('homestay-quote')
    .setIssuedAt(issuedAt).setExpirationTime(expiresAt).sign(key());
  return { quoteToken,quoteExpiresAt:new Date(expiresAt*1000).toISOString() };
}

// Verification itself never changes inventory; the hold caller reprices/rechecks under its DB transaction.
export async function verifyHomestayQuote(token: string, input: AvailabilityInput, price: Price, now = new Date()) {
  const signingKey = key();
  try {
    if (typeof token !== 'string' || token.length > 2048) throw new Error('Invalid token');
    const { payload } = await jwtVerify(token,signingKey,{
      algorithms:['HS256'],typ:quoteType,issuer:'trotot',audience:'homestay-quote',currentDate:now,
      requiredClaims:['iat','exp','version','unitId','checkIn','checkOut','adults','children','priceHash'],
    });
    if (payload.version !== 1 || !Number.isSafeInteger(payload.iat) || !Number.isSafeInteger(payload.exp)
      || payload.exp! - payload.iat! !== HOMESTAY_QUOTE_SECONDS || payload.iat! > Math.floor(now.getTime()/1000)
      || payload.unitId !== input.unitId || payload.checkIn !== input.checkIn || payload.checkOut !== input.checkOut
      || payload.adults !== input.adults || payload.children !== input.children
      || typeof payload.priceHash !== 'string' || !/^[a-f0-9]{64}$/.test(payload.priceHash)) throw new Error('Invalid binding');
    return { priceChanged:payload.priceHash !== priceHash(price),quoteExpiresAt:new Date(payload.exp!*1000).toISOString() };
  } catch (error) {
    if (error instanceof errors.JWTExpired) throw new BadRequestException({ errorCode:'QUOTE_EXPIRED',message:'Báo giá đã hết hạn. Vui lòng lấy giá mới.' });
    throw new BadRequestException({ errorCode:'INVALID_QUOTE_TOKEN',message:'Báo giá không hợp lệ. Vui lòng lấy giá mới.' });
  }
}
