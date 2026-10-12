import { Transform } from 'class-transformer';
import { ArrayMaxSize, ArrayUnique, IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, IsUrl, Length, Matches, Max, MaxLength, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { normalizePhone } from '../auth/phone.js';

// Do not coerce blanks/arrays/booleans into valid numbers (Number('') === 0).
const queryNumber = ({ value }: { value: unknown }) => typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value) ? Number(value) : value;

export class SearchListingsDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) @Matches(/^[A-Za-z0-9_-]+$/)
  province?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) @Matches(/^[A-Za-z0-9_-]+$/)
  district?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(queryNumber) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(9999999999999.99)
  minPrice?: number;
  @ApiPropertyOptional() @IsOptional() @Transform(queryNumber) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(9999999999999.99)
  maxPrice?: number;
  @ApiPropertyOptional() @IsOptional() @Transform(queryNumber) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(9999.99)
  minArea?: number;
  @ApiPropertyOptional() @IsOptional() @Transform(queryNumber) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(9999.99)
  maxArea?: number;
  @ApiPropertyOptional({ example: 'air_cond,wifi,mezzanine' }) @IsOptional() @IsString() @MaxLength(1000) @Matches(/^[a-z0-9_]+(,[a-z0-9_]+)*$/)
  amenities?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(queryNumber) @IsNumber() @Min(-90) @Max(90)
  lat?: number;
  @ApiPropertyOptional() @IsOptional() @Transform(queryNumber) @IsNumber() @Min(-180) @Max(180)
  lng?: number;
  @ApiPropertyOptional({ description: 'Meters' }) @IsOptional() @Transform(queryNumber) @IsNumber() @Min(1) @Max(20000000)
  radius?: number;
  @ApiPropertyOptional({ enum: ['price_asc','price_desc','distance_asc','newest'], default: 'newest' })
  @IsIn(['price_asc','price_desc','distance_asc','newest'])
  sortBy: 'price_asc' | 'price_desc' | 'distance_asc' | 'newest' = 'newest';
  @ApiPropertyOptional({ default: 1 }) @Transform(queryNumber) @IsInt() @Min(1) @Max(1000000)
  page = 1;
  @ApiPropertyOptional({ default: 20, maximum: 100 }) @Transform(queryNumber) @IsInt() @Min(1) @Max(100)
  limit = 20;
}

export class ListingSlugDto {
  @IsString() @Length(1, 300)
  slug!: string;
}

export class ListingIdDto {
  @IsUUID()
  id!: string;
}

export class VersionActionDto {
  @ApiProperty({ minimum: 1, description: 'Version last read; rejects stale review/edit actions' })
  @IsInt() @Min(1) @Max(2147483646)
  expectedVersion!: number;
}

export class AvailabilityActionDto extends VersionActionDto {
  @ApiProperty() @IsBoolean()
  isAvailable!: boolean;
}

// 06 payload + owner-approved D06 fields/codes (recorded separately, original 06 unchanged).
export class CreateListingDto {
  @ApiProperty() @Transform(({ value }) => typeof value === 'string' ? value.trim() : value) @IsString() @Length(1,255)
  title!: string;
  @ApiProperty({ enum: ['PHONG_TRO','CHUNG_CU_MINI','NHA_NGUYEN_CAN','O_GHEP'] }) @IsIn(['PHONG_TRO','CHUNG_CU_MINI','NHA_NGUYEN_CAN','O_GHEP'])
  propertyType!: string;
  @ApiProperty() @IsString() @Length(1,10000)
  description!: string;
  @ApiPropertyOptional({ nullable: true, description: 'URL metadata only; not proof of video upload' })
  @IsOptional() @IsUrl({ protocols: ['http','https'], require_protocol: true }) @MaxLength(2048)
  videoUrl?: string | null;
  @ApiProperty() @IsString() @Length(1,255)
  addressDetail!: string;
  @ApiProperty() @IsString() @Matches(/^\d{2}$/)
  provinceCode!: string;
  @ApiPropertyOptional({ deprecated: true, description: 'Legacy field; omit for current administrative addresses' }) @IsOptional() @IsString() @MaxLength(20)
  districtCode?: string;
  @ApiProperty() @IsString() @Matches(/^\d{5}$/)
  wardCode!: string;
  @ApiProperty() @IsNumber() @Min(-90) @Max(90)
  latitude!: number;
  @ApiProperty() @IsNumber() @Min(-180) @Max(180)
  longitude!: number;
  @ApiProperty() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(9999999999999.99)
  monthlyPrice!: number;
  @ApiProperty() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(9999999999999.99)
  depositAmount!: number;
  @ApiProperty() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(9999.99)
  areaSqm!: number;
  @ApiProperty() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(9999999999.99)
  electricityCost!: number;
  @ApiProperty() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(9999999999.99)
  waterCost!: number;
  @ApiProperty({ enum: ['M3','PERSON'] }) @IsIn(['M3','PERSON'])
  waterUnit!: string;
  @ApiProperty() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(9999999999.99)
  internetCost!: number;
  @ApiProperty({ description: 'VND per room per month' }) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(9999999999.99)
  garbageCost!: number;
  @ApiProperty() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(9999999999.99)
  parkingFee!: number;
  @ApiProperty() @Transform(({ value }) => typeof value === 'string' ? normalizePhone(value) : value) @IsString() @Matches(/^\+?[0-9]{9,15}$/)
  contactPhone!: string;
  @ApiPropertyOptional() @IsOptional() @Transform(({ value }) => typeof value === 'string' ? normalizePhone(value) : value) @IsString() @Matches(/^\+?[0-9]{9,15}$/)
  contactZalo?: string;
  @ApiProperty() @IsBoolean()
  allowPets!: boolean;
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMaxSize(50) @ArrayUnique() @IsString({ each: true }) @Matches(/^[a-z0-9_]{1,50}$/, { each: true })
  amenityIds!: string[];
  @ApiProperty({ type: [String], maxItems: 15 }) @IsArray() @ArrayMaxSize(15) @ArrayUnique() @IsUrl({ protocols: ['https'], require_protocol: true }, { each: true }) @MaxLength(2048, { each: true })
  imageUrls!: string[];
}

export class UpdateListingDto extends CreateListingDto {
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) @Max(2147483646)
  expectedVersion!: number;
}

export class ListingsPageDto {
  @ApiPropertyOptional({ default: 1 }) @Transform(queryNumber) @IsInt() @Min(1) @Max(1000000)
  page = 1;
  @ApiPropertyOptional({ default: 20, maximum: 100 }) @Transform(queryNumber) @IsInt() @Min(1) @Max(100)
  limit = 20;
}
