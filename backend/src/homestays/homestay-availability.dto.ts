import { Transform } from 'class-transformer';
import { IsInt, IsString, IsUUID, Matches, Max, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

const queryInteger = ({ value }: { value: unknown }) => typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;

export class HomestayGuestCountsDto {
  @ApiProperty({ minimum: 1, description: 'Adult count, checked against unit capacity' })
  @Transform(queryInteger) @IsInt() @Min(1) @Max(2147483647)
  adults!: number;
  @ApiProperty({ minimum: 0, description: 'Child count only; no age-based surcharge' })
  @Transform(queryInteger) @IsInt() @Min(0) @Max(2147483647)
  children!: number;
}

export class HomestayAvailabilityDto extends HomestayGuestCountsDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID()
  unitId!: string;
  @ApiProperty({ example: '2026-10-20', format: 'date' }) @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/)
  checkIn!: string;
  @ApiProperty({ example: '2026-10-23', format: 'date' }) @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/)
  checkOut!: string;
}

export class HomestayCalendarDto extends HomestayGuestCountsDto {
  @ApiProperty({ example:'2026-10',pattern:'^[0-9]{4}-(0[1-9]|1[0-2])$' }) @IsString() @Matches(/^\d{4}-(0[1-9]|1[0-2])$/)
  month!: string;
}

export class HomestayUnitIdDto {
  @ApiProperty({ format:'uuid' }) @IsUUID()
  unitId!: string;
}
