import { IsString, IsOptional, MaxLength } from 'class-validator';

export class SendSmsDto {
  @IsOptional()
  @IsString()
  leadId?: string;

  @IsOptional()
  @IsString()
  contactId?: string;

  @IsString()
  @MaxLength(1600)
  body: string;
}
