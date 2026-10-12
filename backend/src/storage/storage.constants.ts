import '../config/load-env.js';
import { positiveIntegerEnv } from '../config/environment.js';

export const MAX_UPLOAD_BYTES = positiveIntegerEnv('MAX_UPLOAD_BYTES', 10 * 1024 * 1024);
export const MAX_UPLOAD_FILES = Math.min(8, positiveIntegerEnv('MAX_UPLOAD_FILES', 8));
export const MAX_INPUT_PIXELS = 25_000_000;
export const MAX_CONCURRENT_UPLOADS = 2;
export const ALLOWED_IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
