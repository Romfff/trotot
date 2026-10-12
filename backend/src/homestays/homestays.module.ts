import { Module } from '@nestjs/common';
import { HomestayAvailabilityService } from './homestay-availability.service.js';
import { HomestayAvailabilityController } from './homestay-availability.controller.js';
import { AuthModule } from '../auth/auth.module.js';
import { HomestayCalendarService } from './homestay-calendar.service.js';
import { HomestayManagementService } from './homestay-management.service.js';
import { BookingIdempotencyService } from '../bookings/booking-idempotency.service.js';
import { HomestayPublicController,HomestayHostController,HomestayAdminController } from './homestay-management.controller.js';
import { AddressCatalogController } from './address-catalog.controller.js';

@Module({ imports: [AuthModule], controllers: [HomestayAvailabilityController,HomestayPublicController,HomestayHostController,HomestayAdminController,AddressCatalogController], providers: [HomestayAvailabilityService,HomestayCalendarService,HomestayManagementService,BookingIdempotencyService], exports: [HomestayAvailabilityService,HomestayCalendarService] })
export class HomestaysModule {}
