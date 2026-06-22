import { PartialType } from '@nestjs/swagger';
import { IsOptional, IsString, MinLength } from 'class-validator';
import { ListQueryDto } from '../../../common/dto/list-query.dto';

export class CreateContactDto {
  @IsString() @MinLength(1) name!: string;
  @IsOptional() @IsString() companyId?: string;
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() email?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() ownerUserId?: string;
}

export class UpdateContactDto extends PartialType(CreateContactDto) {}

export class ContactListQueryDto extends ListQueryDto {
  @IsOptional() @IsString() companyId?: string;
}
