import { ApiProperty,ApiPropertyOptional,PickType } from '@nestjs/swagger';
import { Transform,Type } from 'class-transformer';
import { ArrayMaxSize,ArrayMinSize,ArrayUnique,IsArray,IsBoolean,IsIn,IsInt,IsNumber,IsOptional,IsString,Length,Matches,Max,Min,ValidateIf,ValidateNested } from 'class-validator';
import { CreateListingDto,VersionActionDto,ListingsPageDto } from '../listings/listings.dto.js';

export class HomestayPropertyDto extends PickType(CreateListingDto,['title','description','addressDetail','provinceCode','wardCode','latitude','longitude','amenityIds','imageUrls','videoUrl'] as const) {
  @ApiProperty({enum:['HOMESTAY','VILLA']}) @IsIn(['HOMESTAY','VILLA']) propertyType!:string;
}
export class HomestayUnitDto {
  @ApiProperty() @IsString() @Length(1,150) unitName!:string;
  @ApiProperty() @IsInt() @Min(1) @Max(10000) maxAdults!:number;
  @ApiProperty() @IsInt() @Min(0) @Max(10000) maxChildren!:number;
  @ApiPropertyOptional({nullable:true}) @IsOptional() @IsInt() @Min(1) @Max(10000) maxGuests?:number|null;
  @ApiProperty({default:90}) @IsInt() @Min(1) @Max(90) maxNights=90;
  @ApiProperty() @IsInt() @Min(0) @Max(10000) bedrooms!:number;
  @ApiProperty() @IsInt() @Min(0) @Max(10000) bathrooms!:number;
  @ApiProperty() @IsNumber({maxDecimalPlaces:2}) @Min(0) @Max(9999999999999.99) basePricePerNight!:number;
  @ApiPropertyOptional({nullable:true}) @IsOptional() @IsNumber({maxDecimalPlaces:2}) @Min(0) @Max(9999999999999.99) weekendPricePerNight?:number|null;
  @ApiProperty() @IsNumber({maxDecimalPlaces:2}) @Min(0) @Max(9999999999.99) cleaningFee!:number;
  @ApiProperty() @Matches(/^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/) checkInTime!:string;
  @ApiProperty() @Matches(/^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/) checkOutTime!:string;
  @ApiProperty({default:'18:00:00'}) @Matches(/^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/) sameDayBookingCutoff='18:00:00';
  @ApiProperty({enum:['FLEXIBLE','MODERATE','STRICT']}) @IsIn(['FLEXIBLE','MODERATE','STRICT']) cancellationPolicy!:string;
  @ApiProperty() @IsBoolean() instantBook!:boolean;
}
export class CreateHomestayDto extends HomestayPropertyDto {
  @ApiProperty({type:[HomestayUnitDto]}) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ValidateNested({each:true}) @Type(()=>HomestayUnitDto) units!:HomestayUnitDto[];
}
export class UpdateHomestayDto extends HomestayPropertyDto {
  @ApiProperty() @IsInt() @Min(1) @Max(2147483646) expectedVersion!:number;
}
export class UpdateHomestayUnitDto extends HomestayUnitDto {
  @ApiProperty() @IsInt() @Min(1) @Max(2147483646) expectedVersion!:number;
}
export class HomestayCalendarWriteDto extends VersionActionDto {
  @ApiProperty({type:[String]}) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(366) @ArrayUnique() @Matches(/^\d{4}-\d{2}-\d{2}$/,{each:true}) dates!:string[];
}
export class HomestayCalendarPricingDto extends HomestayCalendarWriteDto {
  @ApiProperty({nullable:true}) @ValidateIf((_object,value)=>value!==null) @IsNumber({maxDecimalPlaces:2}) @Min(0) @Max(9999999999999.99) customPrice!:number|null;
}
export class HomestayCalendarBlockDto extends HomestayCalendarWriteDto {
  @ApiProperty() @IsBoolean() isBlocked!:boolean;
}
export class HomestaySearchDto extends ListingsPageDto {
  @ApiPropertyOptional() @IsOptional() @Matches(/^\d{2}$/) provinceCode?:string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1,200) q?:string;
  @ApiPropertyOptional() @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) checkIn?:string;
  @ApiPropertyOptional() @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) checkOut?:string;
  @ApiPropertyOptional() @IsOptional() @Transform(({value})=>typeof value==='string'&&/^\d+$/.test(value)?Number(value):value) @IsInt() @Min(1) @Max(10000) adults?:number;
  @ApiPropertyOptional() @IsOptional() @Transform(({value})=>typeof value==='string'&&/^\d+$/.test(value)?Number(value):value) @IsInt() @Min(0) @Max(10000) children?:number;
}
export class HomestayFeeDto extends VersionActionDto {
  @ApiProperty() @IsNumber({maxDecimalPlaces:2}) @Min(0) @Max(100) serviceFeeRate!:number;
  @ApiProperty() @IsNumber({maxDecimalPlaces:2}) @Min(0) @Max(100) taxRate!:number;
  @ApiProperty() @IsNumber({maxDecimalPlaces:2}) @Min(8) @Max(12) commissionRate!:number;
}
