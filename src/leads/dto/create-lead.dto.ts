import { IsString, IsOptional, IsObject, IsNumber, IsDateString, Min } from 'class-validator';

export class CreateLeadDto {
  @IsString()
  title: string;

  @IsOptional()
  @IsString()
  organizationId?: string;

  @IsOptional()
  @IsString()
  primaryContactId?: string;

  @IsString()
  pipelineId: string;

  @IsString()
  stageId: string;

  @IsOptional()
  @IsString()
  source?: string;

  @IsOptional()
  @IsString()
  sourceDetail?: string;

  @IsOptional()
  @IsString()
  assignedToId?: string;

  @IsOptional()
  @IsObject()
  customFields?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  nextStep?: string;

  @IsOptional()
  @IsDateString()
  expectedCloseAt?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  amount?: number;

  @IsOptional()
  @IsString()
  currency?: string;
}
