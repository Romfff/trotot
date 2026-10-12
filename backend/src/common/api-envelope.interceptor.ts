import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { map, Observable } from 'rxjs';
import { PaginatedResult } from './paginated-result.js';
import { PaginatedResource } from './paginated-resource.js';

@Injectable()
export class ApiEnvelopeInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      map((data: unknown) => ({
        success: true,
        message: 'Yêu cầu thành công.',
        data: data instanceof PaginatedResult || data instanceof PaginatedResource ? data.data : data,
        ...(data instanceof PaginatedResult || data instanceof PaginatedResource ? { meta: data.meta } : {}),
      })),
    );
  }
}
