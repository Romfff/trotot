import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

type FieldError = { field: string; message: string };

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const multerCode = exception instanceof Error && exception.name === 'MulterError' && 'code' in exception
      ? String(exception.code)
      : undefined;
    const multerTooLarge = multerCode === 'LIMIT_FILE_SIZE' || multerCode === 'LIMIT_FILE_COUNT';
    const status = exception instanceof HttpException
      ? exception.getStatus()
      : multerCode
        ? multerTooLarge ? HttpStatus.PAYLOAD_TOO_LARGE : HttpStatus.BAD_REQUEST
        : HttpStatus.INTERNAL_SERVER_ERROR;
    const raw = exception instanceof HttpException ? exception.getResponse() : undefined;
    const body = typeof raw === 'object' && raw !== null ? raw as Record<string, unknown> : {};
    const rawMessage = body.message ?? (typeof raw === 'string' ? raw : undefined);
    const messages = Array.isArray(rawMessage) ? rawMessage.map(String) : [];
    const message = typeof rawMessage === 'string'
      ? rawMessage
      : multerTooLarge
        ? 'Tệp tải lên vượt giới hạn dung lượng hoặc số lượng.'
        : messages.length > 0
          ? 'Dữ liệu gửi lên không hợp lệ.'
          : status >= 500
            ? 'Đã xảy ra lỗi máy chủ.'
            : 'Yêu cầu không thể xử lý.';
    const errors: FieldError[] = messages.map((item) => {
      const separator = item.indexOf(' ');
      return {
        field: separator > 0 ? item.slice(0, separator) : 'request',
        message: item,
      };
    });
    const errorCode = typeof body.errorCode === 'string'
      ? body.errorCode
      : multerCode
        ? multerTooLarge ? 'UPLOAD_LIMIT_EXCEEDED' : 'INVALID_UPLOAD'
        : this.codeForStatus(status);

    if (status >= 500) {
      this.logger.error(`${request.method} ${request.url.split('?')[0]} failed`,
        exception instanceof Error ? exception.stack : undefined);
    }

    // Guards/pipes can fail before controller headers are applied. Never cache an API error.
    response.setHeader('Cache-Control', 'no-store');
    if (status === 429 && Number.isSafeInteger(body.retryAfter) && Number(body.retryAfter) > 0) response.setHeader('Retry-After', String(body.retryAfter));
    response.status(status).json({
      success: false,
      errorCode,
      message,
      // Only the approved repricing contract carries public data on failure.
      ...(['PRICE_CHANGED','REFUND_QUOTE_CHANGED'].includes(errorCode) && body.data ? { data: body.data } : {}),
      ...(errorCode === 'STALE_APPOINTMENT_STATUS' && body.data && typeof body.data === 'object' && 'currentStatus' in body.data
        && ['PENDING','ACCEPTED','REJECTED','COMPLETED','CANCELLED'].includes(String(body.data.currentStatus))
        ? { data: { currentStatus: body.data.currentStatus } } : {}),
      ...(errors.length > 0 ? { errors } : {}),
    });
  }

  private codeForStatus(status: number): string {
    const codes: Record<number, string> = {
      400: 'VALIDATION_ERROR',
      401: 'UNAUTHORIZED',
      403: 'FORBIDDEN',
      404: 'NOT_FOUND',
      409: 'CONFLICT',
      413: 'PAYLOAD_TOO_LARGE',
      429: 'RATE_LIMITED',
      503: 'SERVICE_UNAVAILABLE',
    };
    return codes[status] ?? 'INTERNAL_ERROR';
  }
}
