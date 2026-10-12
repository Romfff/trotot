import { Controller, Get, Header, Param, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiEnvelopedResponses } from '../common/api-docs.js';
import { Sprint2IpRateLimitGuard } from '../common/sprint2-rate-limit.guard.js';
import { HomestayAvailabilityDto,HomestayCalendarDto,HomestayUnitIdDto } from './homestay-availability.dto.js';
import { HomestayAvailabilityService } from './homestay-availability.service.js';
import { HomestayCalendarService } from './homestay-calendar.service.js';

@ApiTags('homestay-availability')
@Controller('homestays')
@UseGuards(Sprint2IpRateLimitGuard)
export class HomestayAvailabilityController {
  constructor(private readonly availability: HomestayAvailabilityService,private readonly calendar:HomestayCalendarService) {}

  @Get('units/:unitId/calendar')
  @Header('Cache-Control','no-store')
  @ApiOperation({ summary:'Public daily availability and rounded nightly price only; never reveals booking/block reason or guest details',
    description:'15-second Redis inventory cache; no intermediary/browser cache. Live public visibility, capacity and today cutoff checks. Checkout may still use an unavailable night as the range end.' })
  @ApiEnvelopedResponses({ type:'object',required:['unitId','month','timeZone','days'],properties:{
    unitId:{ type:'string',format:'uuid' },month:{ type:'string' },timeZone:{ type:'string',enum:['Asia/Ho_Chi_Minh'] },
    days:{ type:'array',items:{ type:'object',required:['date','isAvailable','price'],properties:{
      date:{ type:'string',format:'date' },isAvailable:{ type:'boolean' },price:{ type:'integer',minimum:0 },
    } } },
  } },200,[400,404,429,503])
  month(@Param() params:HomestayUnitIdDto,@Query() query:HomestayCalendarDto) { return this.calendar.read(params.unitId,query); }

  @Get('check-availability')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Public room/date/capacity check with a server quote; does not reserve inventory',
    description: 'Asia/Ho_Chi_Minh; checkout excluded. Published units/properties only. Same-day Instant Book before per-unit cutoff; Request-to-Book starts tomorrow. Per-unit maxNights <=90. No bookings/holds are created.' })
  @ApiEnvelopedResponses({ type: 'object', required: ['isAvailable','totalNights','priceBreakdown','quoteToken','quoteExpiresAt'], properties: {
    isAvailable: { type: 'boolean' }, totalNights: { type: 'integer', minimum: 1, maximum: 90 },
    quoteToken: { type:'string',description:'Server-signed 15-minute quote, separate from Idempotency-Key; does not reserve inventory' },
    quoteExpiresAt: { type:'string',format:'date-time',description:'Quote expiry, not booking/payment hold expiry' },
    priceBreakdown: { type: 'object', required: ['nightlyPrices','baseAmount','cleaningFee','serviceFee','taxAmount','totalAmount'], properties: {
      nightlyPrices: { type: 'array', items: { type: 'object', required: ['date','price'], properties: { date: { type: 'string', format: 'date' }, price: { type: 'integer', minimum: 0 } } } },
      baseAmount: { type: 'integer', minimum: 0 }, cleaningFee: { type: 'integer', minimum: 0 },
      serviceFee: { type: 'integer', minimum: 0 }, taxAmount: { type: 'integer', minimum: 0 }, totalAmount: { type: 'integer', minimum: 0 },
    } },
  } }, 200, [400,404,429,503])
  check(@Query() query: HomestayAvailabilityDto) { return this.availability.checkAvailability(query); }
}
