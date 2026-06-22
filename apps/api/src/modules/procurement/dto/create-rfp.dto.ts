import { IsDateString, IsNotEmpty, IsObject, IsOptional, IsString } from 'class-validator';

export class CreateRfpDto {
  @IsString()
  @IsNotEmpty()
  title!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsDateString()
  deadline?: string;

  @IsOptional()
  @IsObject()
  customData?: Record<string, unknown>;
}
