import './config/load-env.js';
import { Module } from '@nestjs/common';
import { DatabaseModule } from './database/database.module.js';
import { HealthController } from './health/health.controller.js';
import { AuthModule } from './auth/auth.module.js';
import { RedisModule } from './redis/redis.module.js';
import { StorageModule } from './storage/storage.module.js';

@Module({
  imports: [DatabaseModule, RedisModule, AuthModule, StorageModule],
  controllers: [HealthController],
})
export class AppModule {}
