import './config/load-env.js';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module.js';
import { validateEnvironment } from './config/environment.js';
import { ApiEnvelopeInterceptor } from './common/api-envelope.interceptor.js';
import { ApiExceptionFilter } from './common/api-exception.filter.js';

async function bootstrap(): Promise<void> {
  validateEnvironment();
  const app = await NestFactory.create(AppModule);
  const apiPrefix = process.env.API_PREFIX || 'api/v1';
  const port = Number(process.env.PORT || 5000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer from 1 to 65535');
  }

  app.setGlobalPrefix(apiPrefix);
  app.enableCors({
    origin: (process.env.CORS_ORIGINS || 'http://localhost:3000')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    credentials: true,
  });
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }));
  app.useGlobalInterceptors(new ApiEnvelopeInterceptor());
  app.useGlobalFilters(new ApiExceptionFilter());

  const openApiConfig = new DocumentBuilder()
    .setTitle('Trotot API')
    .setDescription('Backend Sprint 1 — Auth, Health và Media')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, openApiConfig);
  SwaggerModule.setup('api/docs', app, document);

  await app.listen(port, '127.0.0.1');
}

bootstrap().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Backend startup failed');
  process.exitCode = 1;
});
