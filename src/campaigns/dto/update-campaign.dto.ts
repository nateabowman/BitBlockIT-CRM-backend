import { IsString, IsOptional, IsObject, IsDateString } from 'class-validator';

export class UpdateCampaignDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  segmentId?: string;

  @IsOptional()
  @IsString()
  templateId?: string;

  @IsOptional()
  @IsDateString()
  scheduledAt?: string | null;

  @IsOptional()
  @IsString()
  channel?: 'email' | 'sms' | 'push';

  @IsOptional()
  @IsObject()
  abConfig?: {
    variantA?: { subject?: string; bodyHtml?: string };
    variantB?: { subject?: string; bodyHtml?: string };
    splitPercent?: number;
  } | null;

  @IsOptional()
  @IsObject()
  scheduleConfig?: {
    timezone?: string;
    sendWindow?: { start: string; end: string; timezone: string };
  } | null;

  @IsOptional()
  @IsString()
  fromName?: string | null;

  @IsOptional()
  @IsString()
  fromEmail?: string | null;

  @IsOptional()
  @IsString()
  replyTo?: string | null;
}
