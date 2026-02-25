import { IsString } from 'class-validator';

export class EnrollSequenceDto {
  @IsString()
  leadId: string;

  @IsString()
  contactId: string;
}
