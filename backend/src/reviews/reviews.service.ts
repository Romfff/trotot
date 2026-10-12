import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { PaginatedResult } from '../common/paginated-result.js';
import type { CreateReviewDto } from './reviews.dto.js';
import type { Prisma } from '../generated/prisma/client.js';

const reviewSelect = {id:true,cleanliness:true,location:true,value:true,comment:true,createdAt:true,
  guest:{select:{fullName:true}}} as const;
type SelectedReview = Prisma.ReviewGetPayload<{select:typeof reviewSelect}>;
const present = ({guest,createdAt,...review}:SelectedReview) => ({...review,authorName:guest.fullName,createdAt:createdAt.toISOString()});

@Injectable()
export class ReviewsService {
  constructor(private readonly prisma:PrismaService) {}

  async create(userId:string,bookingId:string,dto:CreateReviewDto) {
    return this.prisma.$transaction(async tx=>{
      // Serialize duplicate requests and status changes against the same booking.
      const [booking] = await tx.$queryRaw<{guest_id:string;booking_status:string}[]>`
        SELECT guest_id,booking_status FROM bookings WHERE id=${bookingId}::uuid FOR UPDATE`;
      if(!booking || booking.guest_id!==userId) throw new NotFoundException({errorCode:'BOOKING_NOT_FOUND',message:'Không tìm thấy đơn đặt phòng.'});
      if(booking.booking_status!=='COMPLETED') throw new ConflictException({errorCode:'REVIEW_NOT_ELIGIBLE',message:'Chỉ đánh giá sau khi chuyến đi hoàn tất.'});
      const [user] = await tx.$queryRaw<{status:string}[]>`SELECT status FROM users WHERE id=${userId}::uuid FOR SHARE`;
      if(user?.status!=='ACTIVE') throw new ForbiddenException({errorCode:'ACCOUNT_INACTIVE',message:'Tài khoản không được phép đánh giá.'});
      if(await tx.review.findUnique({where:{bookingId},select:{id:true}})) {
        throw new ConflictException({errorCode:'REVIEW_ALREADY_EXISTS',message:'Bạn đã đánh giá chuyến đi này.'});
      }
      const review = await tx.review.create({data:{bookingId,guestId:userId,cleanliness:dto.cleanliness,location:dto.location,value:dto.value,comment:dto.comment},select:reviewSelect});
      return present(review);
    });
  }

  async own(userId:string,bookingId:string) {
    const booking = await this.prisma.booking.findFirst({where:{id:bookingId,guestId:userId},select:{id:true}});
    if(!booking) throw new NotFoundException({errorCode:'BOOKING_NOT_FOUND',message:'Không tìm thấy đơn đặt phòng.'});
    const review = await this.prisma.review.findUnique({where:{bookingId},select:reviewSelect});
    return review?present(review):null;
  }

  async list(slug:string,page:number,limit:number) {
    return this.prisma.$transaction(async tx=>{
      // Hold visibility stable through count/read; no review of a private listing leaks publicly.
      const [property] = await tx.$queryRaw<{id:string}[]>`
        SELECT p.id FROM properties p JOIN users h ON h.id=p.host_id
        WHERE p.slug=${slug} AND p.status='PUBLISHED' AND p.deleted_at IS NULL AND h.status='ACTIVE'
        FOR SHARE OF p,h`;
      if(!property) throw new NotFoundException({errorCode:'PROPERTY_NOT_FOUND',message:'Không tìm thấy tin.'});
      // D-S5-04: banning a guest does not hide or change an already verified review.
      const where = {booking:{unit:{propertyId:property.id}}};
      const total = await tx.review.count({where});
      const rows = await tx.review.findMany({where,select:reviewSelect,orderBy:[{createdAt:'desc'},{id:'desc'}],skip:(page-1)*limit,take:limit});
      return new PaginatedResult(rows.map(present),{page,limit,total,totalPages:Math.ceil(total/limit)});
    },{isolationLevel:'RepeatableRead'});
  }
}
