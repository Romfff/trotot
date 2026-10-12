import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { AppointmentsController } from './appointments.controller.js';
import { AppointmentsService } from './appointments.service.js';
import { AppointmentWorkerService } from './appointment-worker.service.js';
@Module({imports:[AuthModule],controllers:[AppointmentsController],providers:[AppointmentsService,AppointmentWorkerService]})
export class AppointmentsModule {}
