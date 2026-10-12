import { Controller,Get,HttpException,Req,Res } from '@nestjs/common';
import { ApiOperation,ApiResponse,ApiTags } from '@nestjs/swagger';
import type { Request,Response } from 'express';
import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { PrismaService } from '../database/prisma.service.js';
import { RedisService } from '../redis/redis.service.js';
import { positiveIntegerEnv } from '../config/environment.js';
import { vnpaySandboxConfig } from './vnpay-config.js';
import { consumeVnpayIpn } from './vnpay-ipn.js';
import { PaymentRealtimeService } from './payment-realtime.service.js';

@ApiTags('payment-provider')
@Controller('payments/vnpay')
export class VnpayIpnController {
  constructor(private readonly prisma:PrismaService,private readonly redis:RedisService,private readonly realtime:PaymentRealtimeService) {}
  @Get('ipn')
  @ApiOperation({summary:'VNPay Sandbox server IPN; provider ACK is not a booking payment response'})
  @ApiResponse({status:200,schema:{type:'object',required:['RspCode','Message'],properties:{RspCode:{type:'string',enum:['00','01','04','97','99']},Message:{type:'string'}}}})
  @ApiResponse({status:429,description:'Temporary IP limit, Retry-After: 60'})
  @ApiResponse({status:503,description:'Sandbox off/unconfigured or recording unavailable; retry notification'})
  async ipn(@Req() req:Request,@Res() res:Response) {
    res.setHeader('Cache-Control','no-store');
    const reply=(code:string,message:string,status=200)=>res.status(status).json({RspCode:code,Message:message});
    try {
      const config=vnpaySandboxConfig(); // Validate before Redis/DB; never log request/config.
      const limit=positiveIntegerEnv('VNPAY_IPN_IP_LIMIT_PER_MINUTE',240);
      if(limit>10000)return reply('99','Notification unavailable',503);
      // Socket peer only. Ordinary forwarding/signature headers cannot reset this bucket.
      const ip=req.socket.remoteAddress??'';
      if(!isIP(ip))return reply('99','Notification unavailable',503);
      const count=await this.redis.incrementWithTtl(`vnpay:ipn:ip:${createHash('sha256').update(ip).digest('hex')}`,60);
      if(count>limit){res.setHeader('Retry-After','60');return reply('99','Too many notifications',429);}
      const index=req.originalUrl.indexOf('?'),query=index<0?'':req.originalUrl.slice(index+1);
      const result=await consumeVnpayIpn(this.prisma,config,query);
      if(result.outcome==='APPLIED' && 'bookingId' in result) await this.realtime.publishCommitted(result.bookingId);
      if(result.outcome==='REVIEW' && result.reasonCode==='AMOUNT_MISMATCH')return reply('04','Invalid amount');
      // Only ACK durable commit / authenticated failure; never exposes booking IDs or financial state.
      return reply('00','Notification received');
    } catch(error) {
      if(error instanceof HttpException) {
        const body=error.getResponse(),code=typeof body==='object' && body!==null && 'errorCode' in body?body.errorCode:undefined;
        if(code==='INVALID_VNPAY_SIGNATURE')return reply('97','Invalid signature');
        if(code==='PAYMENT_SESSION_NOT_FOUND')return reply('01','Order not found');
        if(error.getStatus()===503)return reply('99','Notification unavailable',503);
        return reply('99','Invalid notification');
      }
      return reply('99','Notification unavailable',503);
    }
  }
}
