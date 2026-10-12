import { Injectable, OnModuleDestroy, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { Redis } from 'ioredis';
import { positiveIntegerEnv, requiredEnv } from '../config/environment.js';

const INCREMENT_WITH_TTL = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return current
`;

const DELETE_IF_VALUE = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

const REPLACE_IF_VALUE = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  redis.call('SET', KEYS[1], ARGV[2], 'KEEPTTL')
  return 1
end
return 0
`;

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  readonly client: Redis;

  constructor() {
    const password = requiredEnv('REDIS_PASSWORD');
    this.client = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: positiveIntegerEnv('REDIS_PORT', 6379),
      password,
      keyPrefix: process.env.REDIS_KEY_PREFIX || '',
      lazyConnect: true,
      maxRetriesPerRequest: 2,
      enableOfflineQueue: false,
      retryStrategy: (attempt) => Math.min(attempt * 250, 1500),
    });
    this.client.on('error', (error: Error) => {
      if (process.env.NODE_ENV !== 'test') {
        // Keep connection diagnostics but never log credentials or command data.
        console.error(`Redis connection error: ${error.message}`);
      }
    });
  }

  async onModuleInit(): Promise<void> {
    try {
      if (this.client.status === 'wait') await this.client.connect();
      await this.client.ping();
    } catch {
      throw new ServiceUnavailableException({
        errorCode: 'REDIS_UNAVAILABLE',
        message: 'Không kết nối được Redis. Hãy kiểm tra Docker Compose và cấu hình Redis.',
      });
    }
  }

  async incrementWithTtl(key: string, seconds: number): Promise<number> {
    return Number(await this.client.eval(INCREMENT_WITH_TTL, 1, key, seconds));
  }

  async deleteIfValue(key: string, value: string): Promise<boolean> {
    return Number(await this.client.eval(DELETE_IF_VALUE, 1, key, value)) === 1;
  }

  async replaceIfValue(key: string, expected: string, value: string): Promise<boolean> {
    return Number(await this.client.eval(REPLACE_IF_VALUE, 1, key, expected, value)) === 1;
  }

  async onModuleDestroy(): Promise<void> {
    this.client.disconnect();
  }
}
