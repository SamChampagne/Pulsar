import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { ReleaseNoteKind } from '@pulsar/database';

export class CreateReleaseNoteDto {
  @ApiProperty({ maxLength: 160 })
  @IsString()
  @MaxLength(160)
  title!: string;

  @ApiProperty({ maxLength: 8000 })
  @IsString()
  @MaxLength(8000)
  body!: string;

  @ApiProperty({ enum: ReleaseNoteKind })
  @IsEnum(ReleaseNoteKind)
  kind!: ReleaseNoteKind;

  @ApiPropertyOptional({ maxLength: 40 })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  version?: string;
}

export class UpdateReleaseNoteDto extends PartialType(CreateReleaseNoteDto) {}
