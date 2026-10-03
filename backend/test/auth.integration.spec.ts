import '../src/config/load-env.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { createHash, createHmac, randomInt, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { execFile, spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { decodeJwt, SignJWT } from 'jose';
import { AppModule } from '../src/app.module.js';
import { RedisService } from '../src/redis/redis.service.js';
import { ApiEnvelopeInterceptor } from '../src/common/api-envelope.interceptor.js';
import { ApiExceptionFilter } from '../src/common/api-exception.filter.js';

// Opt-in: creates/drops only its own random local database and Redis key namespace.
describe.skipIf(process.env.AUTH_INTEGRATION !== '1')('Auth with real PostgreSQL and Redis', () => {
  const suffix = randomUUID().replaceAll('-', '');
  const databaseName = `trotot_auth_test_${suffix}`;
  const redisPrefix = `auth-test:${suffix}:`;
  const secret = 'integration-bff-secret-0123456789-abcdef';
  const phone = `092${String(randomInt(10_000_000)).padStart(7, '0')}`;
  const password = 'IntegrationPass123';
  let admin: Pool;
  let database: Pool;
  let app: INestApplication;
  let baseUrl: string;
  let created = false;
  let login: { accessToken: string; refreshToken: string; user: { id: string } };

  async function post(action: string, body: unknown, accessToken?: string, ip = '') {
    const path = `/api/v1/auth/${action}`;
    const timestamp = String(Date.now());
    const signature = createHmac('sha256', secret).update(`${timestamp}\nPOST\n${path}\n${ip}`).digest('hex');
    const response = await fetch(baseUrl + path, {
      method: 'POST', headers: {
        'content-type': 'application/json',
        'x-trotot-proxy-timestamp': timestamp, 'x-trotot-proxy-signature': signature,
        'x-trotot-client-ip': ip,
        ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      }, body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  }
  async function me(accessToken: string) {
    return fetch(baseUrl + '/api/v1/auth/me', { headers: { authorization: `Bearer ${accessToken}` } });
  }

  beforeAll(async () => {
    const source = new URL(process.env.DATABASE_URL!);
    if (process.env.NODE_ENV === 'production' || !['localhost', '127.0.0.1', '[::1]'].includes(source.hostname)
      || !['localhost', '127.0.0.1', '::1'].includes(process.env.REDIS_HOST || 'localhost')) {
      throw new Error('Integration tests only accept local development PostgreSQL/Redis');
    }
    admin = new Pool({ connectionString: source.toString() });
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    created = true;
    source.pathname = `/${databaseName}`;
    process.env.DATABASE_URL = source.toString();
    process.env.NODE_ENV = 'test';
    process.env.OTP_PROVIDER = 'mock';
    process.env.BFF_PROXY_SECRET = secret;
    process.env.REDIS_KEY_PREFIX = redisPrefix;
    await promisify(execFile)(process.execPath, [resolve('node_modules/prisma/build/index.js'), 'migrate', 'deploy'], {
      env: process.env, timeout: 60_000,
    });
    database = new Pool({ connectionString: source.toString() });
    app = await NestFactory.create(AppModule, { logger: false });
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalInterceptors(new ApiEnvelopeInterceptor());
    app.useGlobalFilters(new ApiExceptionFilter());
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
  }, 90_000);

  afterAll(async () => {
    try {
      if (app) {
        const redis = app.get(RedisService).client;
        let cursor = '0';
        const keys: string[] = [];
        do {
          const result = await redis.scan(cursor, 'MATCH', `${redisPrefix}*`, 'COUNT', 100);
          cursor = result[0]; keys.push(...result[1]);
        } while (cursor !== '0');
        // ioredis adds keyPrefix itself for DEL. Remove only the exact test namespace.
        if (keys.length) await redis.del(...keys.map((key) => key.slice(redisPrefix.length)));
        expect((await redis.scan('0', 'MATCH', `${redisPrefix}*`, 'COUNT', 1000))[1]).toHaveLength(0);
      }
    } finally {
      await app?.close();
      await database?.end();
      if (created && /^trotot_auth_test_[a-f0-9]{32}$/.test(databaseName)) {
        await admin.query(`DROP DATABASE "${databaseName}" WITH (FORCE)`);
      }
      await admin?.end();
    }
  }, 30_000);

  it('registers, rejects a phone alias duplicate, verifies OTP and logs in via the alias', async () => {
    const registration = await post('register', { phone, fullName: 'Integration User', password });
    expect(registration.status).toBe(201);
    expect(registration.body.data.user).not.toHaveProperty('sessionVersion');
    const alias = '+84' + phone.slice(1);
    expect((await post('register', { phone: alias, fullName: 'Duplicate', password })).status).toBe(409);
    expect((await post('login', { phone, password })).status).toBe(403);
    const otp = await post('send-otp', { phone: alias, purpose: 'VERIFY_PHONE' });
    expect(otp.status).toBe(200);
    expect((await post('verify-otp', { phone, code: otp.body.data.devOtp })).status).toBe(200);
    expect((await post('verify-otp', { phone, code: otp.body.data.devOtp })).status).toBe(401);
    const result = await post('login', { phone: alias, password });
    expect(result.status).toBe(200);
    login = result.body.data;
    expect((await me(login.accessToken)).status).toBe(200);
  });

  it('rotates once under concurrent refresh, then reset invalidates access and refresh immediately', async () => {
    const results = await Promise.all([
      post('refresh-token', { refreshToken: login.refreshToken }),
      post('refresh-token', { refreshToken: login.refreshToken }),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([200, 401]);
    const rotated = results.find((result) => result.status === 200)!.body.data;
    expect((await me(rotated.accessToken)).status).toBe(200);
    const otp = await post('forgot-password', { phone });
    expect(otp.status).toBe(200);
    expect((await post('reset-password', { phone: '+84' + phone.slice(1), code: otp.body.data.devOtp, newPassword: 'ChangedPass123' })).status).toBe(200);
    expect((await me(login.accessToken)).status).toBe(401);
    expect((await me(rotated.accessToken)).status).toBe(401);
    expect((await post('refresh-token', { refreshToken: rotated.refreshToken })).status).toBe(401);
    expect((await post('login', { phone, password })).status).toBe(401);
    const next = await post('login', { phone, password: 'ChangedPass123' });
    expect(next.status).toBe(200);
    expect((await me(next.body.data.accessToken)).status).toBe(200);
    expect((await post('logout', { refreshToken: next.body.data.refreshToken }, next.body.data.accessToken)).status).toBe(200);
    expect((await post('refresh-token', { refreshToken: next.body.data.refreshToken })).status).toBe(401);
  });

  it('does not share the proxy IP bucket, but keeps phone and real edge-IP limits', async () => {
    for (let index = 0; index < 22; index += 1) {
      const distinct = `093${String(index).padStart(7, '0')}`;
      expect((await post('login', { phone: distinct, password })).status).toBe(401);
    }
    for (let attempt = 0; attempt < 8; attempt += 1) {
      expect((await post('login', { phone: '0940000000', password })).status).toBe(401);
    }
    expect((await post('login', { phone: '+84940000000', password })).status).toBe(429);
    for (let index = 0; index < 20; index += 1) {
      expect((await post('login', { phone: `095${String(index).padStart(7, '0')}`, password }, undefined, '203.0.113.1')).status).toBe(401);
    }
    expect((await post('login', { phone: '0950000021', password }, undefined, '203.0.113.1')).status).toBe(429);
    expect((await post('login', { phone: '0950000021', password }, undefined, '203.0.113.2')).status).toBe(401);
  });

  it('keeps the user refresh allowance after repeated replay of a reset-revoked token', async () => {
    const redis = app.get(RedisService).client;
    const bucket = 'rate:v1:' + createHash('sha256').update(`refresh:user:${login.user.id}`).digest('hex');
    const before = await redis.get(bucket);
    for (let attempt = 0; attempt < 40; attempt += 1) {
      expect([401, 429]).toContain((await post('refresh-token', { refreshToken: login.refreshToken })).status);
    }
    expect(await redis.get(bucket)).toBe(before);
    const current = await post('login', { phone, password: 'ChangedPass123' });
    expect(current.status).toBe(200);
    expect((await post('refresh-token', { refreshToken: current.body.data.refreshToken })).status).toBe(200);
  });

  it('keeps the OTP usable after real SQL rollback, without extending its Redis TTL', async () => {
    const failurePhone = phone.replace(/^092/, '097');
    expect((await post('register', { phone: failurePhone, password, fullName: 'OTP Rollback Test' })).status).toBe(201);
    const redis = app.get(RedisService).client;
    const otpKey = (purpose: string) => `otp:v1:${purpose}:` + createHash('sha256').update(failurePhone).digest('hex');
    // Failure injection is installed only in the dedicated random test database.
    await database.query(`CREATE FUNCTION test_otp_reject_update() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'Controlled OTP transaction failure'; END $$`);
    await database.query('CREATE TRIGGER test_otp_reject_update BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION test_otp_reject_update()');
    try {
      const verify = await post('send-otp', { phone: failurePhone, purpose: 'VERIFY_PHONE' });
      expect(verify.status).toBe(200);
      const verifyKey = otpKey('VERIFY_PHONE');
      const challengeBefore = await redis.get(verifyKey);
      const ttlBefore = await redis.pttl(verifyKey);
      const input = { phone: failurePhone, code: verify.body.data.devOtp };
      expect((await post('verify-otp', input)).status).toBe(500);
      expect(await redis.get(verifyKey)).toBe(challengeBefore);
      expect(await redis.pttl(verifyKey)).toBeGreaterThan(0);
      expect(await redis.pttl(verifyKey)).toBeLessThanOrEqual(ttlBefore);
      expect((await database.query('SELECT is_phone_verified FROM users WHERE phone = $1', [failurePhone])).rows[0].is_phone_verified).toBe(false);
      await database.query('ALTER TABLE users DISABLE TRIGGER test_otp_reject_update');
      expect((await post('verify-otp', input)).status).toBe(200);
      expect((await post('verify-otp', input)).status).toBe(401);

      const reset = await post('forgot-password', { phone: failurePhone });
      expect(reset.status).toBe(200);
      const resetKey = otpKey('RESET_PASSWORD');
      const resetChallengeBefore = await redis.get(resetKey);
      const resetTtlBefore = await redis.pttl(resetKey);
      const rowBefore = (await database.query('SELECT password_hash, session_version FROM users WHERE phone = $1', [failurePhone])).rows[0];
      const resetInput = { phone: failurePhone, code: reset.body.data.devOtp, newPassword: 'RetryPass123' };
      await database.query('ALTER TABLE users ENABLE TRIGGER test_otp_reject_update');
      expect((await post('reset-password', resetInput)).status).toBe(500);
      expect(await redis.get(resetKey)).toBe(resetChallengeBefore);
      expect(await redis.pttl(resetKey)).toBeGreaterThan(0);
      expect(await redis.pttl(resetKey)).toBeLessThanOrEqual(resetTtlBefore);
      expect((await database.query('SELECT password_hash, session_version FROM users WHERE phone = $1', [failurePhone])).rows[0]).toEqual(rowBefore);
      await database.query('ALTER TABLE users DISABLE TRIGGER test_otp_reject_update');
      expect((await post('reset-password', resetInput)).status).toBe(200);
      expect((await post('reset-password', resetInput)).status).toBe(401);
      expect((await post('login', { phone: failurePhone, password: 'RetryPass123' })).status).toBe(200);
    } finally {
      await database.query('DROP TRIGGER test_otp_reject_update ON users');
      await database.query('DROP FUNCTION test_otp_reject_update()');
    }
  });

  it('uses real Redis CAS to preserve newer/expired challenges and keep the original TTL', async () => {
    const redis = app.get(RedisService);
    const key = 'otp-cas-test';
    await redis.client.set(key, 'old-challenge', 'PX', 5_000);
    const ttl = await redis.client.pttl(key);
    expect(await redis.replaceIfValue(key, 'old-challenge', 'claimed:old')).toBe(true);
    expect(await redis.replaceIfValue(key, 'claimed:old', 'old-challenge')).toBe(true);
    expect(await redis.client.pttl(key)).toBeGreaterThan(0);
    expect(await redis.client.pttl(key)).toBeLessThanOrEqual(ttl);
    expect(await redis.replaceIfValue(key, 'old-challenge', 'claimed:old')).toBe(true);
    await redis.client.set(key, 'new-challenge', 'PX', 5_000);
    expect(await redis.replaceIfValue(key, 'claimed:old', 'old-challenge')).toBe(false);
    expect(await redis.client.get(key)).toBe('new-challenge');
    await redis.client.pexpire(key, 1);
    await new Promise((resolveWait) => setTimeout(resolveWait, 10));
    expect(await redis.replaceIfValue(key, 'new-challenge', 'old-challenge')).toBe(false);
    expect(await redis.client.get(key)).toBeNull();
  });

  it('aborts the phone migration on duplicates without deleting either account', async () => {
    const sql = await readFile(resolve('prisma/migrations/20261002000000_auth_handoff_fixes/migration.sql'), 'utf8');
    const client = await database.connect();
    try {
      // A temporary table shadows public.users only on this dedicated test connection.
      await client.query('CREATE TEMP TABLE users (phone varchar(20) UNIQUE)');
      await client.query("INSERT INTO users (phone) VALUES ('0912345678'), ('+84912345678')");
      await expect(client.query(sql)).rejects.toThrow('Phone normalization collision');
      await client.query('ROLLBACK');
      expect((await client.query('SELECT count(*)::int AS count FROM users')).rows[0].count).toBe(2);
      await client.query("DELETE FROM users WHERE phone = '0912345678'");
      await client.query(sql);
      expect((await client.query('SELECT phone FROM users')).rows[0].phone).toBe('0912345678');
    } finally {
      await client.query('DROP TABLE IF EXISTS pg_temp.users');
      client.release();
    }
  });

  it('runs real Auth through a built Next BFF and keeps refresh only in HttpOnly cookies', async () => {
    const socket = createServer();
    socket.listen(0, '127.0.0.1');
    await once(socket, 'listening');
    const port = (socket.address() as { port: number }).port;
    await new Promise<void>((resolveClose) => socket.close(() => resolveClose()));
    const origin = `http://localhost:${port}`;
    const frontend = spawn(process.execPath, [resolve('../frontend/node_modules/next/dist/bin/next'),
      'start', '--hostname', '127.0.0.1', '--port', String(port)], {
      cwd: resolve('../frontend'), env: { ...process.env, NODE_ENV: 'production',
        BACKEND_API_URL: baseUrl + '/api/v1', FRONTEND_ORIGIN: origin,
        BFF_PROXY_SECRET: secret, TRUSTED_CLIENT_IP_HEADER: '' }, stdio: ['ignore', 'ignore', 'ignore'],
    });
    try {
      let ready = false;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        if (frontend.exitCode !== null) throw new Error('Next BFF exited; build frontend before integration tests');
        ready = await fetch(origin + '/login').then((result) => result.ok, () => false);
        if (ready) break;
        await new Promise((resolveWait) => setTimeout(resolveWait, 100));
      }
      expect(ready).toBe(true);
      let cookie = '';
      async function bff(action: string, input: unknown, accessToken?: string) {
        const response = await fetch(origin + '/api/auth/' + action, {
          method: 'POST', headers: { origin, 'content-type': 'application/json', cookie,
            ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}) }, body: JSON.stringify(input),
        });
        const setCookie = response.headers.get('set-cookie');
        if (setCookie) cookie = setCookie.split(';')[0];
        return { response, body: await response.json(), setCookie };
      }
      const anotherPhone = phone.replace(/^092/, '098');
      expect((await bff('register', { phone: anotherPhone, password, fullName: 'BFF Integration User' })).response.status).toBe(201);
      const otp = await bff('send-otp', { phone: anotherPhone, purpose: 'VERIFY_PHONE' });
      expect(otp.response.status).toBe(200);
      expect((await bff('verify-otp', { phone: anotherPhone, code: otp.body.data.devOtp })).response.status).toBe(200);
      const session = await bff('login', { phone: anotherPhone, password });
      expect(session.response.status).toBe(200);
      expect(session.setCookie).toContain('HttpOnly');
      expect(session.setCookie).toContain('Secure');
      expect(session.body.data).not.toHaveProperty('refreshToken');
      const oldCookie = cookie;
      const refreshed = await bff('refresh', {});
      expect(refreshed.response.status).toBe(200);
      expect(cookie).not.toBe(oldCookie);
      expect(refreshed.body.data).not.toHaveProperty('refreshToken');
      expect((await fetch(origin + '/api/auth/me', {
        headers: { authorization: `Bearer ${refreshed.body.data.accessToken}` },
      })).status).toBe(200);
      const otherAccount = await post('login', { phone, password: 'ChangedPass123' });
      expect(otherAccount.status).toBe(200);
      expect((await post('logout', { refreshToken: 'unknown-refresh-credential-value' }, otherAccount.body.data.accessToken)).status).toBe(401);
      const expiredAccess = await new SignJWT(decodeJwt(refreshed.body.data.accessToken))
        .setProtectedHeader({ alg: 'HS256' }).setExpirationTime(0)
        .sign(new TextEncoder().encode(process.env.JWT_ACCESS_SECRET!));
      expect((await me(expiredAccess)).status).toBe(401);
      const redis = app.get(RedisService).client;
      const bucket = 'rate:v1:' + createHash('sha256').update(`refresh:user:${refreshed.body.data.user.id}`).digest('hex');
      for (const [index, accessToken] of [otherAccount.body.data.accessToken, expiredAccess, undefined].entries()) {
        if (index > 0) {
          expect((await bff('login', { phone: anotherPhone, password })).response.status).toBe(200);
        }
        const activeCookie = cookie;
        const cookieToken = decodeURIComponent(activeCookie.slice('trotot_refresh='.length));
        await redis.set(bucket, '30', 'EX', 900);
        // Exhausted refresh allowance must not block logout or mint an extra token.
        expect((await bff('refresh', {})).response.status).toBe(429);
        expect(cookie).toBe(activeCookie);
        const quotaBefore = await redis.get(bucket);
        const rowsBefore = (await database.query('SELECT count(*)::int AS count FROM refresh_tokens WHERE user_id = $1',
          [refreshed.body.data.user.id])).rows[0].count;
        const logout = await bff('logout', {}, accessToken);
        expect(logout.response.status).toBe(200);
        expect(logout.setCookie).toContain('Max-Age=0');
        expect(await redis.get(bucket)).toBe(quotaBefore);
        const rows = (await database.query('SELECT count(*)::int AS total, count(*) FILTER (WHERE revoked_at IS NULL)::int AS active FROM refresh_tokens WHERE user_id = $1',
          [refreshed.body.data.user.id])).rows[0];
        expect(rows.total).toBe(rowsBefore);
        expect(rows.active).toBe(0);
        expect((await post('refresh-token', { refreshToken: cookieToken })).status).toBe(401);
        expect((await post('logout', { refreshToken: cookieToken })).status).toBe(200);
      }
    } finally {
      if (frontend.exitCode === null) {
        const exited = once(frontend, 'exit');
        frontend.kill();
        await exited;
      }
    }
  }, 30_000);
});
