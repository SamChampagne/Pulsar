import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { MODULE_KEYS, PERMISSIONS, type AuthUser } from '@pulsar/shared';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequireModule } from '../../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import {
  AddDossierDto,
  DossierCandidatesQuery,
  DossierSourceParams,
  DossierTargetParams,
  DossierRemoveParams,
} from './dossiers.dto';
import { YardDossiersService } from './dossiers.service';

@ApiTags('yard/dossiers')
@ApiBearerAuth()
@RequireModule(MODULE_KEYS.YARD)
@Controller('yard/dossiers')
export class YardDossiersController {
  constructor(private readonly service: YardDossiersService) {}
  @Get('related/:kind/:id')
  @RequirePermissions(PERMISSIONS.YARD.READ)
  related(@CurrentUser() u: AuthUser, @Param() p: DossierTargetParams) {
    return this.service.related(u, p.kind, p.id);
  }
  @Get(':source/:id')
  @RequirePermissions(PERMISSIONS.YARD.READ)
  read(@CurrentUser() u: AuthUser, @Param() p: DossierSourceParams) {
    return this.service.read(u, p);
  }
  @Get(':source/:id/candidates')
  @RequirePermissions(PERMISSIONS.YARD.READ)
  candidates(
    @CurrentUser() u: AuthUser,
    @Param() p: DossierSourceParams,
    @Query() q: DossierCandidatesQuery,
  ) {
    return this.service.candidates(u, p, q.kind, q.q);
  }
  @Post(':source/:id/links')
  @RequirePermissions(PERMISSIONS.YARD.READ, PERMISSIONS.YARD.MANAGE)
  add(@CurrentUser() u: AuthUser, @Param() p: DossierSourceParams, @Body() dto: AddDossierDto) {
    return this.service.add(u, p, dto);
  }
  @Delete(':source/:id/links/:linkId')
  @RequirePermissions(PERMISSIONS.YARD.READ, PERMISSIONS.YARD.MANAGE)
  remove(@CurrentUser() u: AuthUser, @Param() p: DossierRemoveParams) {
    return this.service.remove(u, p, p.linkId);
  }
}
