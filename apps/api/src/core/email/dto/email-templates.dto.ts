import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateEmailTemplateDto {
  @IsString()
  @MaxLength(100)
  key!: string;

  @IsString()
  @MaxLength(255)
  name!: string;

  @IsString()
  @MaxLength(1000)
  subject!: string;

  @IsString()
  html!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  category?: string;
}

export class UpdateEmailTemplateDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  subject?: string;

  @IsOptional()
  @IsString()
  html?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  category?: string;
}
