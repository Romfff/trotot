import '../src/config/load-env.js';
import { PrismaPg } from '@prisma/adapter-pg';
import bcrypt from 'bcrypt';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { requiredEnv } from '../src/config/environment.js';

if (process.env.NODE_ENV === 'production' || process.env.ALLOW_DEV_SEED !== 'true') {
  throw new Error('Development seed is disabled. Set ALLOW_DEV_SEED=true only in a local development environment.');
}
const databaseHost = new URL(requiredEnv('DATABASE_URL')).hostname;
if (!['localhost', '127.0.0.1', '::1'].includes(databaseHost)) {
  throw new Error('Development seed only accepts a loopback DATABASE_URL.');
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: requiredEnv('DATABASE_URL') }),
});

const demoUsers = [
  { phone: '0999999911', fullName: 'Local Tenant', role: 'TENANT' },
  { phone: '0999999922', fullName: 'Local Host', role: 'HOST' },
  { phone: '0999999933', fullName: 'Local Admin', role: 'ADMIN' },
] as const;

try {
  await prisma.$connect();
  for (const demo of demoUsers) {
    const passwordHash = await bcrypt.hash('LocalOnly-Trotot-2026!', 12);
    const user = await prisma.user.upsert({
      where: { phone: demo.phone },
      create: {
        phone: demo.phone,
        fullName: demo.fullName,
        role: demo.role,
        passwordHash,
        isPhoneVerified: true,
        status: 'ACTIVE',
      },
      update: {
        fullName: demo.fullName,
        role: demo.role,
        passwordHash,
        isPhoneVerified: true,
        status: 'ACTIVE',
      },
      select: { id: true },
    });
    if (demo.role === 'HOST') {
      await prisma.hostProfile.upsert({
        where: { userId: user.id },
        create: { userId: user.id },
        update: {},
      });
    }
  }
  console.info('Local demo accounts ready. Never reuse the documented demo password outside a throwaway local database.');
} finally {
  await prisma.$disconnect();
}
