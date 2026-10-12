import { Transform } from 'class-transformer';
import { IsInt, IsString, Length, Max, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateReviewDto {
  @ApiProperty({minimum:1,maximum:5,type:'integer'}) @IsInt() @Min(1) @Max(5) cleanliness!:number;
  @ApiProperty({minimum:1,maximum:5,type:'integer'}) @IsInt() @Min(1) @Max(5) location!:number;
  @ApiProperty({minimum:1,maximum:5,type:'integer'}) @IsInt() @Min(1) @Max(5) value!:number;
  @ApiProperty({minLength:1,maxLength:2000})
  @Transform(({value})=>typeof value==='string'?value.trim():value) @IsString() @Length(1,2000) comment!:string;
}
export class ReviewResponseDto {
  @ApiProperty({format:'uuid'}) id!:string;
  @ApiProperty({minimum:1,maximum:5}) cleanliness!:number;
  @ApiProperty({minimum:1,maximum:5}) location!:number;
  @ApiProperty({minimum:1,maximum:5}) value!:number;
  @ApiProperty() comment!:string;
  @ApiProperty() authorName!:string;
  @ApiProperty({format:'date-time'}) createdAt!:string;
}
