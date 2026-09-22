import { Module } from '@nestjs/common';
import { AuditLogsModule } from '../../core/audit-logs/audit-logs.module';
import { HrController, HrSelfController } from './hr.controller';
import { HrService } from './hr.service';
import { HrSkillsService } from './skills.service';
import { HrSkillsController, ManufacturingQualificationsController } from './skills.controller';
@Module({
  imports: [AuditLogsModule],
  controllers: [
    HrController,
    HrSelfController,
    HrSkillsController,
    ManufacturingQualificationsController,
  ],
  providers: [HrService, HrSkillsService],
})
export class HrModule {}
