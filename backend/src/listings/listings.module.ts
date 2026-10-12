import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { ListingsController } from './listings.controller.js';
import { ListingsService } from './listings.service.js';
import { ListingsManagementService } from './listings-management.service.js';
import { ListingContactRateLimitGuard, OptionalContactTokenGuard } from './listing-contact.guard.js';

@Module({ imports: [AuthModule], controllers: [ListingsController], providers: [ListingsService, ListingsManagementService, ListingContactRateLimitGuard, OptionalContactTokenGuard] })
export class ListingsModule {}
