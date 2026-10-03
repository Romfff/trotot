import { describe, expect, it, vi } from 'vitest';
import type { ArgumentsHost } from '@nestjs/common';
import { ApiExceptionFilter } from './api-exception.filter.js';

describe('ApiExceptionFilter', () => {
  it('maps Multer size/count failures to a safe 413 envelope', () => {
    const json = vi.fn();
    const status = vi.fn(() => ({ json }));
    const host = {
      switchToHttp: () => ({
        getRequest: () => ({ method: 'POST', url: '/api/v1/storage/upload' }),
        getResponse: () => ({ status }),
      }),
    } as unknown as ArgumentsHost;
    const error = Object.assign(new Error('internal upload details'), {
      name: 'MulterError',
      code: 'LIMIT_FILE_SIZE',
    });

    new ApiExceptionFilter().catch(error, host);

    expect(status).toHaveBeenCalledWith(413);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      errorCode: 'UPLOAD_LIMIT_EXCEEDED',
      message: 'Tệp tải lên vượt giới hạn dung lượng hoặc số lượng.',
    }));
  });
});
