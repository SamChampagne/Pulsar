import { IsString } from 'class-validator';

export class InviteDto {
  @IsString()
  carrierId!: string;
}
