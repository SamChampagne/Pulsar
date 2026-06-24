import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsEmail, IsOptional, IsString } from 'class-validator';

export class SimulateInboundDto {
  @ApiProperty() @IsEmail() from!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() fromName?: string;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() to?: string[];
  @ApiProperty() @IsString() subject!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() html?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() text?: string;
  @ApiProperty() @IsString() messageId!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() inReplyTo?: string;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() references?: string[];
}
