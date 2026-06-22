import { Type } from 'class-transformer';
import { IsDate, IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
import { CrmActivityType } from '@pulsar/shared';
import { ListQueryDto } from '../../../common/dto/list-query.dto';

export class CreateActivityDto {
  @IsEnum(CrmActivityType) type!: CrmActivityType;
  @IsString() @MinLength(1) body!: string;
  @IsOptional() @IsString() companyId?: string;
  @IsOptional() @IsString() contactId?: string;
  @IsOptional() @IsString() dealId?: string;
  @IsOptional() @IsDate() @Type(() => Date) dueAt?: Date;
}

export class ActivityListQueryDto extends ListQueryDto {
  @IsOptional() @IsString() companyId?: string;
  @IsOptional() @IsString() contactId?: string;
  @IsOptional() @IsString() dealId?: string;
  @IsOptional() @IsEnum(CrmActivityType) type?: CrmActivityType;
  /** 'true' → only activities where doneAt is null */
  @IsOptional() @IsString() pending?: string;
  /** 'true' → only TASK activities where dueAt <= now and doneAt is null */
  @IsOptional() @IsString() overdue?: string;
}
