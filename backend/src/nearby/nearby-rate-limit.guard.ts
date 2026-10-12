import {type CanActivate,type ExecutionContext,HttpException,Injectable,ServiceUnavailableException} from '@nestjs/common';
import type {Request} from 'express';
import {createHash} from 'node:crypto';
import {resolveClientIp} from '../auth/client-ip.js';
import {RedisService} from '../redis/redis.service.js';
@Injectable()
export class NearbyRateLimitGuard implements CanActivate {
 constructor(private readonly redis:RedisService){}
 async canActivate(context:ExecutionContext){
  const request=context.switchToHttp().getRequest<Request>();
  const ip=resolveClientIp(request)||request.socket.remoteAddress||'unknown';
  let count:number;
  try{count=await this.redis.incrementWithTtl(`nearby:limit:${createHash('sha256').update(ip).digest('hex')}`,60);}
  catch{throw new ServiceUnavailableException({errorCode:'RATE_LIMIT_UNAVAILABLE',message:'Vui lòng thử lại sau.'});}
  if(count>60)throw new HttpException({errorCode:'RATE_LIMITED',message:'Bạn thao tác quá nhanh. Vui lòng thử lại sau.',retryAfter:60},429);
  return true;
 }
}
