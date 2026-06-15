import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';
import { ComplianceDocType, ComplianceSubject } from '@pulsar/shared';

export class CreateComplianceDocumentDto {
  @IsEnum(ComplianceSubject) subjectType!: ComplianceSubject;
  @IsString() @MinLength(1) subjectId!: string;
  @IsEnum(ComplianceDocType) docType!: ComplianceDocType;
  @IsOptional() @IsString() reference?: string;
  @IsOptional() @Type(() => Date) issuedAt?: Date;
  @Type(() => Date) expiresAt!: Date;
  @IsOptional() @IsString() documentId?: string;
  @IsOptional() @IsString() notes?: string;
}

export class ComplianceListQueryDto {
  @IsOptional() @IsEnum(ComplianceSubject) subjectType?: ComplianceSubject;
  @IsOptional() @IsString() subjectId?: string;
  @IsOptional() @IsInt() @Min(1) @Type(() => Number) expiringDays?: number;
}
