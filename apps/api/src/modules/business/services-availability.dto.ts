import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsString,
  Length,
  Matches,
  ValidateNested,
} from 'class-validator';

class AvailabilityItemDto {
  @IsString() @Length(1, 100) userId!: string;
  @IsDateString({ strict: true })
  @Length(20, 40)
  @Matches(/T.*(?:Z|[+-]\d{2}:\d{2})$/)
  scheduledAt!: string;
}
export class ServicesAvailabilityDto {
  @IsString() @Length(1, 100) timeZone!: string;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => AvailabilityItemDto)
  items!: AvailabilityItemDto[];
}
