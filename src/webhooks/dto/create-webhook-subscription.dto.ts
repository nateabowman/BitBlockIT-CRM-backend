import { IsString, IsUrl, IsArray, IsOptional, IsBoolean, IsIn } from 'class-validator';

const ALLOWED_EVENTS = ['lead.created', 'lead.updated', 'lead.stage_changed'] as const;

export class CreateWebhookSubscriptionDto {
  @IsUrl()
  url: string;

  @IsArray()
  @IsString({ each: true })
  @IsIn(ALLOWED_EVENTS, { each: true })
  events: string[];

  @IsOptional()
  @IsString()
  secret?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
