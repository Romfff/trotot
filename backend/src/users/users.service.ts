import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';

export interface PublicUser {
  id: string;
  phone: string;
  email: string | null;
  fullName: string;
  role: string;
  avatarUrl: string | null;
  isPhoneVerified: boolean | null;
  isIdentityVerified: boolean | null;
  status: string | null;
  createdAt: Date | null;
  updatedAt: Date | null;
}

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  findActivePublicUser(id: string): Promise<PublicUser | null> {
    return this.prisma.user.findUnique({
      where: { id, status: 'ACTIVE' },
      select: {
        id: true,
        phone: true,
        email: true,
        fullName: true,
        role: true,
        avatarUrl: true,
        isPhoneVerified: true,
        isIdentityVerified: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }
}
