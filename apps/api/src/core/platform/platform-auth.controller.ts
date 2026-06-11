import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ThrottlerGuard } from '@nestjs/throttler';
import { IsEmail, IsString, Length } from 'class-validator';
import { Public } from '../../common/decorators/public.decorator';
import { PlatformAuthService } from './platform-auth.service';

class PlatformLoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  password!: string;
}

class MfaEnrollDto {
  @IsString()
  enrollToken!: string;

  @IsString()
  @Length(6, 10)
  code!: string;
}

class MfaVerifyDto {
  @IsString()
  mfaToken!: string;

  @IsString()
  @Length(6, 10)
  code!: string;
}

// Brute-force gate on the cross-tenant door. 20/min/IP (not 5) because local e2e
// suites share one IP and legitimately log in often; the anti-brute-force intent holds.
@UseGuards(ThrottlerGuard)
@ApiTags('platform')
@Controller('platform/auth')
export class PlatformAuthController {
  constructor(private readonly auth: PlatformAuthService) {}

  // @Public bypasses the global tenant JwtAuthGuard; credentials do the gating.
  @Public()
  @Post('login')
  @HttpCode(200)
  login(@Body() dto: PlatformLoginDto) {
    return this.auth.login(dto.email, dto.password);
  }

  @Public()
  @Post('mfa/enroll')
  @HttpCode(200)
  enroll(@Body() dto: MfaEnrollDto) {
    return this.auth.enroll(dto.enrollToken, dto.code);
  }

  @Public()
  @Post('mfa/verify')
  @HttpCode(200)
  verifyMfa(@Body() dto: MfaVerifyDto) {
    return this.auth.verifyMfa(dto.mfaToken, dto.code);
  }
}
