import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { ListQueryDto } from '../../../common/dto/list-query.dto';

const EMAIL_STATUSES = ['QUEUED', 'SENDING', 'SENT', 'FAILED'] as const;

export class ListEmailsQueryDto extends ListQueryDto {
  @IsOptional()
  @IsIn(EMAIL_STATUSES)
  status?: (typeof EMAIL_STATUSES)[number];

  @IsOptional()
  @IsString()
  @MaxLength(100)
  relatedType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  relatedId?: string;
}
