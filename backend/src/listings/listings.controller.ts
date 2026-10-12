import { Body, Controller, Delete, Get, Header, HttpCode, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { ApiBearerAuth, ApiExtraModels, ApiOperation, ApiParam, ApiResponse, ApiTags, getSchemaPath } from '@nestjs/swagger';
import { AccessTokenGuard } from '../auth/access-token.guard.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { ApiEnvelopedResponses } from '../common/api-docs.js';
import { AvailabilityActionDto, CreateListingDto, ListingIdDto, ListingSlugDto, ListingsPageDto, SearchListingsDto, UpdateListingDto, VersionActionDto } from './listings.dto.js';
import { ListingsService } from './listings.service.js';
import { ListingsManagementService } from './listings-management.service.js';
import { Sprint2IpRateLimitGuard, Sprint2UserRateLimitGuard } from '../common/sprint2-rate-limit.guard.js';
import { CostEstimateDto, CostEstimateLineDto, CostEstimateQueryDto } from './long-term-estimate.dto.js';
import { ListingContactRateLimitGuard, OptionalContactTokenGuard } from './listing-contact.guard.js';

@ApiTags('long-term-listings')
@ApiExtraModels(CostEstimateDto, CostEstimateLineDto)
@Controller()
@UseGuards(Sprint2IpRateLimitGuard)
@ApiResponse({ status: 429, description: 'Sprint 2 shared IP/user request rate exceeded; errorCode RATE_LIMITED' })
@ApiResponse({ status: 503, description: 'Request rate limiter unavailable; errorCode RATE_LIMIT_UNAVAILABLE' })
export class ListingsController {
  constructor(private readonly listings: ListingsService, private readonly management: ListingsManagementService) {}

  @Get('properties/long-term/search')
  @ApiOperation({ summary: 'Search published long-term listings; radius is in meters; all selected amenities are required (AND)' })
  @ApiResponse({ status: 200, description: 'success/message/data[]/meta {page,limit,total,totalPages}' })
  search(@Query() query: SearchListingsDto) { return this.listings.search(query); }

  @Get('properties/:slug/cost-estimate') @Header('Cache-Control', 'no-store')
  @ApiParam({ name: 'slug', schema: { type: 'string', maxLength: 300 } })
  @ApiOperation({ summary: 'D12: published long-term listing monthly estimate; exact Decimal rates, rounded VND lines; no usage storage' })
  @ApiEnvelopedResponses({ type: 'object', allOf: [{ $ref: getSchemaPath(CostEstimateDto) }] }, 200, [400, 404, 429, 503])
  estimate(@Param() params: ListingSlugDto, @Query() query: CostEstimateQueryDto) { return this.listings.costEstimate(params.slug, query); }

  @Get('properties/:slug/contact') @Header('Cache-Control', 'no-store')
  @UseGuards(OptionalContactTokenGuard, ListingContactRateLimitGuard)
  @ApiParam({ name: 'slug', schema: { type: 'string', maxLength: 300 } })
  @ApiOperation({ summary: 'Owner-approved contact reveal for published long-term listings; optional valid Bearer, temporary IP/account counters; no lead storage' })
  @ApiEnvelopedResponses({ type: 'object', required: ['contactPhone', 'contactZalo'], properties: { contactPhone: { type: 'string' }, contactZalo: { type: 'string', nullable: true } } }, 200, [400, 401, 404, 429, 503])
  contact(@Param() params: ListingSlugDto) { return this.listings.contact(params.slug); }

  @Get('properties/:slug')
  @ApiParam({ name: 'slug', schema: { type: 'string', maxLength: 300 } })
  @ApiOperation({ summary: 'Read a published listing; unpublished listings return 404' })
  detail(@Param() params: ListingSlugDto) { return this.listings.detail(params.slug); }

  @Get('amenities')
  @ApiOperation({ summary: 'Amenity catalog' })
  amenities() { return this.listings.amenities(); }

  @Get('admin/properties')
  @UseGuards(AccessTokenGuard, RolesGuard, Sprint2UserRateLimitGuard) @Roles('ADMIN') @ApiBearerAuth()
  @ApiOperation({ summary: 'Minimal review queue: pending listings and pending revisions, without deleted records' })
  reviewQueue(@Query() query: ListingsPageDto) { return this.management.list(query); }

  @Get('admin/properties/:id')
  @UseGuards(AccessTokenGuard, RolesGuard, Sprint2UserRateLimitGuard) @Roles('ADMIN') @ApiBearerAuth()
  @ApiOperation({ summary: 'Read content/revision and expectedVersion before approval; Admin only' })
  reviewDetail(@Param() params: ListingIdDto) { return this.management.reviewDetail(params.id); }

  @Post('admin/properties/:id/approve')
  @HttpCode(200)
  @UseGuards(AccessTokenGuard, RolesGuard, Sprint2UserRateLimitGuard) @Roles('ADMIN') @ApiBearerAuth()
  @ApiOperation({ summary: 'Minimal Sprint 2 review: PENDING_REVIEW → PUBLISHED (owner-approved scope exception)' })
  @ApiEnvelopedResponses({ type: 'object', required: ['id','status','version'], properties: { id: { type: 'string', format: 'uuid' }, version: { type: 'integer' }, status: { type: 'string', enum: ['PUBLISHED','HIDDEN'] } } }, 200, [400,401,403,404,409])
  approve(@Req() request: Request, @Param() params: ListingIdDto, @Body() body: VersionActionDto) { return this.management.review(request.user!.id, params.id, body.expectedVersion, 'PUBLISHED'); }

  @Post('admin/properties/:id/reject')
  @HttpCode(200)
  @UseGuards(AccessTokenGuard, RolesGuard, Sprint2UserRateLimitGuard) @Roles('ADMIN') @ApiBearerAuth()
  @ApiOperation({ summary: 'Minimal Sprint 2 review: PENDING_REVIEW → REJECTED' })
  @ApiEnvelopedResponses({ type: 'object', required: ['id','status','version'], properties: { id: { type: 'string', format: 'uuid' }, version: { type: 'integer' }, status: { type: 'string', enum: ['REJECTED','PUBLISHED','HIDDEN'] } } }, 200, [400,401,403,404,409])
  reject(@Req() request: Request, @Param() params: ListingIdDto, @Body() body: VersionActionDto) { return this.management.review(request.user!.id, params.id, body.expectedVersion, 'REJECTED'); }

  @Post('properties/long-term')
  @UseGuards(AccessTokenGuard, RolesGuard, Sprint2UserRateLimitGuard) @Roles('HOST') @ApiBearerAuth()
  @ApiOperation({ summary: 'Submit free long-term listing as PENDING_REVIEW; media server/catalog must be available for their dependent inputs' })
  create(@Req() request: Request, @Body() body: CreateListingDto) { return this.management.create(request.user!.id, body); }

  @Get('host/properties')
  @UseGuards(AccessTokenGuard, RolesGuard, Sprint2UserRateLimitGuard) @Roles('HOST') @ApiBearerAuth()
  @ApiOperation({ summary: 'Own long-term listings, including unpublished content and revisions; never another owner' })
  ownList(@Req() request: Request, @Query() query: ListingsPageDto) { return this.management.list(query, request.user!.id); }

  @Get('host/properties/:id')
  @UseGuards(AccessTokenGuard, RolesGuard, Sprint2UserRateLimitGuard) @Roles('HOST') @ApiBearerAuth()
  @ApiOperation({ summary: 'Read own listing including pending revision; other owners receive 404' })
  own(@Req() request: Request, @Param() params: ListingIdDto) { return this.management.own(request.user!.id, params.id); }

  @Put('host/properties/:id')
  @UseGuards(AccessTokenGuard, RolesGuard, Sprint2UserRateLimitGuard) @Roles('HOST') @ApiBearerAuth()
  @ApiOperation({ summary: 'Submit full replacement; published content remains until Admin approves pending revision' })
  update(@Req() request: Request, @Param() params: ListingIdDto, @Body() body: UpdateListingDto) { return this.management.update(request.user!.id, params.id, body); }

  @Post('host/properties/:id/hide') @HttpCode(200)
  @UseGuards(AccessTokenGuard, RolesGuard, Sprint2UserRateLimitGuard) @Roles('HOST') @ApiBearerAuth()
  hide(@Req() request: Request, @Param() params: ListingIdDto, @Body() body: VersionActionDto) { return this.management.visibility(request.user!.id, params.id, body.expectedVersion, 'HIDDEN'); }

  @Post('host/properties/:id/show') @HttpCode(200)
  @UseGuards(AccessTokenGuard, RolesGuard, Sprint2UserRateLimitGuard) @Roles('HOST') @ApiBearerAuth()
  show(@Req() request: Request, @Param() params: ListingIdDto, @Body() body: VersionActionDto) { return this.management.visibility(request.user!.id, params.id, body.expectedVersion, 'PUBLISHED'); }

  @Post('host/properties/:id/availability') @HttpCode(200)
  @UseGuards(AccessTokenGuard, RolesGuard, Sprint2UserRateLimitGuard) @Roles('HOST') @ApiBearerAuth()
  availability(@Req() request: Request, @Param() params: ListingIdDto, @Body() body: AvailabilityActionDto) { return this.management.availability(request.user!.id, params.id, body.expectedVersion, body.isAvailable); }

  @Delete('host/properties/:id')
  @UseGuards(AccessTokenGuard, RolesGuard, Sprint2UserRateLimitGuard) @Roles('HOST') @ApiBearerAuth()
  remove(@Req() request: Request, @Param() params: ListingIdDto, @Body() body: VersionActionDto) { return this.management.remove(request.user!.id, params.id, body.expectedVersion); }
}
