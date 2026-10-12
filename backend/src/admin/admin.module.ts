import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { ChatModule } from '../chat/chat.module.js';
import { AdminUsersController } from './admin-users.controller.js';
import { AdminUsersService } from './admin-users.service.js';
import { AdminDashboardService } from './admin-dashboard.service.js';
import { AdminDashboardController } from './admin-dashboard.controller.js';
@Module({imports:[AuthModule,ChatModule],controllers:[AdminUsersController,AdminDashboardController],providers:[AdminUsersService,AdminDashboardService]})
export class AdminModule {}
