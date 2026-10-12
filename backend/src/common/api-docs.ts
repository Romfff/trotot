import { applyDecorators } from '@nestjs/common';
import { ApiResponse, type SchemaObject } from '@nestjs/swagger';

const errorEnvelope: SchemaObject = {
  type: 'object',
  required: ['success', 'errorCode', 'message'],
  properties: {
    success: { type: 'boolean', example: false },
    errorCode: { type: 'string', example: 'VALIDATION_ERROR' },
    message: { type: 'string', example: 'Dữ liệu gửi lên không hợp lệ.' },
    errors: {
      type: 'array',
      items: {
        type: 'object',
        properties: { field: { type: 'string' }, message: { type: 'string' } },
      },
    },
  },
};

const errorDescriptions: Record<number, string> = {
  400: 'Request validation failed',
  401: 'Authentication or token failed',
  403: 'Account or role is not allowed',
  409: 'Resource conflicts with existing data',
  413: 'Upload exceeds configured size limit',
  429: 'Rate limit exceeded',
  503: 'Database, Redis or Cloudinary is unavailable',
};

export function ApiEnvelopedResponses(
  data: SchemaObject,
  successStatus = 200,
  errorStatuses: number[] = [400],
  meta?: SchemaObject,
): MethodDecorator & ClassDecorator {
  return applyDecorators(
    ApiResponse({
      status: successStatus,
      description: successStatus === 201 ? 'Created' : 'Success',
      schema: {
        type: 'object',
        required: ['success', 'message', 'data'],
        properties: {
          success: { type: 'boolean', example: true },
          message: { type: 'string', example: 'Yêu cầu thành công.' },
          data,
          ...(meta ? { meta } : {}),
        },
      },
    }),
    ...errorStatuses.map((status) => ApiResponse({
      status,
      description: errorDescriptions[status] ?? 'Request failed',
      schema: errorEnvelope,
    })),
  );
}
