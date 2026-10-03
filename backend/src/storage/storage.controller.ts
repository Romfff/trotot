import '../config/load-env.js';
import {
  BadRequestException,
  Controller,
  Post,
  UploadedFile,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import { AccessTokenGuard } from '../auth/access-token.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { ApiEnvelopedResponses } from '../common/api-docs.js';
import { ALLOWED_IMAGE_MIME_TYPES, MAX_UPLOAD_BYTES, MAX_UPLOAD_FILES } from './storage.constants.js';
import { StorageService } from './storage.service.js';

const imageFileFilter = (
  _request: Request,
  file: Express.Multer.File,
  callback: (error: Error | null, acceptFile: boolean) => void,
): void => {
  if (!ALLOWED_IMAGE_MIME_TYPES.has(file.mimetype)) {
    callback(new BadRequestException('Chỉ nhận ảnh JPEG, PNG hoặc WebP.'), false);
    return;
  }
  callback(null, true);
};

const uploadResultSchema = {
  type: 'object' as const,
  required: ['id', 'url', 'format', 'width', 'height', 'bytes'],
  properties: {
    id: { type: 'string' as const },
    url: { type: 'string' as const, format: 'uri' as const },
    format: { type: 'string' as const, example: 'webp' },
    width: { type: 'integer' as const, example: 1600 },
    height: { type: 'integer' as const, example: 900 },
    bytes: { type: 'integer' as const, example: 156000 },
  },
};

@ApiTags('storage')
@ApiBearerAuth()
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles('HOST', 'ADMIN')
@Controller('storage')
export class StorageController {
  constructor(private readonly storage: StorageService) {}

  @Post('upload')
  @UseInterceptors(FileInterceptor('file', {
    limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
    fileFilter: imageFileFilter,
  }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', required: ['file'], properties: { file: { type: 'string', format: 'binary' } } } })
  @ApiOperation({
    summary: 'Tải một ảnh lên Cloudinary; ảnh được resize và nén thành WebP',
    description: 'Requires HOST or ADMIN role and a valid Bearer access token.',
  })
  @ApiEnvelopedResponses(uploadResultSchema, 201, [400, 401, 403, 413, 503])
  uploadOne(@UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException({ errorCode: 'NO_FILE', message: 'Vui lòng chọn một ảnh.' });
    return this.storage.uploadOne(file);
  }

  @Post('upload/multiple')
  @UseInterceptors(FilesInterceptor('files', MAX_UPLOAD_FILES, {
    limits: { fileSize: MAX_UPLOAD_BYTES, files: MAX_UPLOAD_FILES },
    fileFilter: imageFileFilter,
  }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', required: ['files'], properties: { files: { type: 'array', items: { type: 'string', format: 'binary' } } } } })
  @ApiOperation({
    summary: `Tải tối đa ${MAX_UPLOAD_FILES} ảnh lên Cloudinary; batch lỗi sẽ dọn file đã tải nếu có thể`,
    description: 'Requires HOST or ADMIN role and a valid Bearer access token.',
  })
  @ApiEnvelopedResponses({ type: 'array', items: uploadResultSchema }, 201, [400, 401, 403, 413, 503])
  uploadMany(@UploadedFiles() files?: Express.Multer.File[]) {
    return this.storage.uploadMany(files ?? []);
  }
}
