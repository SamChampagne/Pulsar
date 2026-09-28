import { Module } from '@nestjs/common';
import { BusinessModule } from '../../modules/business/business.module';
import { OperationalRecordsModule } from './operational-records.module';
import { ReferenceDataControllers } from './reference-data.controllers';
import { PartyDirectoryControllers } from './party-directory.controllers';
import { PartyDirectoryService } from './party-directory.service';
import { DirectoryImpactService } from './directory-impact.service';
import { DocumentCoordinatesModule } from './document-coordinates.module';
import { PartyProfileControllers } from './party-profile.controllers';
import { PartyProfileService } from './party-profile.service';
import { PartyIdentityService } from './party-identity.service';
import { PartyWorkspaceService } from './party-workspace.service';

@Module({
  imports: [OperationalRecordsModule, BusinessModule, DocumentCoordinatesModule],
  controllers: [
    ...ReferenceDataControllers,
    ...PartyDirectoryControllers,
    ...PartyProfileControllers,
  ],
  providers: [
    PartyDirectoryService,
    DirectoryImpactService,
    PartyProfileService,
    PartyIdentityService,
    PartyWorkspaceService,
  ],
})
export class ReferenceDataModule {}
