import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { Writable } from 'node:stream';
import sharp from 'sharp';

const cloudinaryMock = vi.hoisted(() => ({
  config: vi.fn(),
  uploadStream: vi.fn(),
  destroy: vi.fn().mockResolvedValue({ result: 'ok' }),
}));

vi.mock('cloudinary', () => ({
  v2: {
    config: cloudinaryMock.config,
    uploader: {
      upload_stream: cloudinaryMock.uploadStream,
      destroy: cloudinaryMock.destroy,
    },
  },
}));

import { StorageService } from './storage.service.js';

const validPng = () => sharp({
  create: { width: 2, height: 2, channels: 3, background: { r: 255, g: 0, b: 0 } },
}).png().toBuffer();

function file(buffer: Buffer, mimetype = 'image/png'): Express.Multer.File {
  return {
    buffer,
    size: buffer.length,
    mimetype,
    originalname: 'upload.png',
  } as Express.Multer.File;
}

function mockUploadSequence(outcomes: Array<{ id?: string; error?: Error }>): Buffer[] {
  const uploadedBuffers: Buffer[] = [];
  let current = 0;
  cloudinaryMock.uploadStream.mockImplementation((
    _options: unknown,
    callback: (error?: Error | null, result?: Record<string, unknown>) => void,
  ) => {
    const outcome = outcomes[current++];
    const chunks: Buffer[] = [];
    const stream = new Writable({
      write(chunk, _encoding, done) {
        chunks.push(Buffer.from(chunk));
        done();
      },
    });
    stream.on('finish', () => {
      uploadedBuffers.push(Buffer.concat(chunks));
      if (outcome?.error) callback(outcome.error);
      else callback(null, {
        public_id: outcome?.id ?? 'trotot/test-image',
        secure_url: 'https://res.cloudinary.com/test/image/upload/test.webp',
        format: 'webp',
        width: 2,
        height: 2,
        bytes: chunks.reduce((total, chunk) => total + chunk.length, 0),
      });
    });
    return stream;
  });
  return uploadedBuffers;
}

describe('StorageService', () => {
  const service = new StorageService();
  const oldCloudinaryUrl = process.env.CLOUDINARY_URL;

  afterEach(() => {
    if (oldCloudinaryUrl === undefined) delete process.env.CLOUDINARY_URL;
    else process.env.CLOUDINARY_URL = oldCloudinaryUrl;
  });

  beforeEach(() => {
    cloudinaryMock.config.mockReset();
    cloudinaryMock.uploadStream.mockReset();
    cloudinaryMock.destroy.mockReset().mockResolvedValue({ result: 'ok' });
  });

  it('rejects a fake image before contacting Cloudinary', async () => {
    delete process.env.CLOUDINARY_URL;
    await expect(service.uploadOne(file(Buffer.from('not an image'))))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('processes a valid image but reports Cloudinary as blocked without credentials', async () => {
    delete process.env.CLOUDINARY_URL;
    await expect(service.uploadOne(file(await validPng())))
      .rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('uploads a normalized WebP buffer and returns safe Cloudinary metadata', async () => {
    process.env.CLOUDINARY_URL = 'cloudinary://test:test@demo';
    const buffers = mockUploadSequence([{ id: 'trotot/one' }]);

    await expect(service.uploadOne(file(await validPng()))).resolves.toEqual({
      id: 'trotot/one',
      url: 'https://res.cloudinary.com/test/image/upload/test.webp',
      format: 'webp',
      width: 2,
      height: 2,
      bytes: expect.any(Number),
    });
    expect(buffers).toHaveLength(1);
    expect(buffers[0].subarray(0, 4).toString()).toBe('RIFF');
    expect(buffers[0].subarray(8, 12).toString()).toBe('WEBP');
    expect(cloudinaryMock.config).toHaveBeenCalledWith({ secure: true });
  });

  it('cleans up uploaded Cloudinary objects when a multi-file batch fails', async () => {
    process.env.CLOUDINARY_URL = 'cloudinary://test:test@demo';
    mockUploadSequence([{ id: 'trotot/first' }, { error: new Error('provider failure') }]);
    const image = await validPng();

    await expect(service.uploadMany([file(image), file(image)]))
      .rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(cloudinaryMock.destroy).toHaveBeenCalledWith('trotot/first', {
      resource_type: 'image',
      invalidate: true,
    });
  });
});
