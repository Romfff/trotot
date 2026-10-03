import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, createHmac, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import bcrypt from 'bcrypt';
import { SignJWT, jwtVerify } from 'jose';
import type {
  ForgotPasswordDto,
  LoginDto,
  RegisterDto,
  ResetPasswordDto,
  SendOtpDto,
  VerifyOtpDto,
} from './auth.dto.js';
import { durationSeconds, positiveIntegerEnv, requiredEnv } from '../config/environment.js';
import { PrismaService } from '../database/prisma.service.js';
import { RedisService } from '../redis/redis.service.js';
import type { PublicUser as SafeUser } from '../users/users.service.js';
import type { AuthenticatedUser } from './auth.types.js';
import { UsersService } from '../users/users.service.js';
import { normalizePhone } from './phone.js';
import type { Prisma } from '../generated/prisma/client.js';

const userSelect = {
  id: true,
  phone: true,
  email: true,
  fullName: true,
  role: true,
  avatarUrl: true,
  isPhoneVerified: true,
  isIdentityVerified: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} as const;

type OtpPurpose = 'VERIFY_PHONE' | 'RESET_PASSWORD';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly users: UsersService,
  ) {}

  async register(dto: RegisterDto, ip?: string): Promise<{ user: SafeUser }> {
    const phone = this.normalizePhone(dto.phone);
    if (ip) await this.limit(`register:ip:${ip}`, 10, 3600);
    await this.limit(`register:phone:${phone}`, 5, 3600);
    this.assertBcryptPassword(dto.password);

    try {
      const user = await this.prisma.user.create({
        data: {
          phone,
          email: dto.email?.toLowerCase() ?? null,
          passwordHash: await bcrypt.hash(dto.password, 12),
          fullName: dto.fullName.trim(),
          role: 'TENANT',
        },
        select: userSelect,
      });
      return { user };
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new ConflictException({ errorCode: 'ACCOUNT_ALREADY_EXISTS', message: 'Số điện thoại hoặc email đã được sử dụng.' });
      }
      throw error;
    }
  }

  async login(dto: LoginDto, ip?: string): Promise<{ accessToken: string; refreshToken: string; user: SafeUser }> {
    const phone = this.normalizePhone(dto.phone);
    if (ip) await this.limit(`login:ip:${ip}`, 20, 900);
    await this.limit(`login:phone:${phone}`, 8, 900);
    this.assertBcryptPassword(dto.password);

    const user = await this.prisma.user.findUnique({ where: { phone } });
    if (!user || !(await bcrypt.compare(dto.password, user.passwordHash))) {
      throw new UnauthorizedException({ errorCode: 'INVALID_CREDENTIALS', message: 'Số điện thoại hoặc mật khẩu không đúng.' });
    }
    if (user.status !== 'ACTIVE') {
      throw new ForbiddenException({ errorCode: 'ACCOUNT_INACTIVE', message: 'Tài khoản đang bị khóa hoặc không hoạt động.' });
    }
    if (!user.isPhoneVerified) {
      throw new ForbiddenException({ errorCode: 'PHONE_NOT_VERIFIED', message: 'Vui lòng xác thực số điện thoại trước khi đăng nhập.' });
    }

    return this.prisma.$transaction(async (transaction) => {
      // Serialize session issuance with password reset on the same user row.
      await transaction.$queryRaw`SELECT id FROM users WHERE id = ${user.id}::uuid FOR UPDATE`;
      const current = await transaction.user.findUnique({ where: { id: user.id } });
      if (!current || current.passwordHash !== user.passwordHash) {
        throw new UnauthorizedException({ errorCode: 'INVALID_CREDENTIALS', message: 'Mật khẩu đã thay đổi. Vui lòng đăng nhập lại.' });
      }
      if (current.status !== 'ACTIVE' || !current.isPhoneVerified) {
        throw new ForbiddenException({ errorCode: 'ACCOUNT_INACTIVE', message: 'Tài khoản không đủ điều kiện đăng nhập.' });
      }
      const tokens = await this.buildTokenPair(current);
      await transaction.refreshToken.create({
        data: { userId: current.id, tokenHash: this.sha256(tokens.refreshToken), expiresAt: tokens.refreshExpiresAt },
      });
      return { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, user: this.safeUser(current) };
    });
  }

  async sendOtp(dto: SendOtpDto, ip?: string): Promise<Record<string, unknown>> {
    return this.issueOtp(this.normalizePhone(dto.phone), dto.purpose, ip);
  }

  async verifyOtp(dto: VerifyOtpDto, ip?: string): Promise<{ verified: true; phone: string }> {
    const phone = this.normalizePhone(dto.phone);
    if (ip) await this.limit(`otp:verify:ip:${ip}`, 30, 900);
    const purpose: OtpPurpose = 'VERIFY_PHONE';
    const challengeKey = this.otpKey(purpose, phone);
    const stored = await this.redis.client.get(challengeKey);
    if (!stored) {
      throw new UnauthorizedException({ errorCode: 'INVALID_OTP', message: 'Mã OTP không đúng hoặc đã hết hạn.' });
    }
    const attempts = await this.redis.incrementWithTtl(
      this.otpAttemptsKey(purpose, phone, stored),
      positiveIntegerEnv('OTP_TTL_SECONDS', 300),
    );
    const maxAttempts = positiveIntegerEnv('OTP_MAX_ATTEMPTS', 5);
    if (attempts > maxAttempts) {
      await this.redis.deleteIfValue(challengeKey, stored);
      throw new HttpException({ errorCode: 'OTP_ATTEMPTS_EXCEEDED', message: 'Bạn đã nhập sai OTP quá số lần cho phép.' }, HttpStatus.TOO_MANY_REQUESTS);
    }

    if (!this.matchesOtp(dto.code, stored)) {
      throw new UnauthorizedException({ errorCode: 'INVALID_OTP', message: 'Mã OTP không đúng hoặc đã hết hạn.' });
    }
    const user = await this.prisma.user.findUnique({ where: { phone }, select: { id: true } });
    if (!user) throw new UnauthorizedException({ errorCode: 'INVALID_OTP', message: 'Mã OTP không đúng hoặc đã hết hạn.' });
    await this.applyOtp(challengeKey, stored, user.id, async (transaction) => {
      await transaction.user.update({ where: { id: user.id }, data: { isPhoneVerified: true } });
    });
    return { verified: true, phone };
  }

  async refresh(refreshToken: string, ip?: string): Promise<{ accessToken: string; refreshToken: string; user: SafeUser }> {
    if (ip) await this.limit(`refresh:ip:${ip}`, 30, 900);
    await this.limit(`refresh:token:${this.sha256(refreshToken)}`, 30, 900);
    let payload;
    try {
      ({ payload } = await jwtVerify(
        refreshToken,
        new TextEncoder().encode(requiredEnv('JWT_REFRESH_SECRET')),
        { algorithms: ['HS256'] },
      ));
    } catch {
      throw new UnauthorizedException({ errorCode: 'INVALID_REFRESH_TOKEN', message: 'Refresh token không hợp lệ hoặc đã hết hạn.' });
    }
    if (payload.tokenType !== 'refresh' || typeof payload.sub !== 'string') {
      throw new UnauthorizedException({ errorCode: 'INVALID_REFRESH_TOKEN', message: 'Refresh token không hợp lệ hoặc đã hết hạn.' });
    }

    const oldHash = this.sha256(refreshToken);
    const now = new Date();
    const existing = await this.prisma.refreshToken.findFirst({
      where: { tokenHash: oldHash, userId: payload.sub, revokedAt: null, expiresAt: { gt: now } },
    });
    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!existing || !user || user.status !== 'ACTIVE' || !user.isPhoneVerified) {
      throw new UnauthorizedException({ errorCode: 'REFRESH_TOKEN_REVOKED', message: 'Phiên đăng nhập đã bị thu hồi hoặc hết hạn.' });
    }

    return this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT id FROM users WHERE id = ${user.id}::uuid FOR UPDATE`;
      const current = await transaction.user.findUnique({ where: { id: user.id } });
      if (!current || current.status !== 'ACTIVE' || !current.isPhoneVerified) {
        throw new UnauthorizedException({ errorCode: 'REFRESH_TOKEN_REVOKED', message: 'Phiên đăng nhập đã bị thu hồi.' });
      }
      const checkedAt = new Date();
      const revoked = await transaction.refreshToken.updateMany({
        where: { id: existing.id, tokenHash: oldHash, revokedAt: null, expiresAt: { gt: checkedAt } },
        data: { revokedAt: checkedAt },
      });
      if (revoked.count !== 1) {
        throw new UnauthorizedException({ errorCode: 'REFRESH_TOKEN_REUSED', message: 'Refresh token đã được sử dụng hoặc thu hồi.' });
      }
      // Only a session successfully claimed under the user lock charges this account.
      // A rate-limit failure rolls the SQL revocation back, keeping its token usable later.
      await this.limit(`refresh:user:${current.id}`, 30, 900);
      const tokens = await this.buildTokenPair(current);
      await transaction.refreshToken.create({
        data: { userId: user.id, tokenHash: this.sha256(tokens.refreshToken), expiresAt: tokens.refreshExpiresAt },
      });
      return { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, user: this.safeUser(current) };
    });
  }

  async logout(refreshToken: string): Promise<{ signedOut: true }> {
    // Possession of the exact high-entropy credential authenticates revocation only.
    // No token issuance, expiry check or Redis quota is needed to close a session.
    const tokenHash = this.sha256(refreshToken);
    const session = await this.prisma.refreshToken.findUnique({ where: { tokenHash }, select: { id: true } });
    if (!session) {
      throw new UnauthorizedException({ errorCode: 'REFRESH_TOKEN_REVOKED', message: 'Phiên đăng nhập không hợp lệ.' });
    }
    await this.prisma.refreshToken.updateMany({
      where: { id: session.id, tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    // Already-revoked known credentials are safe to close again (idempotent).
    return { signedOut: true };
  }

  async me(user: AuthenticatedUser): Promise<SafeUser> {
    const record = await this.users.findActivePublicUser(user.id);
    if (!record) throw new UnauthorizedException({ errorCode: 'ACCOUNT_INACTIVE', message: 'Tài khoản không còn hoạt động.' });
    return record;
  }

  async forgotPassword(dto: ForgotPasswordDto, ip?: string): Promise<Record<string, unknown>> {
    return this.issueOtp(this.normalizePhone(dto.phone), 'RESET_PASSWORD', ip);
  }

  async resetPassword(dto: ResetPasswordDto, ip?: string): Promise<{ passwordUpdated: true }> {
    const phone = this.normalizePhone(dto.phone);
    if (ip) await this.limit(`password-reset:ip:${ip}`, 10, 900);
    await this.limit(`password-reset:phone:${phone}`, 5, 900);
    this.assertBcryptPassword(dto.newPassword);

    const challengeKey = this.otpKey('RESET_PASSWORD', phone);
    const stored = await this.redis.client.get(challengeKey);
    if (!stored || !this.matchesOtp(dto.code, stored)) {
      throw new UnauthorizedException({ errorCode: 'INVALID_OTP', message: 'Mã OTP không đúng hoặc đã hết hạn.' });
    }
    const user = await this.prisma.user.findUnique({ where: { phone }, select: { id: true } });
    if (!user) throw new UnauthorizedException({ errorCode: 'INVALID_OTP', message: 'Mã OTP không đúng hoặc đã hết hạn.' });
    const passwordHash = await bcrypt.hash(dto.newPassword, 12);
    await this.applyOtp(challengeKey, stored, user.id, async (transaction) => {
      await transaction.user.update({ where: { id: user.id }, data: { passwordHash, sessionVersion: { increment: 1 } } });
      await transaction.refreshToken.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });
    return { passwordUpdated: true };
  }

  private async applyOtp(
    key: string,
    challenge: string,
    userId: string,
    update: (transaction: Prisma.TransactionClient) => Promise<void>,
  ): Promise<void> {
    const claimed = `claimed:${randomUUID()}`;
    let reserved = false;
    let callbackFailed = false;
    try {
      await this.prisma.$transaction(async (transaction) => {
        try {
          await transaction.$queryRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
          reserved = await this.redis.replaceIfValue(key, challenge, claimed);
          if (!reserved) throw new UnauthorizedException({ errorCode: 'INVALID_OTP', message: 'Mã OTP đã được sử dụng hoặc hết hạn.' });
          await update(transaction);
        } catch (error) {
          callbackFailed = true;
          throw error;
        }
      });
    } catch (error) {
      // Only a failed transaction callback is known not to have committed.
      // Unknown commit outcomes/process crashes stay fail-closed until resend.
      if (reserved && callbackFailed) {
        await this.redis.replaceIfValue(key, claimed, challenge).catch(() => false);
      }
      throw error;
    }
    // Claimed values cannot validate as an OTP. Cleanup failure must not turn a
    // committed DB update into an apparent failure or re-enable its credential.
    await this.redis.deleteIfValue(key, claimed).catch(() => false);
  }

  private async issueOtp(phone: string, purpose: OtpPurpose, ip?: string): Promise<Record<string, unknown>> {
    if (ip) await this.limit(`otp:send:ip:${ip}`, 10, 900);
    await this.limit(`otp:send:phone:${phone}`, 5, 3600);
    const user = await this.prisma.user.findUnique({ where: { phone }, select: { id: true, status: true, isPhoneVerified: true } });
    const accepted = { accepted: true, expiresInSeconds: positiveIntegerEnv('OTP_TTL_SECONDS', 300) };
    if (!user || user.status !== 'ACTIVE' || (purpose === 'VERIFY_PHONE' && user.isPhoneVerified)) {
      return accepted;
    }

    const cooldownKey = this.digestKey(`otp:cooldown:${purpose}`, phone);
    const cooldown = await this.redis.client.set(
      cooldownKey,
      '1',
      'EX',
      positiveIntegerEnv('OTP_RESEND_SECONDS', 60),
      'NX',
    );
    if (cooldown !== 'OK') {
      throw new HttpException({ errorCode: 'OTP_RESEND_TOO_SOON', message: 'Vui lòng chờ trước khi yêu cầu mã OTP mới.' }, HttpStatus.TOO_MANY_REQUESTS);
    }

    const code = String(randomInt(100_000, 1_000_000));
    const ttl = positiveIntegerEnv('OTP_TTL_SECONDS', 300);
    // A new generation isolates attempt counters even if the same six-digit code repeats.
    await this.redis.client.set(this.otpKey(purpose, phone), `${randomUUID()}:${this.otpHash(code)}`, 'EX', ttl);
    return {
      ...accepted,
      ...(process.env.NODE_ENV !== 'production' && (process.env.OTP_PROVIDER || 'mock') === 'mock' ? { devOtp: code } : {}),
    };
  }

  private async buildTokenPair(user: SafeUser & { sessionVersion: number }): Promise<{
    accessToken: string;
    refreshToken: string;
    refreshExpiresAt: Date;
  }> {
    const now = Math.floor(Date.now() / 1000);
    const accessTtl = durationSeconds(process.env.ACCESS_TOKEN_TTL || '15m');
    const refreshTtl = durationSeconds(process.env.REFRESH_TOKEN_TTL || '30d');
    const accessToken = await new SignJWT({ role: user.role, tokenType: 'access', sessionVersion: user.sessionVersion })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(user.id)
      .setIssuedAt(now)
      .setExpirationTime(now + accessTtl)
      .sign(new TextEncoder().encode(requiredEnv('JWT_ACCESS_SECRET')));
    const refreshToken = await new SignJWT({ tokenType: 'refresh' })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(user.id)
      .setJti(randomUUID())
      .setIssuedAt(now)
      .setExpirationTime(now + refreshTtl)
      .sign(new TextEncoder().encode(requiredEnv('JWT_REFRESH_SECRET')));
    return {
      accessToken,
      refreshToken,
      refreshExpiresAt: new Date((now + refreshTtl) * 1000),
    };
  }

  private async limit(value: string, max: number, windowSeconds: number): Promise<void> {
    const count = await this.redis.incrementWithTtl(this.digestKey('rate:v1', value), windowSeconds);
    if (count > max) {
      throw new HttpException({ errorCode: 'RATE_LIMITED', message: 'Bạn thao tác quá nhanh. Vui lòng thử lại sau.' }, HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  private normalizePhone(phone: string): string {
    return normalizePhone(phone);
  }

  private assertBcryptPassword(password: string): void {
    if (Buffer.byteLength(password, 'utf8') > 72) {
      throw new BadRequestException({ errorCode: 'PASSWORD_TOO_LONG', message: 'Mật khẩu không được dài quá 72 byte UTF-8.' });
    }
  }

  private safeUser(user: SafeUser): SafeUser {
    return {
      id: user.id,
      phone: user.phone,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      avatarUrl: user.avatarUrl,
      isPhoneVerified: user.isPhoneVerified,
      isIdentityVerified: user.isIdentityVerified,
      status: user.status,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  private otpKey(purpose: OtpPurpose, phone: string): string {
    return this.digestKey(`otp:v1:${purpose}`, phone);
  }

  private otpAttemptsKey(purpose: OtpPurpose, phone: string, challenge: string): string {
    return this.digestKey(`otp:attempts:v1:${purpose}`, `${phone}:${challenge}`);
  }

  private digestKey(prefix: string, value: string): string {
    return `${prefix}:${this.sha256(value)}`;
  }

  private sha256(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  private otpHash(code: string): string {
    return createHmac('sha256', requiredEnv('JWT_ACCESS_SECRET')).update(code).digest('hex');
  }

  private matchesOtp(code: string, storedHash: string): boolean {
    const actual = Buffer.from(this.otpHash(code), 'hex');
    const expected = Buffer.from(storedHash.split(':').at(-1) ?? '', 'hex');
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }

  private isUniqueViolation(error: unknown): boolean {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
  }
}
