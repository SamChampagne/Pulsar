import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@pulsar/shared';
import { CURRENCIES, MODULE_KEYS, PERMISSIONS } from '@pulsar/shared';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsOptional,
  IsString,
  ValidateNested,
  IsIn,
  IsUUID,
  Matches,
  MaxLength,
  ArrayMaxSize,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { parseLedgerDate } from './ledger-read';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequireModule } from '../../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { ListQueryDto } from '../../../common/dto/list-query.dto';
import { LedgerService } from './ledger.service';

class JournalQueryDto extends ListQueryDto {
  @IsOptional() @IsIn(CURRENCIES.map((c) => c.code)) currency?: string;
  @IsOptional()
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsIn([true, false])
  unqualified?: boolean;
  @IsOptional()
  @IsString()
  sourceType?: string;

  @IsOptional()
  @IsString()
  sourceId?: string;

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
  @Transform(({ value }) => (typeof value === 'number' ? String(value) : value))
  @Matches(/^\d{1,10}(?:\.\d{1,2})?$/)
  debit?: string;

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'number' ? String(value) : value))
  @Matches(/^\d{1,10}(?:\.\d{1,2})?$/)
  credit?: string;

  @IsOptional()
  @IsString()
  memo?: string;
}

class PostEntryDto {
  @IsUUID('4') operationKey!: string;
  @IsIn(CURRENCIES.map((c) => c.code)) currency!: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) date!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  memo?: string;

  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(200)
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
  trialBalance(
    @CurrentUser() user: AuthUser,
    @Query('asOf') asOf?: string,
    @Query('currency') currency?: string,
  ) {
    return this.ledger.trialBalance(user.tenantId, parseLedgerDate(asOf), currency);
  }

  @Get('requests/:key')
  @RequirePermissions(PERMISSIONS.BILLING.LEDGER_READ, PERMISSIONS.BILLING.LEDGER_MANAGE)
  request(
    @CurrentUser() user: AuthUser,
    @Param('key', new ParseUUIDPipe({ version: '4' })) key: string,
  ) {
    return this.ledger.manualRequest(user.tenantId, user.id, key);
  }

  @Post('entries')
  @RequirePermissions(PERMISSIONS.BILLING.LEDGER_READ, PERMISSIONS.BILLING.LEDGER_MANAGE)
  postEntry(@CurrentUser() user: AuthUser, @Body() dto: PostEntryDto) {
    return this.ledger.postManual(
      user.tenantId,
      {
        date: parseLedgerDate(dto.date),
        currency: dto.currency,
        operationKey: dto.operationKey,
        memo: dto.memo,
        lines: dto.lines,
      },
      user.id,
    );
  }
}
