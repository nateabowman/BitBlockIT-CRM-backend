import { IsString, IsOptional, IsObject } from 'class-validator';

export class UpdateSegmentDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsObject()
  filters?: {
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
    createdAtAfter?: string;
    createdAtBefore?: string;
    notBounced?: boolean;
  };

  @IsOptional()
  @IsString()
  organizationId?: string | null;

  @IsOptional()
  @IsString()
  excludeSegmentId?: string | null;

  @IsOptional()
  @IsString()
  type?: 'static' | 'dynamic';
}
