import { BadRequestException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';
import { parseStay, validateStayPolicy } from '../bookings/booking-dates.js';
import { calculateStayPrice } from '../bookings/booking-pricing.js';
import { signHomestayQuote } from './homestay-quote.js';

export type AvailabilityInput = {
  unitId: string; checkIn: string; checkOut: string; adults: number; children: number;
};

export const publishedHomestayUnit: Prisma.HomestayUnitWhereInput = {
  status:'PUBLISHED',deletedAt:null,property:{ status:'PUBLISHED',deletedAt:null,isAvailable:true,
    rentalMode:{ in:['SHORT_TERM','HYBRID'] },propertyType:{ in:['HOMESTAY','VILLA'] },host:{ status:'ACTIVE',role:'HOST' } },
};

@Injectable()
export class HomestayAvailabilityService {
  constructor(private readonly prisma: PrismaService) {}

  // No reservations are created; a later hold must recheck inventory under a DB lock.
  async inspect(input: AvailabilityInput) {
    return this.prisma.$transaction(tx => this.inspectInTransaction(tx,input), { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }

  async inspectInTransaction(tx: Prisma.TransactionClient,input: AvailabilityInput) {
    const stay = parseStay(input.checkIn, input.checkOut);
    if (!Number.isSafeInteger(input.adults) || input.adults < 1
      || !Number.isSafeInteger(input.children) || input.children < 0) {
      throw new BadRequestException({ errorCode: 'INVALID_CAPACITY', message: 'Số lượng khách không hợp lệ.' });
    }
      const [{ now }] = await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`;
      const unit = await tx.homestayUnit.findFirst({
        where: { ...publishedHomestayUnit,id:input.unitId },
        select: {
          id: true, maxAdults: true, maxChildren: true, basePricePerNight: true,
          weekendPricePerNight: true, cleaningFee: true,
          maxNights: true, maxGuests: true, sameDayBookingCutoff: true, instantBook: true,
          serviceFeeRate: true, taxRate: true, commissionRate: true,
        },
      });
      if (!unit) throw new NotFoundException({ errorCode: 'UNIT_NOT_FOUND', message: 'Không tìm thấy phòng.' });
      validateStayPolicy(input, unit, now);
      const calendar = await tx.calendarPricing.findMany({
        where: {
          homestayUnitId: unit.id,
          date: { gte: new Date(`${stay.checkIn}T00:00:00Z`), lt: new Date(`${stay.checkOut}T00:00:00Z`) },
        },
        select: { date: true, customPrice: true, status: true },
      });
      const booking = await tx.booking.findFirst({
        where: {
          homestayUnitId: unit.id,
          checkInDate: { lt: new Date(`${stay.checkOut}T00:00:00Z`) },
          checkOutDate: { gt: new Date(`${stay.checkIn}T00:00:00Z`) },
          OR: [
            { bookingStatus: { in: ['CONFIRMED','CHECKED_IN'] } },
            { bookingStatus: { in: ['PENDING_HOST_APPROVAL','PENDING_PAYMENT'] }, expiresAt: { gt: now } },
          ],
        }, select: { id: true },
      });
      const subtotal = calculateStayPrice(stay.checkIn, stay.checkOut, {
        basePricePerNight: unit.basePricePerNight, weekendPricePerNight: unit.weekendPricePerNight,
        cleaningFee: unit.cleaningFee, serviceFeeRate: unit.serviceFeeRate, taxRate: unit.taxRate, commissionRate: unit.commissionRate,
        customPrices: new Map(calendar.filter(day => day.customPrice !== null)
          .map(day => [day.date.toISOString().slice(0, 10), day.customPrice!])),
      });
      // Owner gate: live nonzero service/tax rates await tax responsibility and inclusive-price decisions.
      if (process.env.NODE_ENV === 'production' && (!subtotal.rates.serviceFeeRate.isZero() || !subtotal.rates.taxRate.isZero())) {
        throw new ServiceUnavailableException({ errorCode: 'PRICING_POLICY_NOT_CONFIGURED', message: 'Phí dịch vụ hoặc thuế chưa được bật cho môi trường thật.' });
      }
      return {
        isAvailable: !booking && calendar.every(day => day.status === 'AVAILABLE'),
        quotedAt: now,
        ...subtotal,
      };
  }

  async checkAvailability(input: AvailabilityInput) {
    const price = await this.inspect(input);
    // Decimal math stays on the server. All rounded amounts fit NUMERIC(15,2), hence safe JSON integers.
    return {
      isAvailable: price.isAvailable, totalNights: price.totalNights,
      ...await signHomestayQuote(input,price,price.quotedAt),
      priceBreakdown: {
        nightlyPrices: price.nightlyPrices.map(night => ({ date: night.date, price: night.price.toNumber() })),
        baseAmount: price.baseAmount.toNumber(), cleaningFee: price.cleaningFee.toNumber(),
        serviceFee: price.serviceFee.toNumber(), taxAmount: price.taxAmount.toNumber(), totalAmount: price.totalAmount.toNumber(),
      },
    };
  }
}
