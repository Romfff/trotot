import bcrypt from 'bcrypt';
import type { PrismaClient } from '../src/generated/prisma/client.js';

const marker='LOCAL_DEMO_LISTINGS_V1';
const prefix='demo-local-trotot-';
const phones=['0999999811','0999999822'];
const photos=[
  'https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?w=800&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?w=800&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=800&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1493809842364-78817add7ffb?w=800&auto=format&fit=crop&q=80',
];

export function assertLocalDemoTarget(env:NodeJS.ProcessEnv) {
  const target=new URL(env.DATABASE_URL || '');
  if(!['development','test'].includes(env.NODE_ENV||'')||env.ALLOW_DEV_SEED!=='true'||!['localhost','127.0.0.1','[::1]'].includes(target.hostname)||target.pathname==='/postgres') {
    throw new Error('Demo listings require explicit ALLOW_DEV_SEED=true, a non-production loopback application database.');
  }
}

// Opt-in local fixtures, never a startup seed or bypass in any listing API.
// Reruns add missing fixtures only: never republish/edit/delete a room or its bookings.
export async function seedLocalListings(prisma:PrismaClient) {
  const hash=await bcrypt.hash('LocalOnly-Trotot-2026!',12);
  return prisma.$transaction(async tx=>{
    await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(584732019)`;
    const ward=await tx.addressWard.findFirst({where:{provinceCode:'79',name:'Phường Diên Hồng'}});
    if(!ward) throw new Error('Load the current official address catalog first; no synthetic ward or district code will be inserted.');
    const hostIds:string[]=[];
    for(const [index,phone] of phones.entries()) {
      const fullName=`[DEMO] Chủ nhà local ${index+1}`;
      let host=await tx.user.findUnique({where:{phone}});
      if(host && (host.fullName!==fullName||host.role!=='HOST'||host.status!=='ACTIVE')) throw new Error('Demo account identifier collision; existing account is untouched.');
      if(!host) host=await tx.user.create({data:{phone,fullName,role:'HOST',status:'ACTIVE',passwordHash:hash,isPhoneVerified:true}});
      // Same quota lock as the listing API, so an API create cannot race the seed.
      await tx.$queryRaw`SELECT id FROM users WHERE id=${host.id}::uuid FOR UPDATE`;
      await tx.hostProfile.upsert({where:{userId:host.id},create:{userId:host.id},update:{}});
      hostIds.push(host.id);
    }
    let created=0;
    for(let index=0;index<8;index++) {
      const longTerm=index<4,slot=index%4,slug=`${prefix}${longTerm?'tro':'homestay'}-${slot+1}`,hostId=hostIds[longTerm?Math.floor(slot/2):slot%2];
      const existing=await tx.property.findUnique({where:{slug}});
      if(existing) {
        if(existing.hostId!==hostId||!existing.description.startsWith(marker)) throw new Error('Demo slug collision; no existing listing overwritten.');
        continue;
      }
      if(longTerm && await tx.property.count({where:{hostId,rentalMode:'LONG_TERM',listingPlan:'FREE',deletedAt:null,status:{in:['PENDING_REVIEW','PUBLISHED','HIDDEN']}}})>=2) throw new Error('Demo host already has two active free long-term listings; nothing overwritten.');
      const names=longTerm?['Gác lửng gần ĐH Bách Khoa','Studio ban công, giờ giấc tự do','Phòng sinh viên có kệ bếp','Căn hộ mini đầy đủ nội thất']:['Studio xanh trong thành phố','Căn hộ ban công yên tĩnh','Homestay gia đình rộng rãi','Phòng nghỉ cuối tuần'];
      await tx.property.create({data:{hostId,slug,title:`[DEMO] ${names[slot]}`,description:`${marker}\nDữ liệu mẫu chỉ để kiểm thử local. Địa chỉ, giá và ảnh minh họa không phải tin cho thuê thật. Không thanh toán hay gọi số liên hệ mẫu.`,
        rentalMode:longTerm?'LONG_TERM':'SHORT_TERM',propertyType:longTerm?'PHONG_TRO':'HOMESTAY',status:'PUBLISHED',
        provinceCode:ward.provinceCode,wardCode:ward.code,districtCode:null,addressDetail:`Địa chỉ mẫu ${slot+1}, ${ward.name}, Thành phố Hồ Chí Minh`,
        latitude:10.7725+slot*0.0003,longitude:106.6578+slot*0.0003,isVerified:false,
        images:{create:[0,1,2].map((position)=>({position,url:photos[(slot+position)%photos.length]}))},
        amenities:{create:[{amenityId:'wifi'},{amenityId:slot===2?'kitchen':'air_cond'}]},
        ...(longTerm?{longTermDetail:{create:{monthlyPrice:[3500000,4000000,2200000,5800000][slot],depositAmount:3500000,areaSqm:[28,28,18,32][slot],electricityCost:3500,waterCost:20000,waterUnit:slot%2?'PERSON':'M3',internetCost:slot===2?0:100000,garbageCost:30000,parkingFee:120000,contactPhone:phones[longTerm?Math.floor(slot/2):0]}}}
          :{homestayUnits:{create:{unitName:`Phòng mẫu ${slot+1}`,maxAdults:slot===2?4:2,maxChildren:2,maxGuests:slot===2?6:4,bedrooms:slot===2?2:1,bathrooms:1,basePricePerNight:[550000,650000,850000,450000][slot],weekendPricePerNight:[650000,750000,950000,550000][slot],cleaningFee:100000,checkInTime:new Date('1970-01-01T14:00:00Z'),checkOutTime:new Date('1970-01-01T12:00:00Z'),cancellationPolicy:'FLEXIBLE',instantBook:slot%2===0,status:'PUBLISHED'}}}),
      }});
      created++;
    }
    return {created,total:await tx.property.count({where:{slug:{startsWith:prefix}}})};
  },{timeout:30_000});
}
