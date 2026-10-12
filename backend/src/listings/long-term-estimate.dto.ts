import { Allow, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { EstimateCode, EstimateStatus } from './long-term-estimate.js';

// Validate relevant usage in the calculator AFTER reading waterUnit. Irrelevant
// water queries must be ignored rather than rejected by a generic DTO validator.
export class CostEstimateQueryDto {
  @ApiPropertyOptional({ type: String, pattern: '^\\d+(\\.\\d)?$', description: 'kWh; default ceiling 10000, configurable' }) @IsOptional() @Allow()
  electricityKwh?: unknown;
  @ApiPropertyOptional({ type: String, pattern: '^\\d+(\\.\\d)?$', description: 'm³; ignored for PERSON; default ceiling 1000, configurable' }) @IsOptional() @Allow()
  waterM3?: unknown;
  @ApiPropertyOptional({ type: String, pattern: '^\\d+$', description: 'People; ignored for M3; default ceiling 20, configurable' }) @IsOptional() @Allow()
  occupants?: unknown;
  @ApiPropertyOptional({ type: String, pattern: '^\\d+$', description: 'Vehicles; no implicit quantity; default ceiling 10, configurable' }) @IsOptional() @Allow()
  vehicles?: unknown;
}

export class CostEstimateLineDto {
  @ApiProperty({ enum: ['RENT', 'ELECTRICITY', 'WATER', 'INTERNET', 'GARBAGE', 'PARKING'] }) code!: EstimateCode;
  @ApiProperty() label!: string;
  @ApiProperty({ type: String, nullable: true, description: 'Exact declared Decimal rate; not rounded', example: '3500.5' }) unitPrice!: string | null;
  @ApiProperty({ enum: ['VND/ROOM/MONTH', 'VND/KWH', 'VND/M3', 'VND/PERSON/MONTH', 'VND/VEHICLE/MONTH'] }) unit!: string;
  @ApiProperty({ type: Number, nullable: true }) quantity!: number | null;
  @ApiProperty({ type: 'integer', nullable: true, description: 'VND subtotal, half-up rounded' }) amount!: number | null;
  @ApiProperty({ enum: ['FIXED', 'COMPUTED', 'NEEDS_INPUT', 'NOT_DECLARED', 'FREE'] }) status!: EstimateStatus;
}

export class CostEstimateDto {
  @ApiProperty({ type: [CostEstimateLineDto] }) lines!: CostEstimateLineDto[];
  @ApiProperty({ type: 'integer' }) totalMonthly!: number;
  @ApiProperty({ type: 'integer', nullable: true, description: 'Separate from totalMonthly' }) deposit!: number | null;
  @ApiProperty({ type: [String] }) missingInputs!: string[];
  @ApiProperty({ type: [String] }) missingCosts!: EstimateCode[];
  @ApiProperty() isComplete!: boolean;
  @ApiProperty() disclaimer!: string;
}
