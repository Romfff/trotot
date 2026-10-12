import { Controller,Get,Header,Query,UseGuards } from '@nestjs/common';
import { ApiBearerAuth,ApiExtraModels,ApiTags,getSchemaPath } from '@nestjs/swagger';
import { AccessTokenGuard } from '../auth/access-token.guard.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { Sprint2IpRateLimitGuard,Sprint2UserRateLimitGuard } from '../common/sprint2-rate-limit.guard.js';
import { ApiEnvelopedResponses } from '../common/api-docs.js';
import { DashboardQueryDto,DashboardResponseDto,DashboardMoneyDto } from './admin-dashboard.dto.js';
import { AdminDashboardService } from './admin-dashboard.service.js';
@Controller('admin/dashboard') @ApiTags('admin-dashboard') @ApiBearerAuth() @ApiExtraModels(DashboardResponseDto,DashboardMoneyDto)
@UseGuards(Sprint2IpRateLimitGuard,AccessTokenGuard,RolesGuard,Sprint2UserRateLimitGuard) @Roles('ADMIN')
export class AdminDashboardController {
  constructor(private readonly dashboard:AdminDashboardService) {}
  @Get() @Header('Cache-Control','no-store')
  @ApiEnvelopedResponses({allOf:[{$ref:getSchemaPath(DashboardResponseDto)}]},200,[400,401,403,429,503])
  read(@Query() query:DashboardQueryDto){return this.dashboard.read(query.from,query.to);}
}
