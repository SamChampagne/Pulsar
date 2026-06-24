import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsIn, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ListQueryDto } from '../../../common/dto/list-query.dto';

export class ThreadListQueryDto extends ListQueryDto {
  @ApiPropertyOptional({ enum: ['UNLINKED', 'LINKED', 'ARCHIVED'] })
  @IsOptional()
  @IsIn(['UNLINKED', 'LINKED', 'ARCHIVED'])
  status?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  contactId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  dealId?: string;

  @ApiPropertyOptional()
  declare search?: string;
}

export class ReplyThreadDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  subject?: string;

  @ApiProperty()
  @IsString()
  html!: string;
}

class CreateContactInline {
  @ApiProperty()
  @IsString()
  name!: string;

  @ApiProperty()
  @IsEmail()
  email!: string;
}

export class LinkThreadDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  contactId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  companyId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  dealId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @ValidateNested()
  @Type(() => CreateContactInline)
  createContact?: CreateContactInline;
}
