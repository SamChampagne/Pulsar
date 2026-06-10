import { Global, Module } from '@nestjs/common';
import { OwnershipService } from './ownership.service';
import { PrismaService } from './prisma.service';
import { SequencesService } from './sequences.service';

@Global()
@Module({
  providers: [PrismaService, SequencesService, OwnershipService],
  exports: [PrismaService, SequencesService, OwnershipService],
})
export class PrismaModule {}
