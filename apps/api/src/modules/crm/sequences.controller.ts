import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import {
  AuditAction,
  CrmSequenceRunStatus,
  MODULE_KEYS,
  PERMISSIONS,
  type AuthUser,
} from '@pulsar/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireModule } from '../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { Audit } from '../../common/decorators/audit.decorator';
import { ListQueryDto } from '../../common/dto/list-query.dto';
import { SequencesService } from './sequences.service';
import {
  EmailPreferenceDto,
  EnrollSequenceDto,
  SaveSequenceDto,
  SequenceRunsQueryDto,
  UnsubscribeSequenceDto,
} from './dto/sequence.dto';

@ApiTags('crm-sequences')
@ApiBearerAuth()
@RequireModule(MODULE_KEYS.CRM)
@Controller('crm/sequences')
export class SequencesController {
  constructor(private readonly sequences: SequencesService) {}
  @Get()
  @RequirePermissions(PERMISSIONS.CRM.READ)
  list(@CurrentUser() user: AuthUser, @Query() query: ListQueryDto) {
    return this.sequences.list(user.tenantId, query);
  }
  @Get('runs')
  @RequirePermissions(PERMISSIONS.CRM.READ)
  runs(@CurrentUser() user: AuthUser, @Query() query: SequenceRunsQueryDto) {
    return this.sequences.runs(user.tenantId, query);
  }
  @Post()
  @RequirePermissions(PERMISSIONS.CRM.MANAGE, PERMISSIONS.EMAIL.SEND)
  @Audit('crm-sequence', AuditAction.CREATE)
  create(@CurrentUser() user: AuthUser, @Body() dto: SaveSequenceDto) {
    return this.sequences.save(user.tenantId, user.id, dto);
  }
  @Put(':id')
  @RequirePermissions(PERMISSIONS.CRM.MANAGE, PERMISSIONS.EMAIL.SEND)
  @Audit('crm-sequence', AuditAction.UPDATE)
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: SaveSequenceDto) {
    return this.sequences.save(user.tenantId, user.id, dto, id);
  }
  @Post(':id/enroll')
  @RequirePermissions(PERMISSIONS.CRM.MANAGE, PERMISSIONS.EMAIL.SEND)
  enroll(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: EnrollSequenceDto) {
    return this.sequences.enroll(user.tenantId, id, dto.contactId, user.id);
  }
  @Post('runs/:id/pause')
  @RequirePermissions(PERMISSIONS.CRM.MANAGE)
  pause(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.sequences.transition(
      user.tenantId,
      id,
      user.id,
      CrmSequenceRunStatus.PAUSED,
      'Pause manuelle',
    );
  }
  @Post('runs/:id/resume')
  @RequirePermissions(PERMISSIONS.CRM.MANAGE, PERMISSIONS.EMAIL.SEND)
  resume(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.sequences.transition(user.tenantId, id, user.id, CrmSequenceRunStatus.ACTIVE);
  }
  @Post('runs/:id/stop')
  @RequirePermissions(PERMISSIONS.CRM.MANAGE)
  stop(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.sequences.transition(
      user.tenantId,
      id,
      user.id,
      CrmSequenceRunStatus.STOPPED,
      'Arrêt manuel',
    );
  }
}

@ApiTags('crm-sequences')
@ApiBearerAuth()
@RequireModule(MODULE_KEYS.CRM)
@Controller('crm/contacts/:id/email-preference')
export class EmailPreferenceController {
  constructor(private readonly sequences: SequencesService) {}
  @Get()
  @RequirePermissions(PERMISSIONS.CRM.READ)
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.sequences.preference(user.tenantId, id);
  }
  @Patch()
  @RequirePermissions(PERMISSIONS.CRM.MANAGE)
  @Audit('crm-email-preference', AuditAction.UPDATE)
  save(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: EmailPreferenceDto) {
    return this.sequences.setPreference(user.tenantId, id, user.id, dto);
  }
}

/** Revocation capability, not a public business-data endpoint. GET never changes consent. */
@Controller('public/crm/unsubscribe')
export class SequenceUnsubscribeController {
  constructor(private readonly sequences: SequencesService) {}
  @Post()
  @Public()
  @HttpCode(200)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  unsubscribe(@Body() dto: UnsubscribeSequenceDto) {
    return this.sequences.unsubscribe(dto.token);
  }
}
