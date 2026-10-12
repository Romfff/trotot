import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { PrismaClient } from '../generated/prisma/client.js';
import { databasePoolMax, requiredEnv } from '../config/environment.js';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly connectionPool: Pool;
  constructor() {
    const connectionPool = new Pool({ connectionString: requiredEnv('DATABASE_URL'), max: databasePoolMax() });
    const adapter = new PrismaPg(connectionPool, { disposeExternalPool: true });
    super({ adapter });
    this.connectionPool = connectionPool;
  }

  // One static hot-path read on the SAME adapter pool; no extra pool, dynamic
  // SQL, local TTL or stale visibility after a committed hide/Host ban.
  async publicSearchGeneration(): Promise<string> {
    const result = await this.connectionPool.query<{ generation: string }>({
      name: 'public-search-generation-v1',
      text: 'SELECT generation::text FROM public_search_epoch WHERE id=1',
    });
    const generation = result.rows[0]?.generation;
    if (typeof generation !== 'string' || !/^\d+$/.test(generation)) throw new Error('Public search generation unavailable');
    return generation;
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
