import { Controller,Get,Header,NotFoundException,Query,ServiceUnavailableException,UseGuards } from '@nestjs/common';
import { ApiProperty,ApiTags } from '@nestjs/swagger';
import { Matches } from 'class-validator';
import { PrismaService } from '../database/prisma.service.js';
import { Sprint2IpRateLimitGuard } from '../common/sprint2-rate-limit.guard.js';
import type { Prisma } from '../generated/prisma/client.js';
class WardQuery { @ApiProperty() @Matches(/^\d{2}$/) provinceCode!:string; }
@ApiTags('address-catalog') @Controller('catalog') @UseGuards(Sprint2IpRateLimitGuard)
export class AddressCatalogController {
  constructor(private readonly prisma:PrismaService) {}
  private async metadata(tx:Prisma.TransactionClient) {
    const [row]=await tx.$queryRaw<{version:string;asOf:string;sourceUrl:string}[]>`SELECT version,to_char(as_of,'YYYY-MM-DD') AS "asOf",source_url AS "sourceUrl" FROM address_catalog_metadata WHERE id=true`;
    if(!row||!await tx.addressWard.count()) throw new ServiceUnavailableException({errorCode:'ADDRESS_CATALOG_NOT_READY',message:'Danh mục địa chỉ chưa có dữ liệu và nguồn đã kiểm chứng.'});
    return row;
  }
  @Get('provinces') @Header('Cache-Control','no-store')
  provinces() {return this.prisma.$transaction(async tx=>({...(await this.metadata(tx)),items:await tx.addressProvince.findMany({orderBy:{code:'asc'},select:{code:true,name:true}})}),{isolationLevel:'RepeatableRead'});}
  @Get('wards') @Header('Cache-Control','no-store')
  async wards(@Query() query:WardQuery) {
    return this.prisma.$transaction(async tx=>{
      const meta=await this.metadata(tx);
      if(!await tx.addressProvince.findUnique({where:{code:query.provinceCode}})) throw new NotFoundException({errorCode:'PROVINCE_NOT_FOUND',message:'Không tìm thấy tỉnh/thành phố.'});
      return {...meta,provinceCode:query.provinceCode,items:await tx.addressWard.findMany({where:{provinceCode:query.provinceCode},orderBy:{code:'asc'},select:{code:true,name:true,provinceCode:true}})};
    },{isolationLevel:'RepeatableRead'});
  }
}
