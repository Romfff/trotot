import { Transform } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUUID, Length, Max, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateConversationDto {
  @ApiProperty({format:'uuid'}) @IsUUID() propertyId!:string;
}
export class SendChatMessageDto {
  @ApiProperty({format:'uuid'}) @IsUUID() clientMessageId!:string;
  @ApiProperty({minLength:1,maxLength:3000})
  @Transform(({value})=>typeof value==='string'?value.trim():value) @IsString() @Length(1,3000) text!:string;
}
export class SocketChatMessageDto extends SendChatMessageDto {
  @ApiProperty({format:'uuid'}) @IsUUID() conversationId!:string;
}
export class ReadChatDto {
  @ApiProperty({format:'uuid'}) @IsUUID() messageId!:string;
}
export class ChatMessagesQueryDto {
  @ApiPropertyOptional({format:'uuid'}) @IsOptional() @IsUUID() before?:string;
  @ApiPropertyOptional({default:20,maximum:50})
  @Transform(({value})=>typeof value==='string'&&/^\d+$/.test(value)?Number(value):value)
  @IsInt() @Min(1) @Max(50) limit=20;
}
export class ChatMessageResponseDto {
  @ApiProperty({format:'uuid'}) id!:string;
  @ApiProperty({format:'uuid'}) conversationId!:string;
  @ApiProperty({format:'uuid'}) senderId!:string;
  @ApiProperty({format:'uuid'}) clientMessageId!:string;
  @ApiProperty() text!:string;
  @ApiProperty({format:'date-time'}) createdAt!:string;
}
export class ConversationResponseDto {
  @ApiProperty({format:'uuid'}) id!:string;
  @ApiProperty({format:'uuid'}) propertyId!:string;
  @ApiProperty() title!:string;
  @ApiProperty() canSend!:boolean;
  @ApiProperty({nullable:true,type:String}) readOnlyReason!:string|null;
  @ApiProperty({type:'object',properties:{id:{type:'string',format:'uuid'},fullName:{type:'string'}}}) guest!:{id:string;fullName:string};
  @ApiProperty({type:'object',properties:{id:{type:'string',format:'uuid'},fullName:{type:'string'}}}) host!:{id:string;fullName:string};
  @ApiProperty({format:'date-time'}) createdAt!:string;
}
