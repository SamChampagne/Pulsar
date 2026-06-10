import { Global, Module } from '@nestjs/common';
import { OwnershipService } from './ownership.service';
import { PrismaService } from './prisma.service';
import { SequencesService } from './sequences.service';
import { TenantModulesCacheService } from './tenant-modules-cache.service';

@Global()
@Module({
  providers: [PrismaService, SequencesService, OwnershipService, TenantModulesCacheService],
  exports: [PrismaService, SequencesService, OwnershipService, TenantModulesCacheService],
})
export class PrismaModule {}
