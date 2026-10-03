import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { normalizePhone } from './phone.js';

const PHONE_PATTERN = /^\+?[0-9]{9,15}$/;
const PASSWORD_PATTERN = /^(?=.*[A-Za-z])(?=.*\d).+$/;

export class RegisterDto {
  @ApiProperty({ example: '0912345678' })
  @Transform(({ value }) => typeof value === 'string' ? normalizePhone(value) : value)
  @IsString()
  @Matches(PHONE_PATTERN)
  phone!: string;

  @ApiProperty({ minLength: 8, maxLength: 64, example: 'TroTot1234' })
  @IsString()
  @MinLength(8)
  @MaxLength(64)
  @Matches(PASSWORD_PATTERN, { message: 'password must include at least one letter and one number' })
  password!: string;

  @ApiProperty({ maxLength: 150, example: 'Nguyễn Văn An' })
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  fullName!: string;

  @ApiPropertyOptional({ maxLength: 255, example: 'an@example.com' })
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  email?: string;
}

export class LoginDto {
  @ApiProperty({ example: '0912345678' })
  @Transform(({ value }) => typeof value === 'string' ? normalizePhone(value) : value)
  @IsString()
  @Matches(PHONE_PATTERN)
  phone!: string;

  @ApiProperty({ example: 'TroTot1234' })
  @IsString()
  @MinLength(8)
  @MaxLength(64)
  password!: string;
}

export class SendOtpDto {
  @ApiProperty({ example: '0912345678' })
  @Transform(({ value }) => typeof value === 'string' ? normalizePhone(value) : value)
  @IsString()
  @Matches(PHONE_PATTERN)
  phone!: string;

  @ApiPropertyOptional({ enum: ['VERIFY_PHONE', 'RESET_PASSWORD'], default: 'VERIFY_PHONE' })
  @IsOptional()
  @IsIn(['VERIFY_PHONE', 'RESET_PASSWORD'])
  purpose: 'VERIFY_PHONE' | 'RESET_PASSWORD' = 'VERIFY_PHONE';
}

export class VerifyOtpDto {
  @ApiProperty({ example: '0912345678' })
  @Transform(({ value }) => typeof value === 'string' ? normalizePhone(value) : value)
  @IsString()
  @Matches(PHONE_PATTERN)
  phone!: string;

  @ApiProperty({ pattern: '^\\d{6}$', example: '481205' })
  @IsString()
  @Matches(/^\d{6}$/)
  code!: string;
}

export class RefreshTokenDto {
  @ApiProperty({ minLength: 24 })
  @IsString()
  @MinLength(24)
  @MaxLength(4096)
  refreshToken!: string;
}

export class LogoutDto extends RefreshTokenDto {}

export class ForgotPasswordDto {
  @ApiProperty({ example: '0912345678' })
  @Transform(({ value }) => typeof value === 'string' ? normalizePhone(value) : value)
  @IsString()
  @Matches(PHONE_PATTERN)
  phone!: string;
}

export class ResetPasswordDto {
  @ApiProperty({ example: '0912345678' })
  @Transform(({ value }) => typeof value === 'string' ? normalizePhone(value) : value)
  @IsString()
  @Matches(PHONE_PATTERN)
  phone!: string;

  @ApiProperty({ pattern: '^\\d{6}$', example: '481205' })
  @IsString()
  @Matches(/^\d{6}$/)
  code!: string;

  @ApiProperty({ minLength: 8, maxLength: 64, example: 'TroTot5678' })
  @IsString()
  @MinLength(8)
  @MaxLength(64)
  @Matches(PASSWORD_PATTERN, { message: 'newPassword must include at least one letter and one number' })
  newPassword!: string;
}
