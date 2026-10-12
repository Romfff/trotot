import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, IsUUID, Length, Matches, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ListingsPageDto } from '../listings/listings.dto.js';
import { normalizePhone } from '../auth/phone.js';
import { appointmentStatuses } from './appointment-policy.js';
const trim = ({value}:{value:unknown}) => typeof value==='string'?value.trim():value;

export class CreateAppointmentDto {
  @ApiProperty({format:'uuid'}) @IsUUID() propertyId!:string;
  @ApiProperty({maxLength:150}) @Transform(trim) @IsString() @Length(1,150) tenantName!:string;
  @ApiProperty() @Transform(({value})=>typeof value==='string'?normalizePhone(value):value) @IsString() @Matches(/^\+?[0-9]{9,15}$/) tenantPhone!:string;
  @ApiProperty({format:'date',description:'Asia/Ho_Chi_Minh'}) @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) scheduledDate!:string;
  @ApiProperty({example:'15:30:00',description:'HH:mm:ss, Asia/Ho_Chi_Minh'}) @IsString() @Matches(/^\d{2}:\d{2}:\d{2}$/) scheduledTime!:string;
  @ApiPropertyOptional({maxLength:500}) @IsOptional() @Transform(trim) @IsString() @MaxLength(500) notes?:string;
}
export class AppointmentActionDto {
  @ApiProperty({enum:appointmentStatuses}) @IsIn(appointmentStatuses) expectedStatus!:string;
  @ApiPropertyOptional({maxLength:500,description:'Required for Host cancellation'}) @IsOptional() @Transform(trim) @IsString() @MaxLength(500) reason?:string;
}
export class AppointmentPageDto extends ListingsPageDto {
  @ApiPropertyOptional({enum:appointmentStatuses}) @IsOptional() @IsIn(appointmentStatuses) status?:string;
}
export class AppointmentResponseDto {
  @ApiProperty({format:'uuid'}) id!:string;
  @ApiProperty({format:'uuid'}) propertyId!:string;
  @ApiProperty() title!:string;
  @ApiProperty({format:'date'}) scheduledDate!:string;
  @ApiProperty({example:'15:30:00'}) scheduledTime!:string;
  @ApiProperty({enum:appointmentStatuses}) status!:string;
  @ApiProperty({type:String,nullable:true}) reason!:string|null;
  @ApiProperty({type:String,nullable:true}) notes!:string|null;
  @ApiProperty({type:String,enum:['TENANT','HOST','SYSTEM'],nullable:true}) cancelledBy!:string|null;
  @ApiProperty({format:'date-time'}) createdAt!:string;
  @ApiProperty({format:'date-time'}) updatedAt!:string;
}
export class HostAppointmentResponseDto extends AppointmentResponseDto {
  @ApiProperty() tenantName!:string;
  @ApiProperty() tenantPhone!:string;
  @ApiProperty({description:'Other active appointments for the same property/date/time'}) simultaneousAppointments!:number;
}
export class NotificationResponseDto {
  @ApiProperty({format:'uuid'}) id!:string;
  @ApiProperty({format:'uuid'}) appointmentId!:string;
  @ApiProperty() type!:string;
  @ApiProperty() message!:string;
  @ApiProperty({type:String,format:'date-time',nullable:true}) readAt!:string|null;
  @ApiProperty({format:'date-time'}) createdAt!:string;
}
