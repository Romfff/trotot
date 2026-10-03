import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { v2 as cloudinary } from 'cloudinary';
import { fileTypeFromBuffer } from 'file-type';
import { Readable } from 'node:stream';
import sharp from 'sharp';
import type { UploadApiResponse } from 'cloudinary';
import {
  ALLOWED_IMAGE_MIME_TYPES,
  MAX_INPUT_PIXELS,
  MAX_UPLOAD_BYTES,
} from './storage.constants.js';

export interface ImageUploadResult {
  id: string;
  url: string;
  format: string;
  width: number;
  height: number;
  bytes: number;
}

interface PreparedImage {
  buffer: Buffer;
  width: number;
  height: number;
  format: string;
}

@Injectable()
export class StorageService {
  async uploadOne(file: Express.Multer.File): Promise<ImageUploadResult> {
    const prepared = await this.prepareImage(file);
    this.assertConfigured();
    return this.uploadPrepared(prepared);
  }

  async uploadMany(files: Express.Multer.File[]): Promise<ImageUploadResult[]> {
    if (files.length === 0) {
      throw new BadRequestException({ errorCode: 'NO_FILES', message: 'Vui lòng chọn ít nhất một ảnh.' });
    }
    const prepared: PreparedImage[] = [];
    for (const file of files) prepared.push(await this.prepareImage(file));
    this.assertConfigured();

    const results: ImageUploadResult[] = [];
    try {
      for (const image of prepared) results.push(await this.uploadPrepared(image));
      return results;
    } catch {
      await Promise.allSettled(results.map((image) => this.destroy(image.id)));
      throw new ServiceUnavailableException({
        errorCode: 'MEDIA_BATCH_FAILED',
        message: 'Không tải được toàn bộ ảnh lên Cloudinary; các ảnh đã tải một phần đã được dọn nếu có thể.',
      });
    }
  }

  private async prepareImage(file: Express.Multer.File): Promise<PreparedImage> {
    if (!file?.buffer || file.size > MAX_UPLOAD_BYTES) {
      throw new BadRequestException({ errorCode: 'INVALID_IMAGE', message: 'Ảnh rỗng hoặc vượt giới hạn dung lượng.' });
    }

    try {
      const detected = await fileTypeFromBuffer(file.buffer);
      if (!detected || !ALLOWED_IMAGE_MIME_TYPES.has(detected.mime)) {
        throw new Error('Unsupported image format');
      }
      const pipeline = sharp(file.buffer, { limitInputPixels: MAX_INPUT_PIXELS })
        .rotate()
        .resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 82, effort: 4 });
      const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });
      if (!info.width || !info.height || info.width * info.height > MAX_INPUT_PIXELS) {
        throw new Error('Image dimensions are not allowed');
      }
      return { buffer: data, width: info.width, height: info.height, format: 'webp' };
    } catch {
      throw new BadRequestException({
        errorCode: 'INVALID_IMAGE',
        message: 'Tệp không phải ảnh JPEG, PNG hoặc WebP hợp lệ, hoặc ảnh vượt giới hạn pixel.',
      });
    }
  }

  private async uploadPrepared(image: PreparedImage): Promise<ImageUploadResult> {
    cloudinary.config({ secure: true });

    try {
      const result = await new Promise<UploadApiResponse>((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          {
            folder: 'trotot/property-images',
            resource_type: 'image',
            format: 'webp',
            overwrite: false,
            unique_filename: true,
          },
          (error, uploaded) => {
            if (error || !uploaded) reject(error ?? new Error('Cloudinary returned no upload result'));
            else resolve(uploaded);
          },
        );
        Readable.from([image.buffer]).pipe(stream).on('error', reject);
      });
      return this.toResult(result);
    } catch {
      throw new ServiceUnavailableException({
        errorCode: 'CLOUDINARY_UPLOAD_FAILED',
        message: 'Cloudinary không thể nhận ảnh lúc này. Vui lòng thử lại sau.',
      });
    }
  }

  private assertConfigured(): void {
    if (!process.env.CLOUDINARY_URL?.trim()) {
      throw new ServiceUnavailableException({
        errorCode: 'CLOUDINARY_NOT_CONFIGURED',
        message: 'Chưa cấu hình CLOUDINARY_URL để tải ảnh lên Cloudinary.',
      });
    }
  }

  private async destroy(publicId: string): Promise<void> {
    try {
      await cloudinary.uploader.destroy(publicId, { resource_type: 'image', invalidate: true });
    } catch {
      // Best-effort cleanup; the failed batch is still reported as failed.
    }
  }

  private toResult(result: UploadApiResponse): ImageUploadResult {
    return {
      id: result.public_id,
      url: result.secure_url,
      format: result.format,
      width: result.width,
      height: result.height,
      bytes: result.bytes,
    };
  }
}
