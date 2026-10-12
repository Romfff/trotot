import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module.js';
import { ApiEnvelopeInterceptor } from '../src/common/api-envelope.interceptor.js';
import { ApiExceptionFilter } from '../src/common/api-exception.filter.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { RedisService } from '../src/redis/redis.service.js';
import { BookingWorkerService } from '../src/bookings/booking-worker.service.js';
import { PaymentRealtimeService } from '../src/payments/payment-realtime.service.js';
import { ChatRealtimeService } from '../src/chat/chat-realtime.service.js';

const publicUser = {
  id: '4b914fec-2b50-4e55-9ccf-29cf871e0fb1',
  phone: '0912345678',
  email: null,
  fullName: 'Test User',
  role: 'TENANT',
  avatarUrl: null,
  isPhoneVerified: false,
  isIdentityVerified: false,
  status: 'ACTIVE',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
};

describe('Auth HTTP contract', () => {
  let app: INestApplication;
  let baseUrl: string;
  const createUser = vi.fn(async () => publicUser);

  beforeEach(() => {
    createUser.mockClear();
  });

  beforeAll(async () => {
    vi.stubEnv('JWT_ACCESS_SECRET', 'test-access-secret-value-0123456789-abcdef');
    vi.stubEnv('JWT_REFRESH_SECRET', 'test-refresh-secret-value-0123456789-abcdef');
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('OTP_PROVIDER', 'mock');

    const prisma = {
      user: {
        create: createUser,
        findUnique: vi.fn(async () => null),
        update: vi.fn(async () => publicUser),
      },
      refreshToken: {
        create: vi.fn(async () => ({})),
        findFirst: vi.fn(async () => null),
        updateMany: vi.fn(async () => ({ count: 0 })),
      },
      $transaction: vi.fn(),
      $queryRaw: vi.fn(),
    };
    const redis = {
      client: { ping: vi.fn(async () => 'PONG') },
      incrementWithTtl: vi.fn(async () => 1),
    };
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService).useValue(prisma)
      .overrideProvider(RedisService).useValue(redis)
      // Auth contract uses mocked DB/Redis; real booking worker is covered in DB integration.
      .overrideProvider(BookingWorkerService).useValue({})
      // Auth HTTP tests do not start Socket.io or external Redis subscribers.
      .overrideProvider(PaymentRealtimeService).useValue({})
      .overrideProvider(ChatRealtimeService).useValue({})
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalInterceptors(new ApiEnvelopeInterceptor());
    app.useGlobalFilters(new ApiExceptionFilter());
    const document = SwaggerModule.createDocument(app, new DocumentBuilder()
      .setTitle('Trotot API')
      .setVersion('0.1.0')
      .addBearerAuth()
      .build());
    SwaggerModule.setup('api/docs', app, document);
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
  }, 20_000);

  afterAll(async () => {
    try { await app?.close(); } finally { vi.unstubAllEnvs(); }
  });

  it('registers through the HTTP route with the standard envelope and fixed TENANT role', async () => {
    const response = await fetch(`${baseUrl}/api/v1/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phone: '0912345678', password: 'LocalTest123', fullName: 'Test User' }),
    });
    const body = await response.json() as { success: boolean; data: { user: Record<string, unknown> } };

    expect(response.status).toBe(201);
    expect(body.success).toBe(true);
    expect(body.data.user.role).toBe('TENANT');
    expect(body.data.user).not.toHaveProperty('passwordHash');
    expect(createUser.mock.calls.at(-1)?.[0].data.role).toBe('TENANT');
  });

  it('rejects a public role override with a structured validation error', async () => {
    const response = await fetch(`${baseUrl}/api/v1/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phone: '0912345679', password: 'LocalTest123', fullName: 'Test User', role: 'ADMIN' }),
    });
    const body = await response.json() as { success: boolean; errorCode: string; errors?: unknown[] };

    expect(response.status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.errorCode).toBe('VALIDATION_ERROR');
    expect(body.errors?.length).toBeGreaterThan(0);
    expect(createUser).not.toHaveBeenCalled();
  });

  it('protects /auth/me and formats missing-token errors in the agreed envelope', async () => {
    const response = await fetch(`${baseUrl}/api/v1/auth/me`);
    const body = await response.json() as { success: boolean; errorCode: string; message: string };

    expect(response.status).toBe(401);
    expect(body).toMatchObject({ success: false, errorCode: 'ACCESS_TOKEN_REQUIRED' });
    expect(body.message).toBeTruthy();
  });

  it('serves Swagger at /api/docs with the auth and multipart upload paths', async () => {
    const [page, specification] = await Promise.all([
      fetch(`${baseUrl}/api/docs`),
      fetch(`${baseUrl}/api/docs-json`),
    ]);
    const document = await specification.json() as { paths: Record<string, unknown> };

    expect(page.status).toBe(200);
    expect(specification.status).toBe(200);
    expect(document.paths).toHaveProperty('/api/v1/auth/register');
    expect(document.paths).toHaveProperty('/api/v1/storage/upload');
    expect(document.paths).toHaveProperty('/api/v1/storage/upload/multiple');
  });
});
