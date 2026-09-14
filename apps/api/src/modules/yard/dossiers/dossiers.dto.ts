import { IsIn, IsOptional, IsString, Length } from 'class-validator';
import type { YardDossierKind, YardDossierSource } from '@pulsar/shared';
export class DossierSourceParams {
  @IsIn(['visit', 'appointment']) source!: YardDossierSource;
  @IsString() @Length(1, 100) id!: string;
}
export class DossierTargetParams {
  @IsIn(['load', 'receipt', 'pick-order']) kind!: YardDossierKind;
  @IsString() @Length(1, 100) id!: string;
}
export class DossierRemoveParams extends DossierSourceParams {
  @IsString() @Length(1, 100) linkId!: string;
}
export class DossierCandidatesQuery {
  @IsIn(['load', 'receipt', 'pick-order']) kind!: YardDossierKind;
  @IsOptional() @IsString() @Length(0, 80) q?: string;
}
export class AddDossierDto {
  @IsIn(['load', 'receipt', 'pick-order']) kind!: YardDossierKind;
  @IsString() @Length(1, 100) targetId!: string;
}
