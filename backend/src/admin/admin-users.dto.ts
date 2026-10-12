import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, Length } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ListingsPageDto } from '../listings/listings.dto.js';

export class AdminUsersQueryDto extends ListingsPageDto {
  @ApiPropertyOptional({enum:['TENANT','HOST','ADMIN']}) @IsOptional() @IsIn(['TENANT','HOST','ADMIN']) role?:string;
  @ApiPropertyOptional({enum:['ACTIVE','BANNED']}) @IsOptional() @IsIn(['ACTIVE','BANNED']) status?:string;
}
export class ModerateUserDto {
  @ApiProperty({enum:['ACTIVE','BANNED']}) @IsIn(['ACTIVE','BANNED']) expectedStatus!:'ACTIVE'|'BANNED';
  @ApiProperty({minLength:1,maxLength:500}) @Transform(({value})=>typeof value==='string'?value.trim():value)
  @IsString() @Length(1,500) reason!:string;
}
export class AdminUserResponseDto {
  @ApiProperty({format:'uuid'}) id!:string;
  @ApiProperty() fullName!:string;
  @ApiProperty() role!:string;
  @ApiProperty({nullable:true,type:String}) status!:string|null;
  @ApiProperty({nullable:true,type:String,format:'date-time'}) createdAt!:string|null;
  @ApiProperty({nullable:true,type:String,format:'date-time'}) updatedAt!:string|null;
}
