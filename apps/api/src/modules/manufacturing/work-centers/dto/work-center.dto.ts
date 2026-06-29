import { PartialType } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CreateWorkCenterDto {
  @IsString()
  code!: string;

  @IsString()
  name!: string;

  @IsString()
  calendarId!: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  capabilities?: string[];

  @IsOptional()
  @IsNumber()
  @Min(0.01)
  efficiency?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateWorkCenterDto extends PartialType(CreateWorkCenterDto) {}
