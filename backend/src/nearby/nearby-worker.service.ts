import { Injectable,Logger,type OnModuleInit,type OnModuleDestroy } from '@nestjs/common';
import { Queue,Worker } from 'bullmq';
import { RedisService } from '../redis/redis.service.js';
import { nearbyEnabled } from './nearby-policy.js';
import { NearbySnapshotService } from './nearby-snapshot.service.js';
@Injectable()
export class NearbyWorkerService implements OnModuleInit,OnModuleDestroy {
 private readonly logger=new Logger(NearbyWorkerService.name);
 private queue?:Queue;private worker?:Worker;private timer?:ReturnType<typeof setInterval>;private pending?:Promise<void>;private stopped=false;
 constructor(private readonly redis:RedisService,private readonly snapshots:NearbySnapshotService){}
 async onModuleInit(){
  if(!nearbyEnabled())return;
  const connection={host:this.redis.client.options.host,port:this.redis.client.options.port,password:this.redis.client.options.password,maxRetriesPerRequest:null};
  const prefix=`${process.env.REDIS_KEY_PREFIX||''}nearby-queue`;
  this.queue=new Queue('nearby',{connection:{...connection,maxRetriesPerRequest:2},prefix});
  this.worker=new Worker('nearby',async job=>{
   if(typeof job.data?.propertyId==='string'&&/^[a-f0-9-]{36}$/u.test(job.data.propertyId))await this.snapshots.generate(job.data.propertyId);
  },{connection,prefix,concurrency:1,settings:{backoffStrategy:attempt=>[60000,300000,1800000][Math.min(attempt-1,2)]+Math.floor(Math.random()*10000)}});
  this.queue.on('error',()=>this.logger.warn('Nearby queue unavailable; DB reconciliation will retry.'));
  this.worker.on('error',()=>this.logger.warn('Nearby worker unavailable.'));
  await this.reconcile();this.timer=setInterval(()=>void this.reconcile(),60000);this.timer.unref();
 }
 reconcile():Promise<void>{
  if(this.stopped||!nearbyEnabled()||!this.queue)return Promise.resolve();
  if(this.pending)return this.pending;
  this.pending=(async()=>{
   try{await this.snapshots.cleanupRequests();for(const {id} of await this.snapshots.due()){
    if(this.stopped)break;
    await this.queue!.add('snapshot',{propertyId:id},{jobId:id,attempts:4,backoff:{type:'nearby'},removeOnComplete:true,removeOnFail:true});
   }}catch{this.logger.warn('Nearby reconciliation failed; retries in one minute.');}
  })().finally(()=>{this.pending=undefined;});return this.pending;
 }
 async onModuleDestroy(){this.stopped=true;if(this.timer)clearInterval(this.timer);await this.pending;await this.worker?.close();await this.queue?.close();}
}
