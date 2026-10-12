import {
  type CallHandler,
  type ExecutionContext,
  type INestApplication,
  UnauthorizedException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Request } from 'express';
import { firstValueFrom, of, Subject, throwError } from 'rxjs';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccessTokenGuard } from '../auth/access-token.guard.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { ApiEnvelopeInterceptor } from '../common/api-envelope.interceptor.js';
import { ApiExceptionFilter } from '../common/api-exception.filter.js';
import { Sprint2UserRateLimitGuard, sprint2RateLimits } from '../common/sprint2-rate-limit.guard.js';
import { RedisService } from '../redis/redis.service.js';
import { StorageController } from './storage.controller.js';
import { StorageUploadInterceptor } from './storage-upload.interceptor.js';
import { MAX_CONCURRENT_UPLOADS, MAX_UPLOAD_FILES } from './storage.constants.js';
import { StorageService } from './storage.service.js';

function context(userId: string): ExecutionContext {
  return { switchToHttp: () => ({ getRequest: () => ({ user: { id: userId } }) }) } as ExecutionContext;
}

describe('Upload worker capacity', () => {
  function interceptor() {
    return new StorageUploadInterceptor({ assertConfigured: vi.fn() } as unknown as StorageService);
  }

  it('bounds different users, prevents concurrent uploads by one user and releases completed slots', async () => {
    const limit = interceptor();
    const pending = Array.from({ length: MAX_CONCURRENT_UPLOADS }, () => new Subject());
    for (const [index, stream] of pending.entries()) {
      limit.intercept(context(`host-${index}`), { handle: () => stream }).subscribe();
    }
    const next = { handle: vi.fn(() => of('processed')) };
    expect(() => limit.intercept(context('other-host'), next)).toThrow(expect.objectContaining({ status: 429 }));
    expect(() => limit.intercept(context('host-0'), next)).toThrow(expect.objectContaining({ status: 429 }));
    expect(next.handle).not.toHaveBeenCalled();
    pending[0].complete();
    await expect(firstValueFrom(limit.intercept(context('other-host'), next))).resolves.toBe('processed');
    await expect(firstValueFrom(limit.intercept(context('host-0'), next))).resolves.toBe('processed');
    for (const stream of pending) stream.complete();
  });

  it.each(['observable error', 'synchronous error'])('releases the slot after a %s', async (mode) => {
    const limit = interceptor();
    const failed: CallHandler = { handle: () => {
      if (mode === 'synchronous error') throw new Error('synthetic failure');
      return throwError(() => new Error('synthetic failure'));
    } };
    await expect(firstValueFrom(limit.intercept(context('host-1'), failed))).rejects.toThrow('synthetic failure');
    await expect(firstValueFrom(limit.intercept(context('host-1'), { handle: () => of('retry') }))).resolves.toBe('retry');
  });
});

// Real Nest HTTP/multipart pipeline and RolesGuard; Auth identity, Redis and provider are fixtures.
describe('Upload HTTP resource protection', () => {
  let app: INestApplication;
  let base: string;
  let storage: StorageService;
  const incrementWithTtl = vi.fn();
  const uploaded = { id: 'fixture', url: 'https://example.com/fixture.webp', format: 'webp', width: 2, height: 2, bytes: 10 };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [StorageController],
      providers: [StorageService, StorageUploadInterceptor, Sprint2UserRateLimitGuard, RolesGuard,
        { provide: RedisService, useValue: { incrementWithTtl } }],
    }).overrideGuard(AccessTokenGuard).useValue({
      canActivate(ctx: ExecutionContext) {
        const request = ctx.switchToHttp().getRequest<Request>();
        const fixture = /^Bearer (TENANT|HOST|ADMIN):([a-z-]+)$/.exec(request.headers.authorization || '');
        if (!fixture) throw new UnauthorizedException();
        request.user = { id: fixture[2], role: fixture[1] as 'TENANT' | 'HOST' | 'ADMIN' };
        return true;
      },
    }).compile();
    app = module.createNestApplication({ logger: false });
    app.setGlobalPrefix('api/v1');
    app.useGlobalInterceptors(new ApiEnvelopeInterceptor());
    app.useGlobalFilters(new ApiExceptionFilter());
    storage = module.get(StorageService);
    await app.listen(0, '127.0.0.1');
    base = await app.getUrl();
  });

  beforeEach(() => {
    vi.stubEnv('CLOUDINARY_URL', 'cloudinary://fixture:fixture@demo');
    incrementWithTtl.mockReset().mockResolvedValue(1);
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
  afterAll(async () => { await app?.close(); });

  async function sendForm(route: string, form: FormData, identity = 'HOST:host-a') {
    const response = await fetch(base + '/api/v1/storage/' + route, {
      method: 'POST', headers: identity ? { authorization: 'Bearer ' + identity } : {}, body: form,
    });
    return { status: response.status, body: await response.json() };
  }

  async function upload(route = 'upload', identity = 'HOST:host-a', mime = 'image/png') {
    const form = new FormData();
    form.append(route === 'upload' ? 'file' : 'files', new Blob(['fixture'], { type: mime }), 'fixture.png');
    return sendForm(route, form, identity);
  }

  it.each(['upload', 'upload/multiple'])('rejects disabled %s before multipart filtering or processing', async (route) => {
    vi.stubEnv('CLOUDINARY_URL', '');
    const one = vi.spyOn(storage, 'uploadOne');
    const many = vi.spyOn(storage, 'uploadMany');
    const result = await upload(route, 'HOST:host-a', 'text/plain');
    expect(result).toMatchObject({ status: 503, body: { success: false, errorCode: 'CLOUDINARY_NOT_CONFIGURED' } });
    expect(one).not.toHaveBeenCalled();
    expect(many).not.toHaveBeenCalled();
  });

  it('keeps anonymous and Tenant access blocked before quota and multipart processing', async () => {
    expect((await upload('upload', '')).status).toBe(401);
    expect((await upload('upload', 'TENANT:tenant-a')).status).toBe(403);
    expect(incrementWithTtl).not.toHaveBeenCalled();
  });

  it('allows Host/Admin and shares the existing user quota across single/multiple uploads', async () => {
    vi.spyOn(storage, 'uploadOne').mockResolvedValue(uploaded);
    vi.spyOn(storage, 'uploadMany').mockResolvedValue([uploaded]);
    expect(await upload()).toMatchObject({ status: 201, body: { success: true, data: uploaded } });
    expect((await upload('upload/multiple')).status).toBe(201);
    expect(incrementWithTtl.mock.calls[0]).toEqual(incrementWithTtl.mock.calls[1]);
    expect((await upload('upload', 'ADMIN:admin-a')).status).toBe(201);
    expect(incrementWithTtl.mock.calls[2]).not.toEqual(incrementWithTtl.mock.calls[0]);
  });

  it('rejects an exhausted user quota before an invalid multipart file is parsed', async () => {
    incrementWithTtl.mockResolvedValue(sprint2RateLimits.write + 1);
    const one = vi.spyOn(storage, 'uploadOne');
    expect(await upload('upload', 'HOST:host-a', 'text/plain')).toMatchObject({
      status: 429, body: { success: false, errorCode: 'RATE_LIMITED' },
    });
    expect(one).not.toHaveBeenCalled();
  });

  it('releases the upload slot after multipart rejection', async () => {
    vi.spyOn(storage, 'uploadOne').mockResolvedValue(uploaded);
    expect((await upload('upload', 'HOST:host-a', 'text/plain')).status).toBe(400);
    expect((await upload()).status).toBe(201);
  });

  it.each([
    ['upload', 'before'], ['upload', 'after'],
    ['upload/multiple', 'before'], ['upload/multiple', 'after'],
  ])('rejects extra text fields %s/%s without processing images and permits a clean retry', async (route, position) => {
    const one = vi.spyOn(storage, 'uploadOne').mockResolvedValue(uploaded);
    const many = vi.spyOn(storage, 'uploadMany').mockResolvedValue([uploaded]);
    const form = new FormData();
    if (position === 'before') form.append('extra', 'unrequested text');
    form.append(route === 'upload' ? 'file' : 'files', new Blob(['fixture'], { type: 'image/png' }), 'fixture.png');
    if (position === 'after') form.append('extra', 'unrequested text');
    expect(await sendForm(route, form)).toMatchObject({ status: 400, body: { success: false } });
    expect(one).not.toHaveBeenCalled();
    expect(many).not.toHaveBeenCalled();
    expect((await upload(route)).status).toBe(201);
  });

  it.each(['upload', 'upload/multiple'])('accepts the exact file limit and rejects the next part for %s', async (route) => {
    const one = vi.spyOn(storage, 'uploadOne').mockResolvedValue(uploaded);
    const many = vi.spyOn(storage, 'uploadMany').mockResolvedValue([uploaded]);
    const max = route === 'upload' ? 1 : MAX_UPLOAD_FILES;
    function batch(count: number) {
      const form = new FormData();
      for (let index = 0; index < count; index++) {
        form.append(route === 'upload' ? 'file' : 'files', new Blob(['fixture'], { type: 'image/png' }), `fixture-${index}.png`);
      }
      return form;
    }
    expect((await sendForm(route, batch(max))).status).toBe(201);
    const images = route === 'upload' ? [one.mock.calls[0][0]] : many.mock.calls[0][0];
    expect(images).toHaveLength(max);
    one.mockClear(); many.mockClear();
    expect(await sendForm(route, batch(max + 1))).toMatchObject({ status: 400, body: { success: false } });
    expect(one).not.toHaveBeenCalled();
    expect(many).not.toHaveBeenCalled();
    expect((await upload(route)).status).toBe(201);
  });
});
