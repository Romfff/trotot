import { Body, Controller, Get, Header, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { ApiBearerAuth, ApiExtraModels, ApiOperation, ApiResponse, ApiTags, getSchemaPath } from '@nestjs/swagger';
import { AccessTokenGuard } from '../auth/access-token.guard.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { Sprint2IpRateLimitGuard, Sprint2UserRateLimitGuard } from '../common/sprint2-rate-limit.guard.js';
import { ApiEnvelopedResponses } from '../common/api-docs.js';
import { ListingIdDto, ListingSlugDto, ListingsPageDto } from '../listings/listings.dto.js';
import { CreateReviewDto, ReviewResponseDto } from './reviews.dto.js';
import { ReviewsService } from './reviews.service.js';

const item = {$ref:getSchemaPath(ReviewResponseDto)};
@ApiTags('verified-reviews') @ApiExtraModels(ReviewResponseDto)
@Controller() @UseGuards(Sprint2IpRateLimitGuard)
export class ReviewsController {
  constructor(private readonly reviews:ReviewsService) {}
  @Post('bookings/:id/review') @Header('Cache-Control','no-store') @ApiBearerAuth()
  @UseGuards(AccessTokenGuard,RolesGuard,Sprint2UserRateLimitGuard) @Roles('TENANT','HOST')
  @ApiOperation({summary:'One review by own guest of COMPLETED booking; no booking/payment mutation'})
  @ApiEnvelopedResponses({allOf:[item]},201,[400,401,403,404,409,429])
  create(@Req() req:Request,@Param() params:ListingIdDto,@Body() dto:CreateReviewDto) {return this.reviews.create(req.user!.id,params.id,dto);}

  @Get('bookings/:id/review') @Header('Cache-Control','no-store') @ApiBearerAuth()
  @UseGuards(AccessTokenGuard,RolesGuard,Sprint2UserRateLimitGuard) @Roles('TENANT','HOST')
  @ApiEnvelopedResponses({allOf:[item],nullable:true},200,[400,401,403,404,429])
  own(@Req() req:Request,@Param() params:ListingIdDto) {return this.reviews.own(req.user!.id,params.id);}

  @Get('properties/:slug/reviews') @Header('Cache-Control','no-store')
  @ApiOperation({summary:'Public reviews for PUBLISHED listing only; no contact/booking/payment identifiers'})
  @ApiResponse({status:200,schema:{type:'object',required:['success','message','data','meta'],properties:{
    success:{type:'boolean'},message:{type:'string'},data:{type:'array',items:item},meta:{type:'object',required:['page','limit','total','totalPages'],properties:{
      page:{type:'integer'},limit:{type:'integer'},total:{type:'integer'},totalPages:{type:'integer'}}}}}})
  @ApiResponse({status:404,description:'Property missing/private/deleted/inactive Host'})
  list(@Param() params:ListingSlugDto,@Query() query:ListingsPageDto) {return this.reviews.list(params.slug,query.page,query.limit);}
}
