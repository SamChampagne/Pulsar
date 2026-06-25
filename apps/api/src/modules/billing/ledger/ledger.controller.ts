import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@pulsar/shared';
import { MODULE_KEYS, PERMISSIONS } from '@pulsar/shared';
import { ArrayMinSize, IsArray, IsDateString, IsNumber, IsOptional, IsString, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequireModule } from '../../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { ListQueryDto } from '../../../common/dto/list-query.dto';
import { LedgerService } from './ledger.service';

class JournalQueryDto extends ListQueryDto {
  @IsOptional()
  @IsString()
  accountId?: string;

  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @IsOptional()
  @IsDateString()
  dateTo?: string;
}

class JournalLineDto {
  @IsString()
  accountCode!: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  debit?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  credit?: number;

  @IsOptional()
  @IsString()
  memo?: string;
}

class PostEntryDto {
  @IsOptional()
  @IsDateString()
  date?: string;

  @IsOptional()
  @IsString()
  memo?: string;

  @IsArray()
  @ArrayMinSize(2)
  @ValidateNested({ each: true })
  @Type(() => JournalLineDto)
  lines!: JournalLineDto[];
}

@ApiTags('billing')
@ApiBearerAuth()
@RequireModule(MODULE_KEYS.BILLING)
@Controller('billing/ledger')
export class LedgerController {
  constructor(private readonly ledger: LedgerService) {}

  @Get('accounts')
  @RequirePermissions(PERMISSIONS.BILLING.LEDGER_READ)
  async accounts(@CurrentUser() user: AuthUser) {
    await this.ledger.ensureChart(user.tenantId);
    return this.ledger.listAccounts(user.tenantId);
  }

  @Get('journal')
  @RequirePermissions(PERMISSIONS.BILLING.LEDGER_READ)
  journal(@CurrentUser() user: AuthUser, @Query() query: JournalQueryDto) {
    return this.ledger.listJournal(user.tenantId, query);
  }

  @Get('trial-balance')
  @RequirePermissions(PERMISSIONS.BILLING.LEDGER_READ)
  trialBalance(@CurrentUser() user: AuthUser, @Query('asOf') asOf?: string) {
    return this.ledger.trialBalance(user.tenantId, asOf ? new Date(asOf) : undefined);
  }

  @Post('entries')
  @RequirePermissions(PERMISSIONS.BILLING.LEDGER_MANAGE)
  postEntry(@CurrentUser() user: AuthUser, @Body() dto: PostEntryDto) {
    return this.ledger.post(
      user.tenantId,
      {
        date: dto.date ? new Date(dto.date) : undefined,
        memo: dto.memo,
        lines: dto.lines,
      },
      user.id,
    );
  }
}
