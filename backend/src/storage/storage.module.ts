import { Module } from '@nestjs/common';
import { AccessTokenGuard } from '../auth/access-token.guard.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { Sprint2UserRateLimitGuard } from '../common/sprint2-rate-limit.guard.js';
import { StorageController } from './storage.controller.js';
import { StorageService } from './storage.service.js';
import { StorageUploadInterceptor } from './storage-upload.interceptor.js';

@Module({
  controllers: [StorageController],
  providers: [StorageService, AccessTokenGuard, RolesGuard, Sprint2UserRateLimitGuard, StorageUploadInterceptor],
})
export class StorageModule {}
