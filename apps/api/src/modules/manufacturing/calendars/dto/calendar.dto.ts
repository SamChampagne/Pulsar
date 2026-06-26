import { PartialType } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';

export class CreateCalendarDto {
  @IsString()
  code!: string;

  @IsString()
  name!: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateCalendarDto extends PartialType(CreateCalendarDto) {}

export class CreateShiftDto {
  @IsInt()
  @Min(0)
  @Max(6)
  weekday!: number;

  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'startTime must be HH:MM' })
  startTime!: string;

  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'endTime must be HH:MM' })
  endTime!: string;
}
