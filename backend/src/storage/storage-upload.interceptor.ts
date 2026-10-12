import {
  type CallHandler,
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  type NestInterceptor,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { defer, finalize, type Observable } from 'rxjs';
import { MAX_CONCURRENT_UPLOADS } from './storage.constants.js';
import { StorageService } from './storage.service.js';

@Injectable()
export class StorageUploadInterceptor implements NestInterceptor {
  // Capacity belongs to this worker's memory; the existing Redis guard shares the rate quota across workers.
  private readonly activeUsers = new Set<string>();

  constructor(private readonly storage: StorageService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    this.storage.assertConfigured();
    const userId = context.switchToHttp().getRequest<Request>().user?.id;
    if (!userId) {
      throw new UnauthorizedException({ errorCode: 'ACCESS_TOKEN_REQUIRED', message: 'Cần đăng nhập để tiếp tục.' });
    }
    if (this.activeUsers.has(userId) || this.activeUsers.size >= MAX_CONCURRENT_UPLOADS) {
      throw new HttpException({
        errorCode: 'RATE_LIMITED', message: 'Đang xử lý ảnh tải lên. Vui lòng thử lại sau.',
      }, HttpStatus.TOO_MANY_REQUESTS);
    }
    this.activeUsers.add(userId);
    return defer(() => next.handle()).pipe(finalize(() => this.activeUsers.delete(userId)));
  }
}
