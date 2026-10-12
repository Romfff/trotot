import {Transform} from 'class-transformer';
import {IsBoolean,IsIn,IsInt,IsOptional,IsString,IsUUID,Length,Matches,Max,MaxLength,Min} from 'class-validator';
import {ApiProperty,ApiPropertyOptional,type SchemaObject} from '@nestjs/swagger';
import {nearbyGroups,type NearbyGroup} from './nearby-policy.js';
const number=({value}:{value:unknown})=>typeof value==='string'&&/^\d+$/u.test(value)?Number(value):value;
export class NearbyQueryDto {
 @ApiPropertyOptional({enum:Object.keys(nearbyGroups)}) @IsOptional() @IsIn(Object.keys(nearbyGroups)) group?:NearbyGroup;
 @ApiPropertyOptional({default:1,maximum:20}) @Transform(number) @IsInt() @Min(1) @Max(20) page=1;
 @ApiPropertyOptional({default:5}) @Transform(number) @IsInt() @Min(1) @Max(5) limit=5;
 @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) @Matches(/^[a-f0-9-]{36}\.\d+$/u) snapshotVersion?:string;
}
export class NearbyVisibilityParams {
 @IsUUID() propertyId!:string;
 @IsUUID() placeId!:string;
}
export class NearbyVisibilityDto {
 @ApiProperty() @IsBoolean() hidden!:boolean;
 @ApiProperty({maxLength:500}) @Transform(({value}:{value:unknown})=>typeof value==='string'?value.trim():value) @IsString() @Length(1,500) reason!:string;
 @ApiProperty({minimum:0}) @IsInt() @Min(0) @Max(1000000000) expectedVersion!:number;
}
const point:SchemaObject={type:'object',required:['latitude','longitude'],properties:{latitude:{type:'number'},longitude:{type:'number'}}};
export const nearbyItemSchema:SchemaObject={type:'object',required:['id','name','category','source','point','distanceMeters','representativeMethod'],properties:{
 id:{type:'string',format:'uuid'},name:{type:'string'},category:{type:'string',enum:Object.keys(nearbyGroups)},source:{type:'string',enum:['OSM']},
 point,distanceMeters:{type:'number',minimum:0},representativeMethod:{type:'string',enum:['OSM_POINT','POINT_ON_SURFACE']},
}};
export const nearbyResponseSchema:SchemaObject={type:'object',required:['propertyId','rentalMode','status','center','distanceMethod','stale','updatedAt','datasetVersion','snapshotVersion','attribution','groups'],properties:{
 propertyId:{type:'string',format:'uuid'},rentalMode:{type:'string',enum:['LONG_TERM','SHORT_TERM','HYBRID']},
 status:{type:'string',enum:['READY','EMPTY','PENDING','UNAVAILABLE']},center:point,distanceMethod:{type:'string',enum:['GEODESIC']},stale:{type:'boolean'},
 updatedAt:{type:'string',format:'date-time',nullable:true},datasetVersion:{type:'string',nullable:true},snapshotVersion:{type:'string',nullable:true},
 attribution:{type:'object',required:['label','url'],properties:{label:{type:'string'},url:{type:'string',format:'uri'}}},
 groups:{type:'array',items:{type:'object',required:['code','label','radiusMeters','items','total','hasMore','truncated'],properties:{
  code:{type:'string',enum:Object.keys(nearbyGroups)},label:{type:'string'},radiusMeters:{type:'integer',minimum:1},items:{type:'array',items:nearbyItemSchema},
  total:{type:'integer',minimum:0,maximum:20},hasMore:{type:'boolean'},truncated:{type:'boolean'},
 }}},
}};
export const nearbyMetaSchema:SchemaObject={type:'object',description:'Present when group is requested; outside data.',required:['page','limit','total','totalPages'],properties:{
 page:{type:'integer',minimum:1,maximum:20},limit:{type:'integer',minimum:1,maximum:5},total:{type:'integer',minimum:0,maximum:20},totalPages:{type:'integer',minimum:0},
}};
export const nearbyAdminSchema:SchemaObject={type:'array',items:{type:'object',required:['item','groupCode','hidden','version','reason'],properties:{
 item:nearbyItemSchema,groupCode:{type:'string',enum:Object.keys(nearbyGroups)},hidden:{type:'boolean'},version:{type:'integer',minimum:0},reason:{type:'string',nullable:true},
}}};
