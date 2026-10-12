import { Module } from '@nestjs/common';
import { AccessTokenGuard } from './access-token.guard.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { RolesGuard } from './roles.guard.js';
import { UsersModule } from '../users/users.module.js';
import { Sprint2IpRateLimitGuard, Sprint2UserRateLimitGuard } from '../common/sprint2-rate-limit.guard.js';

@Module({
  imports: [UsersModule],
  controllers: [AuthController],
  providers: [AuthService, AccessTokenGuard, RolesGuard, Sprint2IpRateLimitGuard, Sprint2UserRateLimitGuard],
  exports: [AccessTokenGuard, RolesGuard, Sprint2IpRateLimitGuard, Sprint2UserRateLimitGuard],
})
export class AuthModule {}
