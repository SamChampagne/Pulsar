import { IsDateString, IsNotEmpty, IsOptional, IsString } from 'class-validator';

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
}
