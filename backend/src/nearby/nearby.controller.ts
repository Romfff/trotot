import {Body,Controller,Get,Header,Headers,Param,Patch,Query,Req,UseGuards} from '@nestjs/common';
import type {Request} from 'express';
import {ApiBearerAuth,ApiHeader,ApiOperation,ApiParam,ApiTags} from '@nestjs/swagger';
import {IsUUID} from 'class-validator';
import {AccessTokenGuard} from '../auth/access-token.guard.js';
import {RolesGuard} from '../auth/roles.guard.js';
import {Roles} from '../auth/roles.decorator.js';
import {ListingSlugDto} from '../listings/listings.dto.js';
import {Sprint2UserRateLimitGuard} from '../common/sprint2-rate-limit.guard.js';
import {NearbyRateLimitGuard} from './nearby-rate-limit.guard.js';
import {ApiEnvelopedResponses} from '../common/api-docs.js';
import {NearbyQueryDto,NearbyVisibilityDto,NearbyVisibilityParams,nearbyResponseSchema,nearbyMetaSchema,nearbyAdminSchema} from './nearby.dto.js';
import {NearbyService} from './nearby.service.js';
class NearbyAdminParams { @IsUUID() propertyId!:string; }
@ApiTags('nearby') @Controller() @UseGuards(NearbyRateLimitGuard)
export class NearbyController {
 constructor(private readonly nearby:NearbyService){}
 @Get('properties/:slug/nearby') @Header('Cache-Control','no-store')
 @ApiParam({name:'slug',type:String}) @ApiOperation({summary:'Approved nearby snapshot; no external provider request'})
 @ApiEnvelopedResponses(nearbyResponseSchema,200,[400,404,409,429,503],nearbyMetaSchema)
 read(@Param() params:ListingSlugDto,@Query() query:NearbyQueryDto){return this.nearby.read(params.slug,query);}
 @Get('admin/properties/:propertyId/nearby') @Header('Cache-Control','no-store')
 @UseGuards(AccessTokenGuard,RolesGuard,Sprint2UserRateLimitGuard) @Roles('ADMIN') @ApiBearerAuth()
 @ApiOperation({summary:'Admin-only current snapshot, including hidden POI and override versions'})
 @ApiEnvelopedResponses(nearbyAdminSchema,200,[400,401,403,404,429,503])
 adminRead(@Param() params:NearbyAdminParams){return this.nearby.adminRead(params.propertyId);}
 @Patch('admin/properties/:propertyId/nearby/:placeId/visibility') @Header('Cache-Control','no-store')
 @UseGuards(AccessTokenGuard,RolesGuard,Sprint2UserRateLimitGuard) @Roles('ADMIN') @ApiBearerAuth()
 @ApiOperation({summary:'Hide or show POI for one property; CAS, idempotency and append-only audit'})
 @ApiHeader({name:'Idempotency-Key',required:true,schema:{type:'string',minLength:8,maxLength:128}})
 @ApiEnvelopedResponses({type:'object',properties:{id:{type:'string'},hidden:{type:'boolean'},reason:{type:'string'},version:{type:'integer'}}},200,[400,401,403,404,409,429,503])
 visibility(@Req() request:Request,@Param() params:NearbyVisibilityParams,@Headers('idempotency-key') key:string,@Body() body:NearbyVisibilityDto){
  return this.nearby.visibility(request.user!.id,params.propertyId,params.placeId,key,body);
 }
}
