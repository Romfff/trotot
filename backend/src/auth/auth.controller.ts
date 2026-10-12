import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { ApiEnvelopedResponses } from '../common/api-docs.js';
import {
  ForgotPasswordDto,
  BecomeHostDto,
  LoginDto,
  LogoutDto,
  RefreshTokenDto,
  RegisterDto,
  ResetPasswordDto,
  SendOtpDto,
  VerifyOtpDto,
} from './auth.dto.js';
import { AccessTokenGuard } from './access-token.guard.js';
import { AuthService } from './auth.service.js';
import { ClientIp } from './client-ip.js';
import { Sprint2IpRateLimitGuard, Sprint2UserRateLimitGuard } from '../common/sprint2-rate-limit.guard.js';
import {
  authSessionSchema,
  otpResultSchema,
  passwordUpdatedSchema,
  publicUserSchema,
  registeredUserSchema,
  signedOutSchema,
  verifiedPhoneSchema,
} from './auth.response-schemas.js';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  @ApiOperation({ summary: 'Đăng ký Tenant bằng số điện thoại và mật khẩu' })
  @ApiEnvelopedResponses(registeredUserSchema, 201, [400, 409, 429])
  register(@Body() dto: RegisterDto, @ClientIp() ip?: string) {
    return this.auth.register(dto, ip);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Đăng nhập bằng số điện thoại và mật khẩu' })
  @ApiEnvelopedResponses(authSessionSchema, 200, [400, 401, 403, 429])
  login(@Body() dto: LoginDto, @ClientIp() ip?: string) {
    return this.auth.login(dto, ip);
  }

  @Post('send-otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Gửi OTP mock để xác thực điện thoại hoặc đặt lại mật khẩu' })
  @ApiEnvelopedResponses(otpResultSchema, 200, [400, 429, 503])
  sendOtp(@Body() dto: SendOtpDto, @ClientIp() ip?: string) {
    return this.auth.sendOtp(dto, ip);
  }

  @Post('verify-otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Xác thực OTP và kích hoạt số điện thoại' })
  @ApiEnvelopedResponses(verifiedPhoneSchema, 200, [400, 401, 429])
  verifyOtp(@Body() dto: VerifyOtpDto, @ClientIp() ip?: string) {
    return this.auth.verifyOtp(dto, ip);
  }

  @Post('refresh-token')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Xoay refresh token và cấp cặp token mới' })
  @ApiEnvelopedResponses(authSessionSchema, 200, [400, 401, 429])
  refresh(@Body() dto: RefreshTokenDto, @ClientIp() ip?: string) {
    return this.auth.refresh(dto.refreshToken, ip);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Thu hồi phiên bằng refresh token, không cần access token còn hạn' })
  @ApiEnvelopedResponses(signedOutSchema, 200, [400, 401])
  logout(@Body() dto: LogoutDto) {
    return this.auth.logout(dto.refreshToken);
  }

  @Get('me')
  @UseGuards(AccessTokenGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Lấy thông tin user đang đăng nhập' })
  @ApiEnvelopedResponses(publicUserSchema, 200, [401])
  me(@Req() request: Request) {
    return this.auth.me(request.user!);
  }

  @Post('become-host')
  @HttpCode(HttpStatus.OK)
  @UseGuards(Sprint2IpRateLimitGuard, AccessTokenGuard, Sprint2UserRateLimitGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Owner-approved self-service TENANT → HOST; idempotent; cannot grant ADMIN or KYC' })
  @ApiEnvelopedResponses(registeredUserSchema, 200, [400,401,403,429,503])
  becomeHost(@Req() request: Request, @Body() _body: BecomeHostDto) {
    return this.auth.becomeHost(request.user!);
  }

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Yêu cầu OTP đặt lại mật khẩu' })
  @ApiEnvelopedResponses(otpResultSchema, 200, [400, 429, 503])
  forgotPassword(@Body() dto: ForgotPasswordDto, @ClientIp() ip?: string) {
    return this.auth.forgotPassword(dto, ip);
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Đặt mật khẩu mới bằng OTP' })
  @ApiEnvelopedResponses(passwordUpdatedSchema, 200, [400, 401, 429])
  resetPassword(@Body() dto: ResetPasswordDto, @ClientIp() ip?: string) {
    return this.auth.resetPassword(dto, ip);
  }
}
