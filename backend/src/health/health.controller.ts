import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiOperation, ApiTags, type SchemaObject } from '@nestjs/swagger';
import { PrismaService } from '../database/prisma.service.js';
import { RedisService } from '../redis/redis.service.js';
import { ApiEnvelopedResponses } from '../common/api-docs.js';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Kiểm tra API, PostgreSQL và Redis' })
  @ApiEnvelopedResponses({
    type: 'object',
    properties: {
      status: { type: 'string', example: 'ok' },
      database: { type: 'string', example: 'ok' },
      redis: { type: 'string', example: 'ok' },
    },
  } satisfies SchemaObject, 200, [503])
  async check(): Promise<{ status: string; database: string; redis: string }> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      await this.redis.client.ping();
      return { status: 'ok', database: 'ok', redis: 'ok' };
    } catch {
      throw new ServiceUnavailableException({
        errorCode: 'DEPENDENCY_UNAVAILABLE',
        message: 'Một dịch vụ phụ thuộc chưa sẵn sàng.',
      });
    }
  }
}
