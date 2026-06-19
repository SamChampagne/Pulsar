import { PartialType } from '@nestjs/swagger';
import { CreateRfpDto } from './create-rfp.dto';

export class UpdateRfpDto extends PartialType(CreateRfpDto) {}
