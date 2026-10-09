import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma/prisma.service';

@Injectable()
export class AppService {
  constructor(private readonly prisma: PrismaService) {}

  async getHealthStatus() {
    let dbStatus = 'CONNECTED';
    let postgisVersion = 'N/A';

    try {
      const result: any[] = await this.prisma.$queryRaw`SELECT PostGIS_Version() AS version;`;
      if (result && result.length > 0) {
        postgisVersion = result[0].version;
      }
    } catch (error) {
      dbStatus = 'DISCONNECTED';
    }

    return {
      success: true,
      message: 'Hệ thống Backend TroTot API đang hoạt động ổn định! 🚀',
      data: {
        serverTime: new Date().toISOString(),
        uptimeSeconds: Math.floor(process.uptime()),
        database: {
          status: dbStatus,
          provider: 'PostgreSQL 16',
          spatialExtension: `PostGIS ${postgisVersion}`,
        },
      },
    };
  }
}
