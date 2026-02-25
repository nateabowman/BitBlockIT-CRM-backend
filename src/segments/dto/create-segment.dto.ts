import { IsString, IsOptional, IsObject } from 'class-validator';

export class CreateSegmentDto {
  @IsString()
  name: string;

  @IsObject()
  filters: {
    pipelineId?: string;
    stageIds?: string[];
    tagIds?: string[];
    source?: string;
    organizationId?: string;
    notUnsubscribed?: boolean;
    utmSource?: string;
    utmMedium?: string;
    utmCampaign?: string;
    scoreMin?: number;
    scoreMax?: number;
    createdAtAfter?: string; // ISO date
    createdAtBefore?: string;
    notBounced?: boolean;
  };

  @IsOptional()
  @IsString()
  organizationId?: string;

  @IsOptional()
  @IsString()
  excludeSegmentId?: string | null;

  @IsOptional()
  @IsString()
  type?: 'static' | 'dynamic';
}
