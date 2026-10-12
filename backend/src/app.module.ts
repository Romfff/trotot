import './config/load-env.js';
import { Module } from '@nestjs/common';
import { DatabaseModule } from './database/database.module.js';
import { HealthController } from './health/health.controller.js';
import { AuthModule } from './auth/auth.module.js';
import { RedisModule } from './redis/redis.module.js';
import { StorageModule } from './storage/storage.module.js';
import { ListingsModule } from './listings/listings.module.js';
import { HomestaysModule } from './homestays/homestays.module.js';
import { BookingsModule } from './bookings/bookings.module.js';
import { AppointmentsModule } from './appointments/appointments.module.js';
import { ReviewsModule } from './reviews/reviews.module.js';
import { ChatModule } from './chat/chat.module.js';
import { AdminModule } from './admin/admin.module.js';
import { NearbyModule } from './nearby/nearby.module.js';

@Module({
  imports: [DatabaseModule, RedisModule, AuthModule, StorageModule, ListingsModule, HomestaysModule,BookingsModule,AppointmentsModule,ReviewsModule,ChatModule,AdminModule,NearbyModule],
  controllers: [HealthController],
})
export class AppModule {}
