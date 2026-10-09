import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AppService } from './app.service';

@ApiTags('Hệ Thống & Kiểm Tra Sức Khỏe')
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get('health')
  @ApiOperation({ summary: 'Kiểm tra trạng thái hoạt động của hệ thống (Health Check)' })
  @ApiResponse({
    status: 200,
    description: 'Hệ thống Backend và CSDL đang hoạt động bình thường',
  })
  async getHealth() {
    return this.appService.getHealthStatus();
  }
}
