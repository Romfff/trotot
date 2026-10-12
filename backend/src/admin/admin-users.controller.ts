import { Body, Controller, Get, Header, HttpCode, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiExtraModels, ApiResponse, ApiTags, getSchemaPath } from '@nestjs/swagger';
import type { Request } from 'express';
import { AccessTokenGuard } from '../auth/access-token.guard.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { Sprint2IpRateLimitGuard,Sprint2UserRateLimitGuard } from '../common/sprint2-rate-limit.guard.js';
import { ListingIdDto } from '../listings/listings.dto.js';
import { ApiEnvelopedResponses } from '../common/api-docs.js';
import { AdminUsersService } from './admin-users.service.js';
import { AdminUserResponseDto,AdminUsersQueryDto,ModerateUserDto } from './admin-users.dto.js';

@ApiTags('admin-users') @ApiBearerAuth() @ApiExtraModels(AdminUserResponseDto)
@Controller('admin/users') @UseGuards(Sprint2IpRateLimitGuard,AccessTokenGuard,RolesGuard,Sprint2UserRateLimitGuard) @Roles('ADMIN')
export class AdminUsersController {
  constructor(private readonly users:AdminUsersService) {}
  @Get() @Header('Cache-Control','no-store')
  @ApiResponse({status:200,schema:{type:'object',properties:{success:{type:'boolean'},message:{type:'string'},data:{type:'array',items:{$ref:getSchemaPath(AdminUserResponseDto)}},meta:{type:'object',properties:{page:{type:'integer'},limit:{type:'integer'},total:{type:'integer'},totalPages:{type:'integer'}}}}}})
  list(@Query() query:AdminUsersQueryDto){return this.users.list(query);}
  @Post(':id/ban') @HttpCode(200) @Header('Cache-Control','no-store')
  @ApiEnvelopedResponses({allOf:[{$ref:getSchemaPath(AdminUserResponseDto)}]},200,[400,401,403,404,409,429])
  ban(@Req() req:Request,@Param() params:ListingIdDto,@Body() body:ModerateUserDto){return this.users.moderate(req.user!.id,params.id,'ban',body);}
  @Post(':id/unban') @HttpCode(200) @Header('Cache-Control','no-store')
  @ApiEnvelopedResponses({allOf:[{$ref:getSchemaPath(AdminUserResponseDto)}]},200,[400,401,403,404,409,429])
  unban(@Req() req:Request,@Param() params:ListingIdDto,@Body() body:ModerateUserDto){return this.users.moderate(req.user!.id,params.id,'unban',body);}
}
