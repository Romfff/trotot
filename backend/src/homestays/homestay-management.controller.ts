import { Body,Controller,Delete,Get,Header,Headers,HttpCode,Param,ParseUUIDPipe,Post,Put,Query,Req,UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { ApiBearerAuth,ApiTags,PickType } from '@nestjs/swagger';
import { AccessTokenGuard } from '../auth/access-token.guard.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { Sprint2IpRateLimitGuard,Sprint2UserRateLimitGuard } from '../common/sprint2-rate-limit.guard.js';
import { ListingIdDto,ListingSlugDto,ListingsPageDto,VersionActionDto } from '../listings/listings.dto.js';
import { HomestayUnitIdDto } from './homestay-availability.dto.js';
import { HomestayCalendarDto } from './homestay-availability.dto.js';
import { CreateHomestayDto,UpdateHomestayDto,UpdateHomestayUnitDto,HomestayCalendarBlockDto,HomestayCalendarPricingDto,HomestaySearchDto,HomestayFeeDto } from './homestay-management.dto.js';
import { HomestayManagementService } from './homestay-management.service.js';
class HostCalendarMonthDto extends PickType(HomestayCalendarDto,['month'] as const) {}

@ApiTags('homestays-public') @Controller('homestays') @UseGuards(Sprint2IpRateLimitGuard)
export class HomestayPublicController {
  constructor(private readonly service:HomestayManagementService) {}
  @Get('search') @Header('Cache-Control','no-store') search(@Query() q:HomestaySearchDto) {return this.service.search(q);}
  @Get(':slug') @Header('Cache-Control','no-store') detail(@Param() p:ListingSlugDto) {return this.service.detail(p.slug);}
}
@ApiTags('homestays-host') @ApiBearerAuth() @Controller('host')
@UseGuards(Sprint2IpRateLimitGuard,AccessTokenGuard,RolesGuard,Sprint2UserRateLimitGuard) @Roles('HOST')
export class HomestayHostController {
  constructor(private readonly service:HomestayManagementService) {}
  @Post('homestays') create(@Req() r:Request,@Body() b:CreateHomestayDto) {return this.service.create(r.user!.id,b);}
  @Get('homestays') @Header('Cache-Control','private, no-store') list(@Req() r:Request,@Query() q:ListingsPageDto) {return this.service.list(q,r.user!.id);}
  @Get('homestays/:id') @Header('Cache-Control','private, no-store') own(@Req() r:Request,@Param() p:ListingIdDto) {return this.service.own(p.id,r.user!.id);}
  @Put('homestays/:id') update(@Req() r:Request,@Param() p:ListingIdDto,@Body() b:UpdateHomestayDto) {return this.service.update(r.user!.id,p.id,b);}
  @Post('homestays/:id/units') unitCreate(@Req() r:Request,@Param() p:ListingIdDto,@Body() b:UpdateHomestayUnitDto) {return this.service.unit(r.user!.id,p.id,undefined,b);}
  @Put('homestays/:id/units/:unitId') unitUpdate(@Req() r:Request,@Param('id',new ParseUUIDPipe()) id:string,@Param('unitId',new ParseUUIDPipe()) unitId:string,@Body() b:UpdateHomestayUnitDto) {return this.service.unit(r.user!.id,id,unitId,b);}
  @Post('homestays/:id/hide') @HttpCode(200) hide(@Req() r:Request,@Param() p:ListingIdDto,@Body() b:VersionActionDto) {return this.service.visibility(r.user!.id,p.id,b.expectedVersion,'HIDDEN');}
  @Post('homestays/:id/show') @HttpCode(200) show(@Req() r:Request,@Param() p:ListingIdDto,@Body() b:VersionActionDto) {return this.service.visibility(r.user!.id,p.id,b.expectedVersion,'PUBLISHED');}
  @Delete('homestays/:id') remove(@Req() r:Request,@Param() p:ListingIdDto,@Body() b:VersionActionDto) {return this.service.remove(r.user!.id,p.id,b.expectedVersion);}
  @Delete('homestays/:id/units/:unitId') removeUnit(@Req() r:Request,@Param('id',new ParseUUIDPipe()) id:string,@Param('unitId',new ParseUUIDPipe()) unitId:string,@Body() b:VersionActionDto) {return this.service.remove(r.user!.id,id,b.expectedVersion,unitId);}
  @Get('calendar/:unitId') @Header('Cache-Control','private, no-store') calendar(@Req() r:Request,@Param() p:HomestayUnitIdDto,@Query() q:HostCalendarMonthDto) {return this.service.hostCalendar(r.user!.id,p.unitId,q.month);}
  @Put('calendar/:unitId/pricing') pricing(@Req() r:Request,@Param() p:HomestayUnitIdDto,@Body() b:HomestayCalendarPricingDto,@Headers('idempotency-key') key:string) {return this.service.calendarWrite(r.user!.id,p.unitId,b,key,r.body);}
  @Post('calendar/:unitId/toggle-block') @HttpCode(200) block(@Req() r:Request,@Param() p:HomestayUnitIdDto,@Body() b:HomestayCalendarBlockDto,@Headers('idempotency-key') key:string) {return this.service.calendarWrite(r.user!.id,p.unitId,b,key,r.body);}
}
@ApiTags('homestays-admin-minimal') @ApiBearerAuth() @Controller('admin')
@UseGuards(Sprint2IpRateLimitGuard,AccessTokenGuard,RolesGuard,Sprint2UserRateLimitGuard) @Roles('ADMIN')
export class HomestayAdminController {
  constructor(private readonly service:HomestayManagementService) {}
  @Get('homestays') @Header('Cache-Control','private, no-store') list(@Query() q:ListingsPageDto) {return this.service.list(q);}
  @Get('homestays/:id') @Header('Cache-Control','private, no-store') detail(@Param() p:ListingIdDto) {return this.service.own(p.id);}
  @Post('homestays/:id/approve') @HttpCode(200) approve(@Req() r:Request,@Param() p:ListingIdDto,@Body() b:VersionActionDto) {return this.service.review(r.user!.id,p.id,b.expectedVersion,true);}
  @Post('homestays/:id/reject') @HttpCode(200) reject(@Req() r:Request,@Param() p:ListingIdDto,@Body() b:VersionActionDto) {return this.service.review(r.user!.id,p.id,b.expectedVersion,false);}
  @Put('homestays/units/:unitId/fees') fees(@Req() r:Request,@Param() p:HomestayUnitIdDto,@Body() b:HomestayFeeDto) {return this.service.fees(r.user!.id,p.unitId,b);}
}
