import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { AppointmentsService } from './appointments.service.js';

@Injectable()
export class AppointmentWorkerService implements OnModuleInit,OnModuleDestroy {
  private readonly logger=new Logger(AppointmentWorkerService.name);
  private timer?:ReturnType<typeof setInterval>;
  private pending?:Promise<void>;
  private stopped=false;
  constructor(private readonly appointments:AppointmentsService) {}
  async onModuleInit() {
    await this.reconcile();
    this.timer=setInterval(()=>{void this.reconcile();},15000);this.timer.unref();
  }
  reconcile():Promise<void> {
    if(this.stopped) return Promise.resolve();
    if(this.pending) return this.pending;
    this.pending=this.scan().finally(()=>{this.pending=undefined;});
    return this.pending;
  }
  private async scan() {
    try {
      // ponytail: DB-backed 15s sweep recovers restarts; move to BullMQ scheduling if due volume warrants it.
      for(let batches=0;!this.stopped && batches<100;batches++) if(await this.appointments.expirePending()<100) break;
    } catch {this.logger.warn('Appointment expiry delayed; retrying on the next sweep.');}
  }
  async onModuleDestroy() {this.stopped=true;if(this.timer) clearInterval(this.timer);await this.pending;}
}
