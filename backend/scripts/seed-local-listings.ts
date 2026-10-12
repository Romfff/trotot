import '../src/config/load-env.js';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { assertLocalDemoTarget,seedLocalListings } from '../prisma/local-listings-seed.js';

assertLocalDemoTarget(process.env);
const prisma=new PrismaClient({adapter:new PrismaPg({connectionString:process.env.DATABASE_URL!})});
try {console.info('Local demo listings:',await seedLocalListings(prisma));}
finally {await prisma.$disconnect();}
