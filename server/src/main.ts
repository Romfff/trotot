import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe, Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);

  // 1. Cho phép gọi API từ Frontend khác domain/port (Next.js)
  app.enableCors({
    origin: '*',
    credentials: true,
  });

  // 2. Thiết lập tiền tố toàn cục cho mọi API: /api/v1/...
  app.setGlobalPrefix('api/v1');

  // 3. Tự động kiểm tra tính hợp lệ của dữ liệu đầu vào (DTO Validation)
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // Loại bỏ các trường không được khai báo trong DTO
      forbidNonWhitelisted: false,
      transform: true, // Tự động convert kiểu dữ liệu (vd string sang number)
    }),
  );

  // 4. Thiết lập Swagger OpenAPI (Tự động sinh tài liệu API trực quan)
  const swaggerConfig = new DocumentBuilder()
    .setTitle('Nền Tảng Thuê Trọ & Homestay - API Documentation')
    .setDescription(
      'Hệ thống API kết hợp giữa thuê phòng trọ dài hạn (Nhà Tốt) và đặt phòng Homestay ngắn hạn (Agoda).',
    )
    .setVersion('1.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        name: 'Authorization',
        description: 'Nhập JWT token: Bearer <token>',
        in: 'header',
      },
      'JWT-auth',
    )
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document);

  // 5. Khởi động server
  const configService = app.get(ConfigService);
  const port = configService.get<number>('PORT') || 5000;

  await app.listen(port);

  logger.log(`🚀 Server Backend đang chạy tại: http://localhost:${port}/api/v1`);
  logger.log(`📚 Tài liệu Swagger API tại:     http://localhost:${port}/api/docs`);
}

bootstrap();
