import { Injectable,Logger, type OnModuleInit,type OnModuleDestroy } from '@nestjs/common';
import { Queue,Worker } from 'bullmq';
import { PrismaService } from '../database/prisma.service.js';
import { RedisService } from '../redis/redis.service.js';
import { BookingExpiryService } from './booking-expiry.service.js';
import { BookingsService } from './bookings.service.js';
import { HomestayCalendarService } from '../homestays/homestay-calendar.service.js';

@Injectable()
export class BookingWorkerService implements OnModuleInit,OnModuleDestroy {
  private readonly logger=new Logger(BookingWorkerService.name);
  private queue!:Queue;
  private worker!:Worker;
  private busy=false;
  private stopped=false;
  private reconciliation?:Promise<void>;
  private timer?:ReturnType<typeof setInterval>;
  constructor(private readonly prisma:PrismaService,private readonly redis:RedisService,private readonly expiry:BookingExpiryService,
    private readonly bookings:BookingsService,private readonly calendar:HomestayCalendarService) {}
  async onModuleInit() {
    const connection={host:this.redis.client.options.host,port:this.redis.client.options.port,password:this.redis.client.options.password,maxRetriesPerRequest:null};
    const prefix=`${process.env.REDIS_KEY_PREFIX||''}booking-queue`;
    this.queue=new Queue('booking-expiry',{connection:{...connection,maxRetriesPerRequest:2,connectTimeout:5000},prefix});
    this.worker=new Worker('booking-expiry',async job=>{
      if(typeof job.data?.bookingId==='string') await this.expire(job.data.bookingId);
    },{connection,prefix,concurrency:4});
    this.queue.on('error',()=>this.logger.warn('Booking expiry queue unavailable; reconciliation will retry.'));
    this.worker.on('error',()=>this.logger.warn('Booking expiry worker unavailable; reconciliation will retry.'));
    await this.reconcile();
    this.timer=setInterval(()=>{void this.reconcile();},15_000);
    this.timer.unref();
  }
  async expire(id:string) {
    const booking=await this.prisma.booking.findUnique({where:{id},select:{homestayUnitId:true,inventoryLock:true}});
    if(booking && await this.expiry.expire(id)) {
      await this.bookings.releaseLock(booking.inventoryLock);
      try {await this.calendar.invalidate(booking.homestayUnitId);} catch {this.logger.warn('Expiry calendar invalidation delayed by Redis outage.');}
    }
  }
  reconcile():Promise<void> {
    if(this.stopped) return Promise.resolve();
    if(this.busy) return this.reconciliation!;
    this.busy=true;
    this.reconciliation=this.scanPending();
    return this.reconciliation;
  }
  private async scanPending() {
    try {
      // Recover deadlines committed before a crash/queue outage without relying on a client clock.
      // ponytail: scan pending rows every 15s; use a due-date cursor/outbox if pending volume makes this costly.
      let after:string|undefined;
      for(;;) {
        if(this.stopped) break;
        const rows=await this.prisma.booking.findMany({where:{bookingStatus:{in:['PENDING_PAYMENT','PENDING_HOST_APPROVAL']},paymentStatus:{in:['NOT_CONFIGURED','PENDING']}},
          orderBy:{id:'asc'},take:100,...(after?{cursor:{id:after},skip:1}:{}),select:{id:true,expiresAt:true,version:true}});
        const [{now}]=await this.prisma.$queryRaw<{now:Date}[]>`SELECT clock_timestamp() AS now`;
        for(const row of rows) {
          if(this.stopped) break;
          if(row.expiresAt<=now) await this.expire(row.id);
          else await this.queue.add('expire',{bookingId:row.id},{jobId:`${row.id}-${row.version}`,delay:row.expiresAt.getTime()-now.getTime(),
            attempts:10,backoff:{type:'exponential',delay:1000},removeOnComplete:true,removeOnFail:100});
        }
        if(rows.length<100) break;
        after=rows.at(-1)!.id;
      }
    } catch {this.logger.warn('Booking reconciliation failed; retries in 15 seconds.');}
    finally {this.busy=false;}
  }
  async onModuleDestroy() {
    this.stopped=true;
    if(this.timer) clearInterval(this.timer);
    await this.reconciliation;
    await this.worker?.close();await this.queue?.close();
  }
}
