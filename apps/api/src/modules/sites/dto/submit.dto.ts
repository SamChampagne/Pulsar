import { IsOptional, IsString } from 'class-validator';

/**
 * Public form submission DTO. All fields are optional strings so the global
 * ValidationPipe whitelist does not strip them. _hp is the honeypot field —
 * non-empty means the submitter is a bot; the service will silently discard it.
 */
export class SubmitDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  company?: string;

  @IsOptional()
  @IsString()
  message?: string;

  /** Honeypot — bots fill this; humans leave it empty. */
  @IsOptional()
  @IsString()
  _hp?: string;
}
