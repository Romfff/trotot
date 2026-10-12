import { BadRequestException, ConflictException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { randomUUID } from 'node:crypto';
import { Prisma, type Property } from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';
import { CreateListingDto, ListingsPageDto, UpdateListingDto } from './listings.dto.js';
import { PaginatedResult } from '../common/paginated-result.js';

type Tx = Prisma.TransactionClient;
const countedStates = ['PENDING_REVIEW','PUBLISHED','HIDDEN'];
const privateInclude = { longTermDetail: true, images: { orderBy: { position: 'asc' as const } }, amenities: true, revision: true } as const;
function presentPrivate(record: Prisma.PropertyGetPayload<{ include: typeof privateInclude }>) {
  return { ...record, images: record.images.map(image => ({ ...image, sortOrder: image.position })) };
}

function conflict(errorCode: string, message: string): never { throw new ConflictException({ errorCode, message }); }
function notFound(): never { throw new NotFoundException({ errorCode: 'PROPERTY_NOT_FOUND', message: 'Không tìm thấy tin.' }); }

function fields(dto: CreateListingDto) {
  return {
    title: dto.title, propertyType: dto.propertyType, description: dto.description, videoUrl: dto.videoUrl ?? null, addressDetail: dto.addressDetail,
    provinceCode: dto.provinceCode, wardCode: dto.wardCode, districtCode: null,
    latitude: dto.latitude, longitude: dto.longitude,
  };
}
function details(dto: CreateListingDto) {
  return {
    monthlyPrice: dto.monthlyPrice, depositAmount: dto.depositAmount, areaSqm: dto.areaSqm,
    electricityCost: dto.electricityCost, waterCost: dto.waterCost, waterUnit: dto.waterUnit,
    internetCost: dto.internetCost, garbageCost: dto.garbageCost, parkingFee: dto.parkingFee, contactPhone: dto.contactPhone,
    contactZalo: dto.contactZalo ?? null, allowPets: dto.allowPets,
  };
}

@Injectable()
export class ListingsManagementService {
  constructor(private readonly prisma: PrismaService) {}

  private async validateCatalog(tx: Tx, dto: CreateListingDto) {
    if (dto.districtCode != null) throw new BadRequestException({ errorCode: 'LEGACY_ADDRESS_UNSUPPORTED', message: 'Địa chỉ hiện hành dùng tỉnh/thành và phường/xã, không nhập huyện.' });
    const ward = await tx.addressWard.findFirst({ where: { code: dto.wardCode, provinceCode: dto.provinceCode } });
    if (!ward) {
      if (await tx.addressWard.count() === 0) throw new ServiceUnavailableException({ errorCode: 'ADDRESS_CATALOG_NOT_READY', message: 'Danh mục địa chỉ chính thức chưa được nhập.' });
      throw new BadRequestException({ errorCode: 'INVALID_ADDRESS', message: 'Phường/xã không thuộc tỉnh/thành đã chọn.' });
    }
    if (await tx.amenity.count({ where: { id: { in: dto.amenityIds } } }) !== dto.amenityIds.length) {
      throw new BadRequestException({ errorCode: 'INVALID_AMENITY', message: 'Tiện ích không tồn tại trong danh mục.' });
    }
    // Media integration is explicitly deferred. Never accept arbitrary external URLs as uploaded media.
    if (dto.imageUrls.length) throw new ServiceUnavailableException({ errorCode: 'MEDIA_SERVER_NOT_CONFIGURED', message: 'Server ảnh riêng chưa được kết nối; chưa hỗ trợ thêm ảnh thật.' });
  }

  private async hostLock(tx: Tx, hostId: string) {
    // All quota-changing operations use this same DB row lock, including Admin review/delete.
    await tx.$queryRaw`SELECT id FROM users WHERE id=${hostId}::uuid FOR UPDATE`;
  }
  private async propertyLock(tx: Tx, id: string, hostId?: string) {
    const row = await tx.property.findFirst({ where: { id, deletedAt: null, rentalMode: 'LONG_TERM', ...(hostId ? { hostId } : {}) }, select: { hostId: true } });
    if (!row) notFound();
    await this.hostLock(tx, row.hostId);
    await tx.$queryRaw`SELECT id FROM properties WHERE id=${id}::uuid FOR UPDATE`;
    const property = await tx.property.findFirst({ where: { id, hostId: row.hostId, deletedAt: null, rentalMode: 'LONG_TERM' } });
    if (!property) notFound();
    return property;
  }
  private version(property: Property, expectedVersion: number) {
    if (property.version !== expectedVersion) conflict('STALE_LISTING_VERSION', 'Tin đã thay đổi. Hãy tải lại trước khi thao tác.');
  }
  private async quota(tx: Tx, hostId: string, excludeId?: string) {
    const count = await tx.property.count({ where: {
      hostId, rentalMode: 'LONG_TERM', listingPlan: 'FREE', deletedAt: null, status: { in: countedStates },
      ...(excludeId ? { id: { not: excludeId } } : {}),
    } });
    // Only free long-term endpoints exist in Sprint 2; no paid entitlement is inferred from isVip.
    if (count >= 2) conflict('FREE_LISTING_LIMIT', 'Gói miễn phí chỉ cho tối đa 2 tin trọ dài hạn đang chờ duyệt, hiển thị hoặc tạm ẩn.');
  }
  private async replaceContent(tx: Tx, id: string, dto: CreateListingDto) {
    await tx.property.update({ where: { id }, data: fields(dto) });
    await tx.longTermDetail.upsert({ where: { propertyId: id }, create: { propertyId: id, ...details(dto) }, update: details(dto) });
    await tx.propertyAmenityMapping.deleteMany({ where: { propertyId: id } });
    if (dto.amenityIds.length) await tx.propertyAmenityMapping.createMany({ data: dto.amenityIds.map(amenityId => ({ propertyId: id, amenityId })) });
    await tx.propertyImage.deleteMany({ where: { propertyId: id } });
    if (dto.imageUrls.length) await tx.propertyImage.createMany({ data: dto.imageUrls.map((url,position) => ({ propertyId: id, url, position })) });
  }

  async create(hostId: string, dto: CreateListingDto) {
    return this.prisma.$transaction(async tx => {
      await this.hostLock(tx, hostId);
      await this.validateCatalog(tx, dto);
      await this.quota(tx, hostId);
      const id = randomUUID();
      const slug = dto.title.normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/đ/gi, 'd').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,200) || 'phong-tro';
      await tx.property.create({ data: { id, hostId, slug: `${slug}-${id}`, rentalMode: 'LONG_TERM', listingPlan: 'FREE', status: 'PENDING_REVIEW', ...fields(dto) } });
      await this.replaceContent(tx, id, dto);
      return presentPrivate(await tx.property.findUniqueOrThrow({ where: { id }, include: privateInclude }));
    });
  }

  async own(hostId: string, id: string) {
    const property = await this.prisma.property.findFirst({ where: { id, hostId, rentalMode: 'LONG_TERM', deletedAt: null }, include: privateInclude });
    if (!property) notFound();
    return presentPrivate(property);
  }

  async reviewDetail(id: string) {
    const property = await this.prisma.property.findFirst({ where: { id, rentalMode: 'LONG_TERM', deletedAt: null }, include: privateInclude });
    if (!property) notFound();
    return presentPrivate(property);
  }

  async list(query: ListingsPageDto, hostId?: string) {
    const where: Prisma.PropertyWhereInput = {
      rentalMode: 'LONG_TERM', deletedAt: null,
      ...(hostId ? { hostId } : { OR: [{ status: 'PENDING_REVIEW' }, { revision: { is: { status: 'PENDING_REVIEW' } } }] }),
    };
    return this.prisma.$transaction(async tx => {
      const total = await tx.property.count({ where });
      const data = await tx.property.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.limit, take: query.limit, include: privateInclude });
      return new PaginatedResult(data.map(presentPrivate), { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }

  async update(hostId: string, id: string, dto: UpdateListingDto) {
    return this.prisma.$transaction(async tx => {
      const property = await this.propertyLock(tx, id, hostId);
      this.version(property, dto.expectedVersion);
      await this.validateCatalog(tx, dto);
      if (property.status === 'PUBLISHED' || property.status === 'HIDDEN') {
        // Store only content, not expectedVersion or client-owned status/identity fields.
        const { expectedVersion: _expectedVersion, ...snapshot } = dto;
        await tx.propertyRevision.upsert({
          where: { propertyId: id },
          create: { propertyId: id, content: snapshot as unknown as Prisma.InputJsonObject },
          update: { content: snapshot as unknown as Prisma.InputJsonObject, status: 'PENDING_REVIEW' },
        });
      } else if (['PENDING_REVIEW','REJECTED'].includes(property.status)) {
        if (property.listingPlan === 'FREE') await this.quota(tx, hostId, id);
        await this.replaceContent(tx, id, dto);
        await tx.property.update({ where: { id }, data: { status: 'PENDING_REVIEW' } });
      } else conflict('INVALID_EDIT_STATE', 'Chưa hỗ trợ sửa trạng thái tin này.');
      await tx.property.update({ where: { id }, data: { version: { increment: 1 } } });
      return presentPrivate(await tx.property.findUniqueOrThrow({ where: { id }, include: privateInclude }));
    });
  }

  async review(actorId: string, id: string, expectedVersion: number, status: 'PUBLISHED' | 'REJECTED') {
    return this.prisma.$transaction(async tx => {
      const property = await this.propertyLock(tx, id);
      this.version(property, expectedVersion);
      const revision = await tx.propertyRevision.findUnique({ where: { propertyId: id } });
      const reviewingRevision = revision?.status === 'PENDING_REVIEW' && ['PUBLISHED','HIDDEN'].includes(property.status);
      if (reviewingRevision) {
        if (status === 'PUBLISHED') {
          const dto = plainToInstance(CreateListingDto, revision.content);
          if ((await validate(dto, { whitelist: true, forbidNonWhitelisted: true })).length) conflict('INVALID_REVISION', 'Bản sửa không hợp lệ.');
          await this.validateCatalog(tx, dto);
          await this.replaceContent(tx, id, dto);
          await tx.propertyRevision.delete({ where: { propertyId: id } });
        } else await tx.propertyRevision.update({ where: { propertyId: id }, data: { status: 'REJECTED' } });
        // Keep visibility chosen by the Host. Approving content cannot unhide their listing.
      } else if (property.status === 'PENDING_REVIEW' && await tx.longTermDetail.findUnique({ where: { propertyId: id } })) {
        await tx.property.update({ where: { id }, data: { status } });
      } else conflict('INVALID_REVIEW_STATE', 'Không có tin hoặc bản sửa đang chờ duyệt.');
      const reviewed = await tx.property.update({ where: { id }, data: { version: { increment: 1 } }, select: { id: true, version: true, status: true } });
      // Audit is part of the same commit: failure must roll back content/status/version.
      await tx.listingModerationEvent.create({ data: {
        actorId, propertyId: id, action: status === 'PUBLISHED' ? 'APPROVE' : 'REJECT',
        target: reviewingRevision ? 'REVISION' : 'LISTING', reviewedVersion: property.version,
        resultVersion: reviewed.version, statusBefore: property.status, statusAfter: reviewed.status,
      } });
      return reviewed;
    });
  }

  async visibility(hostId: string, id: string, expectedVersion: number, status: 'PUBLISHED' | 'HIDDEN') {
    return this.prisma.$transaction(async tx => {
      const property = await this.propertyLock(tx, id, hostId);
      this.version(property, expectedVersion);
      if (!['PUBLISHED','HIDDEN'].includes(property.status)) conflict('INVALID_VISIBILITY_STATE', 'Chỉ ẩn/hiện tin đã được duyệt.');
      return tx.property.update({ where: { id }, data: { status, version: { increment: 1 } }, select: { id: true, status: true, version: true } });
    });
  }

  async availability(hostId: string, id: string, expectedVersion: number, isAvailable: boolean) {
    return this.prisma.$transaction(async tx => {
      const property = await this.propertyLock(tx, id, hostId);
      this.version(property, expectedVersion);
      if (!['PUBLISHED','HIDDEN'].includes(property.status)) conflict('INVALID_AVAILABILITY_STATE', 'Chỉ báo trạng thái phòng cho tin đã duyệt.');
      return tx.property.update({ where: { id }, data: { isAvailable, version: { increment: 1 } }, select: { id: true, isAvailable: true, version: true } });
    });
  }

  async remove(hostId: string, id: string, expectedVersion: number) {
    return this.prisma.$transaction(async tx => {
      const property = await this.propertyLock(tx, id, hostId);
      this.version(property, expectedVersion);
      const [{ total }] = await tx.$queryRaw<{ total: number }[]>`SELECT COUNT(*)::integer AS total FROM viewing_appointments
        WHERE property_id=${id}::uuid AND status IN ('PENDING','ACCEPTED')
        AND scheduled_date + scheduled_time > CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Ho_Chi_Minh'`;
      if (total) conflict('UPCOMING_APPOINTMENTS', 'Tin còn lịch hẹn sắp tới; chỉ được ẩn, không được xóa.');
      return tx.property.update({ where: { id }, data: { deletedAt: new Date(), version: { increment: 1 } }, select: { id: true, deletedAt: true, version: true } });
    });
  }
}
