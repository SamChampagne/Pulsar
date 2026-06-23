import { PartialType } from '@nestjs/swagger';
import { IsOptional, IsString, MinLength } from 'class-validator';
import { ListQueryDto } from '../../../common/dto/list-query.dto';

export class CreateListDto {
  @IsString() @MinLength(1) name!: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() ownerUserId?: string;
}

export class UpdateListDto extends PartialType(CreateListDto) {}

export class ListListQueryDto extends ListQueryDto {}

export class AddMemberDto {
  @IsString() @MinLength(1) contactId!: string;
}

export class AddCompanyContactsDto {
  @IsString() @MinLength(1) companyId!: string;
}
