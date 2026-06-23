import { PartialType } from '@nestjs/swagger';
import { IsOptional, IsString, MinLength } from 'class-validator';
import { ListQueryDto } from '../../../common/dto/list-query.dto';

export class CreateCampaignDto {
  @IsString() @MinLength(1) name!: string;
  @IsString() @MinLength(1) listId!: string;
  @IsString() @MinLength(1) subject!: string;
  @IsString() @MinLength(1) html!: string;
  @IsOptional() @IsString() templateKey?: string;
  @IsOptional() @IsString() ownerUserId?: string;
}

export class UpdateCampaignDto extends PartialType(CreateCampaignDto) {}

export class CampaignListQueryDto extends ListQueryDto {}
