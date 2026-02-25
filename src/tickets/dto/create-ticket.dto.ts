import { IsString, IsOptional, IsDateString, IsIn, MinLength } from 'class-validator';

export class CreateTicketDto {
  @IsString()
  @MinLength(1)
  subject: string;

  @IsOptional()
  @IsString()
  leadId?: string;

  @IsOptional()
  @IsString()
  organizationId?: string;

  @IsOptional()
  @IsIn(['open', 'in_progress', 'resolved', 'closed'])
  status?: string;

  @IsOptional()
  @IsDateString()
  dueDate?: string;
}
