import { IsUUID } from 'class-validator';

export class InviteDto {
  @IsUUID()
  carrierId!: string;
}
