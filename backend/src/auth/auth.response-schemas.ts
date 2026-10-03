import type { SchemaObject } from '@nestjs/swagger';

const string = (example?: string): SchemaObject => ({ type: 'string', ...(example ? { example } : {}) });

export const publicUserSchema: SchemaObject = {
  type: 'object',
  required: ['id', 'phone', 'fullName', 'role'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    phone: string('0912345678'),
    email: { type: 'string', nullable: true },
    fullName: string('Nguyễn Văn An'),
    role: { type: 'string', enum: ['TENANT', 'HOST', 'ADMIN'] },
    avatarUrl: { type: 'string', nullable: true },
    isPhoneVerified: { type: 'boolean', nullable: true },
    isIdentityVerified: { type: 'boolean', nullable: true },
    status: { type: 'string', nullable: true },
    createdAt: { type: 'string', format: 'date-time', nullable: true },
    updatedAt: { type: 'string', format: 'date-time', nullable: true },
  },
};

export const registeredUserSchema: SchemaObject = {
  type: 'object',
  properties: { user: publicUserSchema },
};

export const authSessionSchema: SchemaObject = {
  type: 'object',
  required: ['accessToken', 'refreshToken', 'user'],
  properties: {
    accessToken: string(),
    refreshToken: string(),
    user: publicUserSchema,
  },
};

export const otpResultSchema: SchemaObject = {
  type: 'object',
  properties: {
    accepted: { type: 'boolean', example: true },
    expiresInSeconds: { type: 'integer', example: 300 },
    devOtp: { type: 'string', description: 'Chỉ xuất hiện ở local/dev khi OTP_PROVIDER=mock.' },
  },
};

export const verifiedPhoneSchema: SchemaObject = {
  type: 'object',
  properties: { verified: { type: 'boolean', example: true }, phone: string('0912345678') },
};

export const signedOutSchema: SchemaObject = {
  type: 'object',
  properties: { signedOut: { type: 'boolean', example: true } },
};

export const passwordUpdatedSchema: SchemaObject = {
  type: 'object',
  properties: { passwordUpdated: { type: 'boolean', example: true } },
};
