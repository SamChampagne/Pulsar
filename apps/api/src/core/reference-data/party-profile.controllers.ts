import { Body, Controller, Get, Inject, Param, Put, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuditAction, PARTY_ACCESS, type AuthUser } from '@pulsar/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireModule } from '../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { Audit } from '../../common/decorators/audit.decorator';
import { PartyProfileService } from './party-profile.service';
import { PartyIdentityService } from './party-identity.service';
import { PartyWorkspaceService } from './party-workspace.service';
import { PartyWorkspaceQueryDto } from './party-workspace.dto';
import {
  SavePartyProfileDto,
  ReviewIdentityDto,
  ConfirmIdentityDto,
  IdentityCandidatesDto,
} from './party-profile.dto';

export const PartyProfileControllers = PARTY_ACCESS.map((access) => {
  @ApiTags('party-profiles')
  @ApiBearerAuth()
  @RequireModule(access.module)
  @Controller(`${access.path}/:id`)
  class ProfileController {
    constructor(
      @Inject(PartyProfileService) private readonly profiles: PartyProfileService,
      @Inject(PartyIdentityService) private readonly identities: PartyIdentityService,
      @Inject(PartyWorkspaceService) private readonly workspace: PartyWorkspaceService,
    ) {}
    @Get('workspace')
    @RequirePermissions(access.read)
    dossiers(
      @CurrentUser() u: AuthUser,
      @Param('id') id: string,
      @Query() q: PartyWorkspaceQueryDto,
    ) {
      return this.workspace.get(u, access, id, q);
    }
    @Get('business-profile')
    @RequirePermissions(access.read)
    profile(@CurrentUser() u: AuthUser, @Param('id') id: string) {
      return this.profiles.get(u.tenantId, access.kind, id);
    }
    @Put('business-profile')
    @RequirePermissions(access.read, access.manage)
    @Audit('party-business-profile', AuditAction.UPDATE)
    save(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() d: SavePartyProfileDto) {
      return this.profiles.save(u.tenantId, access.kind, id, d.expectedVersion, d.data);
    }
    @Get('identity')
    @RequirePermissions(access.read)
    identity(@CurrentUser() u: AuthUser, @Param('id') id: string) {
      return this.identities.get(u, access, id);
    }
    @Get('identity/candidates')
    @RequirePermissions(access.read)
    candidates(
      @CurrentUser() u: AuthUser,
      @Param('id') id: string,
      @Query() q: IdentityCandidatesDto,
    ) {
      return this.identities.candidates(u, access, id, q);
    }
    @Post('identity/review')
    @RequirePermissions(access.read, access.manage)
    review(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() d: ReviewIdentityDto) {
      return this.identities.review(u, access, id, d);
    }
    @Post('identity/confirm')
    @RequirePermissions(access.read, access.manage)
    @Audit('business-partner-links', AuditAction.UPDATE)
    confirm(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() d: ConfirmIdentityDto) {
      return this.identities.review(u, access, id, d, true);
    }
  }
  Object.defineProperty(ProfileController, 'name', {
    value: `PartyProfile_${access.path.replace(/\W/g, '_')}`,
  });
  return ProfileController;
});
