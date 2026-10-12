import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { BookingsModule } from '../bookings/bookings.module.js';
import { ChatService } from './chat.service.js';
import { ChatRealtimeService } from './chat-realtime.service.js';
import { ChatController } from './chat.controller.js';
@Module({imports:[AuthModule,BookingsModule],controllers:[ChatController],providers:[ChatService,ChatRealtimeService],exports:[ChatRealtimeService]})
export class ChatModule {}
