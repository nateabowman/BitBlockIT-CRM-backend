import { IsString, IsOptional, IsDateString, IsObject } from 'class-validator';

export class CreateActivityDto {
  @IsString()
  leadId: string;

  @IsOptional()
  @IsString()
  contactId?: string;

  @IsOptional()
  @IsString()
  assignedToId?: string;

  @IsString()
  type: string;

  @IsOptional()
  @IsString()
  emailThreadId?: string;

  @IsOptional()
  @IsString()
  recurrenceRule?: string;

  @IsOptional()
  @IsDateString()
  recurrenceEndAt?: string;

  @IsOptional()
  @IsString()
  subject?: string;

  @IsOptional()
  @IsString()
  body?: string;

  @IsOptional()
  @IsString()
  outcome?: string;

  @IsOptional()
  @IsDateString()
  scheduledAt?: string;

  @IsOptional()
  @IsDateString()
  reminderAt?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
