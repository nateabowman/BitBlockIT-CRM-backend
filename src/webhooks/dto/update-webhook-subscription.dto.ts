import { IsString, IsUrl, IsArray, IsOptional, IsBoolean, IsIn } from 'class-validator';

const ALLOWED_EVENTS = ['lead.created', 'lead.updated', 'lead.stage_changed'] as const;

export class UpdateWebhookSubscriptionDto {
  @IsOptional()
  @IsUrl()
  url?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @IsIn(ALLOWED_EVENTS, { each: true })
  events?: string[];

  @IsOptional()
  @IsString()
  secret?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
