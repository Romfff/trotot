import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma, type Booking } from '../generated/prisma/client.js';
import { BookingsService } from './bookings.service.js';
import { HomestayAvailabilityService } from '../homestays/homestay-availability.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { RedisService } from '../redis/redis.service.js';
import { BookingIdempotencyService } from './booking-idempotency.service.js';
import { HomestayCalendarService } from '../homestays/homestay-calendar.service.js';
import { calculateStayPrice } from './booking-pricing.js';

// Unit tests isolate I/O only. Separate real DB/Redis/HTTP tests prove locks and transactions.
const io = vi.hoisted(() => ({ acquire: vi.fn(), release: vi.fn(), verify: vi.fn(), sign: vi.fn() }));
vi.mock('redlock', () => ({ default: class { on() {} acquire = io.acquire; } }));
vi.mock('../homestays/homestay-quote.js', () => ({ verifyHomestayQuote: io.verify, signHomestayQuote: io.sign }));

describe('Sprint 3 hold/collision unit coverage — 03 Dev1, 04 Booking Engine, owner contract', () => {
  const now = new Date('2030-01-01T00:00:00Z');
  const input = { unitId: 'unit', checkIn: '2030-01-03', checkOut: '2030-01-05', adults: 1, children: 0 };
  const dto = { unitId: 'unit', checkInDate: input.checkIn, checkOutDate: input.checkOut,
    numAdults: 1, numChildren: 0, guestName: 'Fixture', guestPhone: '0990000000', quoteToken: 'fixture' };
  const unit = { id: 'unit', propertyId: 'property', property: { hostId: 'host' }, maxAdults: 2, maxChildren: 1,
    maxGuests: 3, maxNights: 90, instantBook: true, cancellationPolicy: 'FLEXIBLE',
    checkInTime: new Date('1970-01-01T14:00:00Z'), checkOutTime: new Date('1970-01-01T12:00:00Z'),
    sameDayBookingCutoff: new Date('1970-01-01T18:00:00Z'), basePricePerNight: new Prisma.Decimal(100),
    weekendPricePerNight: new Prisma.Decimal(120), cleaningFee: new Prisma.Decimal(5),
    serviceFeeRate: new Prisma.Decimal(0), taxRate: new Prisma.Decimal(0), commissionRate: new Prisma.Decimal(10) };
  const price = { ...calculateStayPrice(input.checkIn, input.checkOut, { ...unit, customPrices: new Map() }),
    quotedAt: now, isAvailable: true };
  const booking = { id: 'booking', bookingCode: 'FIXTURE', homestayUnitId: 'unit', guestId: 'guest',
    checkInDate: new Date(input.checkIn), checkOutDate: new Date(input.checkOut),
    numAdults: 1, numChildren: 0, guestName: 'Fixture', guestPhone: dto.guestPhone, guestEmail: null, guestNotes: null,
    ...price, ...price.rates, nightlyPrices: price.nightlyPrices.map(n => ({ date: n.date, price: n.price.toString() })),
    policySnapshot: { checkInTime: '14:00:00', checkOutTime: '12:00:00' },
    inventoryLock: { value: 'owner', resources: ['night-1'] }, version: 1,
    bookingStatus: 'PENDING_PAYMENT', paymentStatus: 'NOT_CONFIGURED', expiresAt: new Date('2030-01-01T00:15:00Z'),
    createdAt: now, updatedAt: now } as unknown as Booking;
  let tx: { $queryRaw: ReturnType<typeof vi.fn>; $executeRaw: ReturnType<typeof vi.fn>;
    homestayUnit: { findFirst: ReturnType<typeof vi.fn> }; calendarPricing: { findMany: ReturnType<typeof vi.fn> };
    booking: Record<'findMany'|'findFirst'|'findUniqueOrThrow'|'create'|'update'|'count', ReturnType<typeof vi.fn>> };
  let service: BookingsService;
  let availability: HomestayAvailabilityService;
  let inspect: ReturnType<typeof vi.fn>;
  let invalidate: ReturnType<typeof vi.fn>;
  let deleteIfValue: ReturnType<typeof vi.fn>;
  let run: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetAllMocks(); vi.stubEnv('NODE_ENV', 'test'); vi.stubEnv('BOOKING_ALLOW_UNCONFIGURED_PAYMENT', 'true');
    vi.stubEnv('VNPAY_SANDBOX_ENABLED','false');
    vi.stubEnv('BOOKING_MIN_NIGHTLY_PRICE', '1');
    tx = { $queryRaw: vi.fn().mockResolvedValue([{ now }]), $executeRaw: vi.fn().mockResolvedValue(0),
      homestayUnit: { findFirst: vi.fn().mockResolvedValue(unit) }, calendarPricing: { findMany: vi.fn().mockResolvedValue([]) },
      booking: { findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn().mockResolvedValue(booking),
        findUniqueOrThrow: vi.fn().mockResolvedValue(booking), create: vi.fn().mockResolvedValue(booking),
        update: vi.fn().mockResolvedValue({ ...booking, version: 2 }), count: vi.fn().mockResolvedValue(1) } };
    const prisma = { ...tx, $transaction: vi.fn(async (work: unknown) => typeof work === 'function'
      ? (work as (t: typeof tx) => Promise<unknown>)(tx) : Promise.all(work as Promise<unknown>[])) } as unknown as PrismaService;
    deleteIfValue = vi.fn().mockResolvedValue(true); invalidate = vi.fn().mockResolvedValue(undefined);
    run = vi.fn(async (_user: string, _operation: string, _key: string, _body: unknown,
      callback: (t: typeof tx) => Promise<unknown>) => callback(tx));
    inspect = vi.fn().mockResolvedValue(price);
    service = new BookingsService(prisma, { client: {}, deleteIfValue } as unknown as RedisService,
      { run } as unknown as BookingIdempotencyService, { inspectInTransaction: inspect } as unknown as HomestayAvailabilityService,
      { invalidate } as unknown as HomestayCalendarService);
    availability = new HomestayAvailabilityService(prisma);
    io.acquire.mockResolvedValue({ value: 'owner', release: io.release }); io.release.mockResolvedValue(undefined);
    io.verify.mockResolvedValue({ priceChanged: false }); io.sign.mockResolvedValue({ quoteToken: 'new-token', quoteExpiresAt: '2030-01-01T00:15:00Z' });
  });
  afterEach(() => vi.unstubAllEnvs());

  it.each([true, false])('holds Instant/Request=%s with immutable snapshots and per-night resources', async instantBook => {
    tx.homestayUnit.findFirst.mockResolvedValue({ ...unit, instantBook });
    const result = await service.hold('guest', dto, 'key', dto);
    expect(result.bookingId).toBe('booking'); expect(result).not.toHaveProperty('inventoryLock');
    expect(result).not.toHaveProperty('hostPayoutAmount'); expect(io.acquire.mock.calls[0][0]).toEqual([
      'booking:night:unit:2030-01-03', 'booking:night:unit:2030-01-04']);
    const data = tx.booking.create.mock.calls[0][0].data;
    expect(data.bookingStatus).toBe(instantBook ? 'PENDING_PAYMENT' : 'PENDING_HOST_APPROVAL');
    expect(data.paymentStatus).toBe('NOT_CONFIGURED'); expect(data.nightlyPrices).toHaveLength(2);
    expect(data.policySnapshot.maxNights).toBe(90); expect(data.totalAmount.eq(price.totalAmount)).toBe(true);
    expect(invalidate).toHaveBeenCalledWith('unit'); expect(io.release).not.toHaveBeenCalled();
  });
  it('releases expired ownership tokens before acquiring inventory', async () => {
    tx.booking.findMany.mockResolvedValue([{ inventoryLock: booking.inventoryLock }]);
    await service.hold('guest', dto, 'key', dto);
    expect(deleteIfValue).toHaveBeenCalledWith('night-1', 'owner');
    expect(deleteIfValue.mock.invocationCallOrder[0]).toBeLessThan(io.acquire.mock.invocationCallOrder[0]);
  });
  function enableSandbox() {
    vi.stubEnv('VNPAY_SANDBOX_ENABLED','true');vi.stubEnv('VNPAY_TMN_CODE','FIXTURE1');
    vi.stubEnv('VNPAY_HASH_SECRET','fixture-only-vnpay-secret-not-a-credential-12345');
    vi.stubEnv('VNPAY_RETURN_URL','https://trotot.example/payment/return');
    vi.stubEnv('BOOKING_ALLOW_UNCONFIGURED_PAYMENT','false');
  }
  it.each([true,false])('configured sandbox holds Instant/Request=%s pending, not paid',async instantBook=>{
    enableSandbox();tx.homestayUnit.findFirst.mockResolvedValue({...unit,instantBook});
    tx.booking.create.mockImplementation(async({data})=>({...booking,...data}));
    const result=await service.hold('guest',dto,'key',dto);
    expect(result).toMatchObject({paymentStatus:'PENDING',bookingStatus:instantBook?'PENDING_PAYMENT':'PENDING_HOST_APPROVAL',payment:null});
    expect(tx.booking.create.mock.calls[0][0].data.paymentStatus).toBe('PENDING');
  });
  it.each(['production','secret','return-url','merchant'])('configured sandbox fails closed before inventory: %s',async invalid=>{
    enableSandbox();vi.stubEnv('BOOKING_ALLOW_UNCONFIGURED_PAYMENT','true');
    if(invalid==='production')vi.stubEnv('NODE_ENV','production');
    if(invalid==='secret')vi.stubEnv('VNPAY_HASH_SECRET','');
    if(invalid==='return-url')vi.stubEnv('VNPAY_RETURN_URL','http://unsafe.example/return');
    if(invalid==='merchant')vi.stubEnv('VNPAY_TMN_CODE','');
    await expect(service.hold('guest',dto,'key',dto)).rejects.toMatchObject({response:{errorCode:'PAYMENT_NOT_CONFIGURED'}});
    expect(tx.homestayUnit.findFirst).not.toHaveBeenCalled();expect(io.acquire).not.toHaveBeenCalled();expect(tx.booking.create).not.toHaveBeenCalled();
  });
  it('rejects adapter amount overflow before acquiring Redis or creating a booking',async()=>{
    enableSandbox();inspect.mockResolvedValue({...price,totalAmount:new Prisma.Decimal('10000000000')});
    await expect(service.hold('guest',dto,'key',dto)).rejects.toMatchObject({response:{errorCode:'PAYMENT_AMOUNT_UNSUPPORTED'}});
    expect(io.acquire).not.toHaveBeenCalled();expect(tx.booking.create).not.toHaveBeenCalled();
  });
  it.each(['production', 'disabled'])('refuses unconfigured payment: %s', async gate => {
    if (gate === 'production') vi.stubEnv('NODE_ENV', 'production'); else vi.stubEnv('BOOKING_ALLOW_UNCONFIGURED_PAYMENT', 'false');
    await expect(service.hold('guest', dto, 'key', dto)).rejects.toMatchObject({ response: { errorCode: 'PAYMENT_NOT_CONFIGURED' } });
    expect(tx.booking.create).not.toHaveBeenCalled();
  });
  it('refuses missing or own units without acquiring Redis', async () => {
    tx.homestayUnit.findFirst.mockResolvedValueOnce(null);
    await expect(service.hold('guest', dto, 'key', dto)).rejects.toMatchObject({ response: { errorCode: 'UNIT_NOT_FOUND' } });
    await expect(service.hold('host', dto, 'key', dto)).rejects.toMatchObject({ response: { errorCode: 'SELF_BOOKING_NOT_ALLOWED' } });
    expect(io.acquire).not.toHaveBeenCalled();
  });
  it('returns a new signed quote on repricing, without a booking', async () => {
    io.verify.mockResolvedValue({ priceChanged: true });
    await expect(service.hold('guest', dto, 'key', dto)).rejects.toMatchObject({ response: { errorCode: 'PRICE_CHANGED', data: {
      quoteToken: 'new-token', priceBreakdown: { totalAmount: price.totalAmount.toNumber() } } } });
    expect(tx.booking.create).not.toHaveBeenCalled();
  });
  it('rejects DB collision and Redis contention without creating a row', async () => {
    inspect.mockResolvedValueOnce({ ...price, isAvailable: false });
    await expect(service.hold('guest', dto, 'key', dto)).rejects.toMatchObject({ response: { errorCode: 'ROOM_ALREADY_LOCKED' } });
    io.acquire.mockRejectedValueOnce(new Error('contention'));
    await expect(service.hold('guest', dto, 'key', dto)).rejects.toMatchObject({ response: { errorCode: 'ROOM_ALREADY_LOCKED' } });
    expect(tx.booking.create).not.toHaveBeenCalled();
  });
  it.each(['P2004', 'P2002', 'P2025'])('cleans acquired lock on DB failure %s, maps only collision errors', async code => {
    const error = new Prisma.PrismaClientKnownRequestError('fixture', { code, clientVersion: 'fixture' });
    tx.booking.create.mockRejectedValue(error); io.release.mockRejectedValueOnce(new Error('Redis unavailable'));
    const result = service.hold('guest', dto, 'key', dto);
    if (code === 'P2025') await expect(result).rejects.toBe(error);
    else await expect(result).rejects.toMatchObject({ response: { errorCode: 'ROOM_ALREADY_LOCKED' } });
    expect(io.release).toHaveBeenCalledOnce();
  });
  it('does not turn committed success into a failure on cache outage; replay never acquires twice', async () => {
    invalidate.mockRejectedValue(new Error('cache outage'));
    const first = await service.hold('guest', dto, 'key', dto);
    run.mockResolvedValueOnce({ status: 201, body: first });
    expect(await service.hold('guest', dto, 'key', dto)).toEqual(first); expect(io.acquire).toHaveBeenCalledOnce();
  });
  it('ignores malformed locks and handles failed ownership-safe cleanup', async () => {
    for (const bad of [null, 'text', [], {}, { value: 1, resources: [] }, { value: 'owner', resources: 'text' }]) {
      await service.releaseLock(bad);
    }
    expect(deleteIfValue).not.toHaveBeenCalled();
    deleteIfValue.mockRejectedValueOnce(new Error('offline'));
    await service.releaseLock({ value: 'owner', resources: ['night-1', 2] });
    expect(deleteIfValue).toHaveBeenCalledOnce();
  });
  it.each(['accept', 'reject', 'cancel', 'check-in', 'complete'] as const)('enforces and projects action %s', async action => {
    const row = { ...booking,
      bookingStatus: action === 'check-in' ? 'CONFIRMED' : action === 'complete' ? 'CHECKED_IN' : 'PENDING_HOST_APPROVAL',
      paymentStatus: ['check-in', 'complete'].includes(action) ? 'PAID' : 'NOT_CONFIGURED' };
    tx.booking.findUniqueOrThrow.mockResolvedValue(row);
    tx.$queryRaw.mockResolvedValue([{ now: action === 'check-in' ? new Date('2030-01-03T08:00:00Z')
      : action === 'complete' ? new Date('2030-01-05T08:00:00Z') : now }]);
    await service.action(action === 'cancel' ? 'guest' : 'host', 'booking', action, 1, 'key', { expectedVersion: 1 });
    const where = tx.booking.findFirst.mock.calls[0][0].where;
    expect(action === 'cancel' ? where.guestId : where.unit.property.hostId).toBe(action === 'cancel' ? 'guest' : 'host');
    expect(tx.booking.update.mock.calls[0][0].data.version).toEqual({ increment: 1 });
    expect(deleteIfValue).toHaveBeenCalledTimes(['reject', 'cancel', 'complete'].includes(action) ? 1 : 0);
  });
  it('refuses non-owner actions; replay does not repeat state changes', async () => {
    tx.booking.findFirst.mockResolvedValueOnce(null);
    await expect(service.action('other', 'booking', 'cancel', 1, 'key', {})).rejects.toMatchObject({ response: { errorCode: 'BOOKING_NOT_FOUND' } });
    run.mockResolvedValueOnce({ status: 200, body: { replay: true } });
    expect(await service.action('guest', 'booking', 'cancel', 1, 'key', {})).toEqual({ replay: true });
    expect(tx.booking.update).not.toHaveBeenCalled();
  });
  it('reads only owned bookings, hides inventory/financial internals and clamps deadlines', async () => {
    for (const host of [false, true]) {
      expect((await service.read(host ? 'host' : 'guest', 'booking', host)).payment).toBeNull();
      tx.booking.findMany.mockResolvedValue([{ ...booking, expiresAt: new Date('2000-01-01') }]);
      const list = await service.list(host ? 'host' : 'guest', 1, 10, host);
      expect(list.data[0].expiresInSeconds).toBe(0); expect(list.data[0]).not.toHaveProperty('guestId');
    }
    tx.booking.findFirst.mockResolvedValue(null);
    await expect(service.read('other', 'booking')).rejects.toMatchObject({ response: { errorCode: 'BOOKING_NOT_FOUND' } });
  });
  it.each([{ adults: 0 }, { adults: 1.5 }, { children: -1 }, { children: 0.5 }])('rejects invalid guest counts %j', async bad => {
    await expect(availability.inspect({ ...input, ...bad })).rejects.toMatchObject({ response: { errorCode: 'INVALID_CAPACITY' } });
  });
  it('availability reads all collision states under one snapshot and emits a signed quote', async () => {
    tx.booking.findFirst.mockResolvedValue(null);
    tx.calendarPricing.findMany.mockResolvedValue([{ date: new Date(input.checkIn), customPrice: new Prisma.Decimal(90), status: 'AVAILABLE' },
      { date: new Date('2030-01-04'), customPrice: null, status: 'AVAILABLE' }]);
    const quote = await availability.checkAvailability(input);
    expect(quote.isAvailable).toBe(true); expect(quote.quoteToken).toBe('new-token');
    expect(quote.priceBreakdown.nightlyPrices[0].price).toBe(90);
    const where = tx.booking.findFirst.mock.calls[0][0].where;
    expect(where.checkInDate.lt).toEqual(new Date(input.checkOut)); expect(where.checkOutDate.gt).toEqual(new Date(input.checkIn));
    expect(where.OR[0].bookingStatus.in).toEqual(['CONFIRMED', 'CHECKED_IN']);
    tx.calendarPricing.findMany.mockResolvedValue([{ date: new Date(input.checkIn), customPrice: null, status: 'BLOCKED' }]);
    expect((await availability.inspect(input)).isAvailable).toBe(false);
    tx.booking.findFirst.mockResolvedValue({ id: 'collision' });
    expect((await availability.inspect(input)).isAvailable).toBe(false);
  });
  it('availability rejects missing rooms and live nonzero fees/taxes', async () => {
    tx.homestayUnit.findFirst.mockResolvedValueOnce(null);
    await expect(availability.inspect(input)).rejects.toMatchObject({ response: { errorCode: 'UNIT_NOT_FOUND' } });
    vi.stubEnv('NODE_ENV', 'production');
    for (const rates of [{ serviceFeeRate: new Prisma.Decimal(5) }, { taxRate: new Prisma.Decimal(5) }]) {
      tx.homestayUnit.findFirst.mockResolvedValue({ ...unit, ...rates });
      await expect(availability.inspect(input)).rejects.toMatchObject({ response: { errorCode: 'PRICING_POLICY_NOT_CONFIGURED' } });
    }
    tx.homestayUnit.findFirst.mockResolvedValue(unit);
    expect(await availability.inspect(input)).toHaveProperty('totalNights', 2);
  });
});
