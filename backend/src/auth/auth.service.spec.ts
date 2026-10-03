import { beforeEach, describe, expect, it, vi } from 'vitest';
import bcrypt from 'bcrypt';
import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service.js';
import type { PrismaService } from '../database/prisma.service.js';
import type { RedisService } from '../redis/redis.service.js';
import { AccessTokenGuard } from './access-token.guard.js';
import type { ExecutionContext } from '@nestjs/common';
import { createHash } from 'node:crypto';

const fixtureUser = {
  id: '4b914fec-2b50-4e55-9ccf-29cf871e0fb1',
  phone: '0912345678',
  email: null,
  passwordHash: '',
  sessionVersion: 0,
  fullName: 'Test User',
  role: 'TENANT',
  avatarUrl: null,
  isPhoneVerified: true,
  isIdentityVerified: false,
  status: 'ACTIVE',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
};

function makeDependencies() {
  const values = new Map<string, string>();
  const client = {
    set: vi.fn(async (key: string, value: string, ...args: (string | number)[]) => {
      if (args.includes('NX') && values.has(key)) return null;
      values.set(key, value);
      return 'OK';
    }),
    get: vi.fn(async (key: string) => values.get(key) ?? null),
    getdel: vi.fn(async (key: string) => {
      const value = values.get(key) ?? null;
      values.delete(key);
      return value;
    }),
    del: vi.fn(async (...keys: string[]) => keys.reduce((count, key) => count + Number(values.delete(key)), 0)),
  };
  let rotateCount = 0;
  const transaction = {
    $queryRaw: vi.fn(async () => []),
    refreshToken: {
      updateMany: vi.fn(async () => ({ count: rotateCount++ === 0 ? 1 : 0 })),
      create: vi.fn(async () => ({})),
    },
    user: {
      findUnique: vi.fn(async () => ({ ...fixtureUser })),
      update: vi.fn(async (_args: { where: { id: string }; data: { passwordHash: string } }) => ({})),
    },
  };
  const prisma = {
    user: {
      create: vi.fn(async () => {
        const { passwordHash: _hash, ...safeUser } = fixtureUser;
        return safeUser;
      }),
      findUnique: vi.fn(async () => fixtureUser),
      update: vi.fn(async () => fixtureUser),
    },
    refreshToken: {
      create: vi.fn(async () => ({})),
      findUnique: vi.fn(async () => ({ id: 'refresh-id' })),
      findFirst: vi.fn(async () => ({ id: 'refresh-id' })),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    $transaction: vi.fn(async (callback: (tx: typeof transaction) => Promise<unknown>) => callback(transaction)),
  };
  const redis = {
    client,
    replaceIfValue: vi.fn(async (key: string, expected: string, value: string) => {
      if (values.get(key) !== expected) return false;
      values.set(key, value);
      return true;
    }),
    deleteIfValue: vi.fn(async (key: string, value: string) => {
      if (values.get(key) !== value) return false;
      return values.delete(key);
    }),
    incrementWithTtl: vi.fn(async () => 1),
  };
  const users = { findActivePublicUser: vi.fn(async () => fixtureUser) };
  return {
    auth: new AuthService(
      prisma as unknown as PrismaService,
      redis as unknown as RedisService,
      users as never,
    ),
    prisma,
    redis,
    client,
    transaction,
    values,
  };
}

describe('AuthService', () => {
  it('rejects logout with an unknown refresh credential', async () => {
    const { auth, prisma } = makeDependencies();
    prisma.refreshToken.findUnique.mockResolvedValue(null as never);
    await expect(auth.logout('unknown-refresh-token'))
      .rejects.toHaveProperty('status', 401);
    expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
  });

  it('revokes only the stored credential without using Redis or issuing tokens', async () => {
    const { auth, prisma, redis, transaction } = makeDependencies();
    redis.incrementWithTtl.mockResolvedValue(31);
    await expect(auth.logout('known-refresh-token')).resolves.toEqual({ signedOut: true });
    const tokenHash = createHash('sha256').update('known-refresh-token').digest('hex');
    expect(prisma.refreshToken.findUnique).toHaveBeenCalledWith({ where: { tokenHash }, select: { id: true } });
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { id: 'refresh-id', tokenHash, revokedAt: null }, data: { revokedAt: expect.any(Date) },
    });
    expect(redis.incrementWithTtl).not.toHaveBeenCalled();
    expect(prisma.refreshToken.create).not.toHaveBeenCalled();
    expect(transaction.refreshToken.create).not.toHaveBeenCalled();
  });

  it('can close an already-revoked known refresh credential again', async () => {
    const { auth, prisma } = makeDependencies();
    prisma.refreshToken.updateMany.mockResolvedValue({ count: 0 });
    await expect(auth.logout('known-revoked-refresh-token')).resolves.toEqual({ signedOut: true });
  });

  it('rate-limits revoked-token replay separately without blocking a valid session of the same user', async () => {
    const { auth, prisma, redis } = makeDependencies();
    fixtureUser.passwordHash = await bcrypt.hash('LocalTest123', 4);
    const first = await auth.login({ phone: fixtureUser.phone, password: 'LocalTest123' });
    const second = await auth.login({ phone: fixtureUser.phone, password: 'LocalTest123' });
    const revokedHash = createHash('sha256').update(first.refreshToken).digest('hex');
    prisma.refreshToken.findFirst.mockImplementation(async ({ where }) =>
      where.tokenHash === revokedHash ? null : { id: 'refresh-id' });
    const counts = new Map<string, number>();
    redis.incrementWithTtl.mockImplementation(async (key) => {
      const count = (counts.get(key) || 0) + 1;
      counts.set(key, count);
      return count;
    });
    for (let attempt = 0; attempt < 31; attempt += 1) {
      await expect(auth.refresh(first.refreshToken)).rejects.toHaveProperty('status', attempt < 30 ? 401 : 429);
    }
    await expect(auth.refresh(second.refreshToken)).resolves.toHaveProperty('accessToken');
    const userBucket = 'rate:v1:' + createHash('sha256').update(`refresh:user:${fixtureUser.id}`).digest('hex');
    expect(counts.get(userBucket)).toBe(1);
  });

  it('does not charge the user bucket when reset revokes a token while refresh waits for the lock', async () => {
    const { auth, transaction, redis } = makeDependencies();
    fixtureUser.passwordHash = await bcrypt.hash('LocalTest123', 4);
    const session = await auth.login({ phone: fixtureUser.phone, password: 'LocalTest123' });
    transaction.refreshToken.updateMany.mockResolvedValue({ count: 0 });
    redis.incrementWithTtl.mockClear();
    await expect(auth.refresh(session.refreshToken)).rejects.toHaveProperty('status', 401);
    expect(redis.incrementWithTtl).toHaveBeenCalledTimes(1);
  });
  beforeEach(() => {
    process.env.JWT_ACCESS_SECRET = 'test-access-secret-value-0123456789-abcdef';
    process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-value-0123456789-abcdef';
    process.env.ACCESS_TOKEN_TTL = '15m';
    process.env.REFRESH_TOKEN_TTL = '30d';
    process.env.OTP_PROVIDER = 'mock';
    process.env.OTP_TTL_SECONDS = '300';
    process.env.OTP_RESEND_SECONDS = '60';
    process.env.OTP_MAX_ATTEMPTS = '5';
    process.env.NODE_ENV = 'test';
  });

  it('registers as TENANT and never returns or stores a plaintext password', async () => {
    const { auth, prisma } = makeDependencies();
    const result = await auth.register({
      phone: '0912345678',
      password: 'LocalTest123',
      fullName: 'Test User',
      email: 'TEST@example.com',
    }, '127.0.0.1');

    expect(prisma.user.create).toHaveBeenCalledOnce();
    const input = prisma.user.create.mock.calls[0][0].data;
    expect(input.role).toBe('TENANT');
    expect(input.email).toBe('test@example.com');
    expect(input.passwordHash).not.toBe('LocalTest123');
    expect(await bcrypt.compare('LocalTest123', input.passwordHash)).toBe(true);
    expect(result.user).not.toHaveProperty('passwordHash');
  });

  it('issues OTP only for an existing pending user and rejects OTP replay', async () => {
    const { auth, redis, prisma, transaction } = makeDependencies();
    prisma.user.findUnique
      .mockResolvedValueOnce({ ...fixtureUser, isPhoneVerified: false })
      .mockResolvedValueOnce({ id: fixtureUser.id });
    const sent = await auth.sendOtp({ phone: fixtureUser.phone, purpose: 'VERIFY_PHONE' }, '127.0.0.1');

    expect(sent.devOtp).toMatch(/^\d{6}$/);
    await expect(auth.verifyOtp({ phone: fixtureUser.phone, code: '000000' }, '127.0.0.1'))
      .rejects.toBeInstanceOf(UnauthorizedException);
    await expect(auth.verifyOtp({ phone: fixtureUser.phone, code: String(sent.devOtp) }, '127.0.0.1'))
      .resolves.toEqual({ verified: true, phone: fixtureUser.phone });
    await expect(auth.verifyOtp({ phone: fixtureUser.phone, code: String(sent.devOtp) }, '127.0.0.1'))
      .rejects.toBeInstanceOf(UnauthorizedException);
    expect(transaction.user.update).toHaveBeenCalledOnce();
    expect(redis.deleteIfValue).toHaveBeenCalledOnce();
  });

  it('blocks OTP sends after the Redis rate limit is reached', async () => {
    const { auth, prisma, redis } = makeDependencies();
    redis.incrementWithTtl.mockResolvedValue(11);

    const error = await auth.sendOtp({ phone: fixtureUser.phone, purpose: 'VERIFY_PHONE' }, '127.0.0.1')
      .catch((caught: unknown) => caught);

    expect(error).toHaveProperty('status', 429);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('expires an OTP challenge after too many verification attempts', async () => {
    const { auth, prisma, redis } = makeDependencies();
    prisma.user.findUnique.mockResolvedValue({ ...fixtureUser, isPhoneVerified: false });
    await auth.sendOtp({ phone: fixtureUser.phone, purpose: 'VERIFY_PHONE' }, '127.0.0.1');
    redis.incrementWithTtl
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(6);

    const error = await auth.verifyOtp({ phone: fixtureUser.phone, code: '123456' }, '127.0.0.1')
      .catch((caught: unknown) => caught);

    expect(error).toHaveProperty('status', 429);
    expect(redis.deleteIfValue).toHaveBeenCalledOnce();
  });

  it('keeps a resent challenge when an old challenge exceeds its attempt limit', async () => {
    const { auth, prisma, redis, values } = makeDependencies();
    prisma.user.findUnique.mockResolvedValue({ ...fixtureUser, isPhoneVerified: false });
    await auth.sendOtp({ phone: fixtureUser.phone, purpose: 'VERIFY_PHONE' }, '127.0.0.1');
    const key = [...values.keys()].find((value) => value.startsWith('otp:v1:VERIFY_PHONE:'))!;
    redis.incrementWithTtl.mockImplementation(async (attemptKey: string) => {
      if (attemptKey.startsWith('otp:attempts:')) {
        values.set(key, 'new-generation:new-hash');
        return 6;
      }
      return 1;
    });
    await expect(auth.verifyOtp({ phone: fixtureUser.phone, code: '123456' }, '127.0.0.1'))
      .rejects.toHaveProperty('status', 429);
    expect(values.get(key)).toBe('new-generation:new-hash');
  });

  it('resets a password with a one-time OTP and revokes existing sessions', async () => {
    const { auth, redis, transaction } = makeDependencies();
    const sent = await auth.sendOtp({ phone: fixtureUser.phone, purpose: 'RESET_PASSWORD' }, '127.0.0.1');
    const result = await auth.resetPassword({
      phone: fixtureUser.phone,
      code: String(sent.devOtp),
      newPassword: 'ChangedPass123',
    }, '127.0.0.1');
    const update = transaction.user.update.mock.calls[0][0];

    expect(result).toEqual({ passwordUpdated: true });
    expect(await bcrypt.compare('ChangedPass123', update.data.passwordHash)).toBe(true);
    expect(transaction.refreshToken.updateMany).toHaveBeenCalledOnce();
    expect(redis.deleteIfValue).toHaveBeenCalledOnce();
    expect(update.data).toMatchObject({ sessionVersion: { increment: 1 } });
  });

  it.each(['VERIFY_PHONE', 'RESET_PASSWORD'] as const)('restores an unexpired %s OTP after a DB callback rolls back', async (purpose) => {
    const { auth, prisma, transaction, values, redis } = makeDependencies();
    prisma.user.findUnique.mockResolvedValue({ ...fixtureUser, isPhoneVerified: false });
    const sent = await auth.sendOtp({ phone: fixtureUser.phone, purpose });
    const key = [...values.keys()].find((value) => value.startsWith(`otp:v1:${purpose}:`))!;
    const original = values.get(key);
    const apply = () => purpose === 'VERIFY_PHONE'
      ? auth.verifyOtp({ phone: fixtureUser.phone, code: String(sent.devOtp) })
      : auth.resetPassword({ phone: fixtureUser.phone, code: String(sent.devOtp), newPassword: 'ChangedPass123' });
    transaction.user.update.mockRejectedValueOnce(new Error('DB callback failed'));
    await expect(apply()).rejects.toThrow('DB callback failed');
    expect(values.get(key)).toBe(original);
    expect(redis.replaceIfValue).toHaveBeenCalledTimes(2);
    await expect(apply()).resolves.toBeDefined();
    await expect(apply()).rejects.toHaveProperty('status', 401);
    expect(values.has(key)).toBe(false);
  });

  it.each(['resend', 'expiry'] as const)('never overwrites %s when restoring a failed OTP operation', async (change) => {
    const { auth, transaction, values } = makeDependencies();
    const sent = await auth.forgotPassword({ phone: fixtureUser.phone });
    const key = [...values.keys()].find((value) => value.startsWith('otp:v1:RESET_PASSWORD:'))!;
    transaction.user.update.mockImplementationOnce(async () => {
      if (change === 'resend') values.set(key, 'new-generation:new-hash');
      else values.delete(key);
      throw new Error('DB callback failed');
    });
    await expect(auth.resetPassword({ phone: fixtureUser.phone, code: String(sent.devOtp), newPassword: 'ChangedPass123' }))
      .rejects.toThrow('DB callback failed');
    expect(values.get(key)).toBe(change === 'resend' ? 'new-generation:new-hash' : undefined);
  });

  it('does not restore an OTP if the transaction commit outcome is unknown', async () => {
    const { auth, prisma, transaction, values, redis } = makeDependencies();
    const sent = await auth.forgotPassword({ phone: fixtureUser.phone });
    const key = [...values.keys()].find((value) => value.startsWith('otp:v1:RESET_PASSWORD:'))!;
    prisma.$transaction.mockImplementationOnce(async (callback) => {
      await callback(transaction);
      throw new Error('Commit acknowledgement lost');
    });
    await expect(auth.resetPassword({ phone: fixtureUser.phone, code: String(sent.devOtp), newPassword: 'ChangedPass123' }))
      .rejects.toThrow('Commit acknowledgement lost');
    expect(values.get(key)).toMatch(/^claimed:/);
    expect(redis.replaceIfValue).toHaveBeenCalledOnce();
    await expect(auth.resetPassword({ phone: fixtureUser.phone, code: String(sent.devOtp), newPassword: 'ChangedPass123' }))
      .rejects.toHaveProperty('status', 401);
  });

  it('reports a committed OTP operation as success even when Redis cleanup fails', async () => {
    const { auth, values, redis } = makeDependencies();
    const sent = await auth.forgotPassword({ phone: fixtureUser.phone });
    const key = [...values.keys()].find((value) => value.startsWith('otp:v1:RESET_PASSWORD:'))!;
    redis.deleteIfValue.mockRejectedValueOnce(new Error('Redis temporarily unavailable'));
    const request = { phone: fixtureUser.phone, code: String(sent.devOtp), newPassword: 'ChangedPass123' };
    await expect(auth.resetPassword(request)).resolves.toEqual({ passwordUpdated: true });
    expect(values.get(key)).toMatch(/^claimed:/);
    await expect(auth.resetPassword(request)).rejects.toHaveProperty('status', 401);
  });

  it.each(['VERIFY_PHONE', 'RESET_PASSWORD'] as const)('allows only one concurrent use of a %s OTP', async (purpose) => {
    const { auth, prisma, transaction } = makeDependencies();
    prisma.user.findUnique.mockResolvedValue({ ...fixtureUser, isPhoneVerified: false });
    const sent = await auth.sendOtp({ phone: fixtureUser.phone, purpose });
    const apply = () => purpose === 'VERIFY_PHONE'
      ? auth.verifyOtp({ phone: fixtureUser.phone, code: String(sent.devOtp) })
      : auth.resetPassword({ phone: fixtureUser.phone, code: String(sent.devOtp), newPassword: 'ChangedPass123' });
    const results = await Promise.allSettled([apply(), apply()]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(transaction.user.update).toHaveBeenCalledOnce();
  });

  it('rejects an issued access token immediately after password reset, even in the same second', async () => {
    const { auth, prisma, transaction } = makeDependencies();
    fixtureUser.passwordHash = await bcrypt.hash('LocalTest123', 4);
    const login = await auth.login({ phone: fixtureUser.phone, password: 'LocalTest123' });
    const guard = new AccessTokenGuard(prisma as unknown as PrismaService);
    const request = { headers: { authorization: `Bearer ${login.accessToken}` } };
    const context = { switchToHttp: () => ({ getRequest: () => request }) } as ExecutionContext;
    await expect(guard.canActivate(context)).resolves.toBe(true);
    const otp = await auth.forgotPassword({ phone: fixtureUser.phone });
    await auth.resetPassword({ phone: fixtureUser.phone, code: String(otp.devOtp), newPassword: 'ChangedPass123' });
    expect(transaction.user.update.mock.calls[0][0].data).toMatchObject({ sessionVersion: { increment: 1 } });
    prisma.user.findUnique.mockResolvedValue({ ...fixtureUser, sessionVersion: 1 });
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('normalizes national/international aliases for registration and account rate limits', async () => {
    const { auth, prisma, redis } = makeDependencies();
    await auth.register({ phone: '+84 912 345 678', password: 'LocalTest123', fullName: 'Test' });
    expect(prisma.user.create.mock.calls[0][0].data.phone).toBe(fixtureUser.phone);
    prisma.user.findUnique.mockResolvedValue(null as never);
    await auth.login({ phone: '0912345678', password: 'LocalTest123' }).catch(() => {});
    const firstKey = redis.incrementWithTtl.mock.calls.at(-1)![0];
    await auth.login({ phone: '0084912345678', password: 'LocalTest123' }).catch(() => {});
    expect(redis.incrementWithTtl.mock.calls.at(-1)![0]).toBe(firstKey);
    expect(prisma.user.findUnique).toHaveBeenLastCalledWith({ where: { phone: fixtureUser.phone } });
  });

  it('rotates refresh tokens once and rejects reuse of the old token', async () => {
    const { auth, prisma, transaction } = makeDependencies();
    fixtureUser.passwordHash = await bcrypt.hash('LocalTest123', 4);
    const login = await auth.login({ phone: fixtureUser.phone, password: 'LocalTest123' }, '127.0.0.1');
    const rotated = await auth.refresh(login.refreshToken, '127.0.0.1');

    expect(rotated.refreshToken).not.toBe(login.refreshToken);
    expect(transaction.refreshToken.updateMany).toHaveBeenCalledOnce();
    await expect(auth.refresh(login.refreshToken, '127.0.0.1')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.$transaction).toHaveBeenCalledTimes(3);
    expect(transaction.refreshToken.create).toHaveBeenCalledTimes(2);

    await auth.logout(rotated.refreshToken);
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'refresh-id', revokedAt: null }),
    }));
  });

  it('rejects a login whose verified password changed before the user lock was acquired', async () => {
    const { auth, prisma, transaction } = makeDependencies();
    const oldHash = await bcrypt.hash('LocalTest123', 4);
    prisma.user.findUnique.mockResolvedValue({ ...fixtureUser, passwordHash: oldHash });
    transaction.user.findUnique.mockResolvedValue({ ...fixtureUser, passwordHash: 'reset-password-hash' });

    await expect(auth.login({ phone: fixtureUser.phone, password: 'LocalTest123' }, '127.0.0.1'))
      .rejects.toBeInstanceOf(UnauthorizedException);
    expect(transaction.$queryRaw).toHaveBeenCalledOnce();
    expect(transaction.refreshToken.create).not.toHaveBeenCalled();
    expect(prisma.refreshToken.create).not.toHaveBeenCalled();
  });

  it('does not mint a refresh session after reset revoked the token while acquiring the lock', async () => {
    const { auth, transaction } = makeDependencies();
    fixtureUser.passwordHash = await bcrypt.hash('LocalTest123', 4);
    const login = await auth.login({ phone: fixtureUser.phone, password: 'LocalTest123' }, '127.0.0.1');
    transaction.refreshToken.create.mockClear();
    transaction.refreshToken.updateMany.mockResolvedValue({ count: 0 });

    await expect(auth.refresh(login.refreshToken, '127.0.0.1')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(transaction.$queryRaw).toHaveBeenCalledTimes(2);
    expect(transaction.refreshToken.create).not.toHaveBeenCalled();
  });

  it('rejects an in-flight old-password login after password reset finishes', async () => {
    const { auth, prisma, transaction } = makeDependencies();
    const oldUser = { ...fixtureUser, passwordHash: await bcrypt.hash('LocalTest123', 4) };
    let currentUser = oldUser;
    prisma.user.findUnique.mockImplementation(async () => ({ ...currentUser }));
    transaction.user.findUnique.mockImplementation(async () => ({ ...currentUser }));
    transaction.user.update.mockImplementation(async ({ data }) => {
      currentUser = { ...currentUser, passwordHash: data.passwordHash };
      return {};
    });
    let releaseLogin!: () => void;
    let reachedLock!: () => void;
    const waiting = new Promise<void>((resolve) => { reachedLock = resolve; });
    const release = new Promise<void>((resolve) => { releaseLogin = resolve; });
    transaction.$queryRaw.mockImplementationOnce(async () => {
      reachedLock();
      await release;
      return [];
    });
    const login = auth.login({ phone: fixtureUser.phone, password: 'LocalTest123' }, '127.0.0.1');
    const rejected = expect(login).rejects.toBeInstanceOf(UnauthorizedException);
    await waiting;
    try {
      const sent = await auth.forgotPassword({ phone: fixtureUser.phone }, '127.0.0.1');
      await auth.resetPassword({ phone: fixtureUser.phone, code: String(sent.devOtp), newPassword: 'ChangedPass123' }, '127.0.0.1');
    } finally {
      releaseLogin();
    }
    await rejected;
    expect(transaction.refreshToken.create).not.toHaveBeenCalled();
    expect(transaction.refreshToken.updateMany).toHaveBeenCalledOnce();
  });

  it.each(['VERIFY_PHONE', 'RESET_PASSWORD'] as const)('preserves a resent %s OTP when an older verification races it', async (purpose) => {
    const { auth, prisma, client, values } = makeDependencies();
    prisma.user.findUnique.mockResolvedValue({ ...fixtureUser, isPhoneVerified: false });
    const sent = await auth.sendOtp({ phone: fixtureUser.phone, purpose }, '127.0.0.1');
    const challenge = [...values.keys()].find((key) => key.startsWith(`otp:v1:${purpose}:`))!;
    client.get.mockImplementationOnce(async (key) => {
      const oldHash = values.get(key)!;
      values.set(key, 'new-challenge-hash');
      return oldHash;
    });
    const pending = purpose === 'VERIFY_PHONE'
      ? auth.verifyOtp({ phone: fixtureUser.phone, code: String(sent.devOtp) }, '127.0.0.1')
      : auth.resetPassword({ phone: fixtureUser.phone, code: String(sent.devOtp), newPassword: 'ChangedPass123' }, '127.0.0.1');

    await expect(pending).rejects.toBeInstanceOf(UnauthorizedException);
    expect(values.get(challenge)).toBe('new-challenge-hash');
    expect(client.getdel).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});
