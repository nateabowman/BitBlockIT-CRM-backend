import { IsString, IsOptional, IsArray, ValidateNested, IsNumber, IsObject } from 'class-validator';
import { Type } from 'class-transformer';

class StepDto {
  @IsNumber()
  order!: number;
  @IsString()
  type!: string;
  @IsOptional()
  @IsString()
  templateId?: string;
  @IsOptional()
  @IsNumber()
  delayMinutes?: number;
  @IsOptional()
  @IsObject()
  condition?: Record<string, unknown>;
}

export class UpdateSequenceDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StepDto)
  steps?: StepDto[];
}
