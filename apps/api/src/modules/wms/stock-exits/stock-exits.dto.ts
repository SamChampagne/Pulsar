import {
  IsString,
  IsUUID,
  MinLength,
  MaxLength,
  IsEnum,
  Matches,
  ValidateIf,
  IsDateString,
  Equals,
} from 'class-validator';
import { StockExitKind, StockExitStatus } from '@pulsar/shared';
import { ListQueryDto } from '../../../common/dto/list-query.dto';
export class StockExitCreateDto {
  @ValidateIf((_, v) => v !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  purchaseSourceId?: string;
  @ValidateIf((_, v) => v !== undefined) @Matches(/^[a-f0-9]{64}$/) purchaseSourceToken?: string;
  @IsUUID('4') operationKey!: string;
  @IsEnum(StockExitKind) kind!: StockExitKind;
  @IsString() @MinLength(1) @MaxLength(100) itemId!: string;
  @IsString() @MinLength(1) @MaxLength(100) lotId!: string;
  @IsString() @MinLength(1) @MaxLength(100) binId!: string;
  @Matches(/^\d{1,9}(\.\d{1,3})?$/) quantity!: string;
  @IsString() @MinLength(3) @MaxLength(1000) reason!: string;
  @ValidateIf((_, v) => v !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  supplierId?: string;
  @ValidateIf((_, v) => v !== undefined)
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  reference?: string;
  @ValidateIf((_, v) => v !== undefined)
  @IsString()
  @MinLength(10)
  @MaxLength(1000)
  destination?: string;
}
export class StockExitPostDto {
  @IsUUID('4') operationKey!: string;
  @IsDateString() expectedUpdatedAt!: string;
  @Matches(/^[a-f0-9]{64}$/) reviewToken!: string;
  @IsString() @MinLength(10) @MaxLength(2000) completionNote!: string;
  @Equals(true) confirmed!: boolean;
}
export class StockExitCancelDto {
  @IsUUID('4') operationKey!: string;
  @IsDateString() expectedUpdatedAt!: string;
  @IsString() @MinLength(3) @MaxLength(1000) reason!: string;
}
export class StockExitQueryDto extends ListQueryDto {
  @ValidateIf((_, v) => v !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  purchaseOrderId?: string;
  @ValidateIf((_, v) => v !== undefined) @IsString() @MinLength(1) @MaxLength(100) lotId?: string;
  @ValidateIf((_, v) => v !== undefined) @IsEnum(StockExitStatus) status?: StockExitStatus;
}

export class StockExitEvidenceDto {
  @IsUUID('4') operationKey!: string;
  @IsString() @MinLength(3) @MaxLength(1000) caption!: string;
}
export class StockExitSourcesDto extends ListQueryDto {
  @IsString() @MinLength(1) @MaxLength(100) itemId!: string;
  @IsString() @MinLength(1) @MaxLength(100) lotId!: string;
}
export class StockExitPurchaseSourcesDto extends StockExitSourcesDto {
  @IsString() @MinLength(1) @MaxLength(100) supplierId!: string;
  @IsString() @MinLength(1) @MaxLength(100) binId!: string;
}
