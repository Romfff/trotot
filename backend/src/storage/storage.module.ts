import { Module } from '@nestjs/common';
import { AccessTokenGuard } from '../auth/access-token.guard.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { StorageController } from './storage.controller.js';
import { StorageService } from './storage.service.js';

@Module({
  controllers: [StorageController],
  providers: [StorageService, AccessTokenGuard, RolesGuard],
})
export class StorageModule {}
