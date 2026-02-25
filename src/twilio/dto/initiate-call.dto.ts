import { IsString, IsOptional } from 'class-validator';

export class InitiateCallDto {
  @IsString()
  leadId: string;

  @IsOptional()
  @IsString()
  scriptPlaybookId?: string;
}
