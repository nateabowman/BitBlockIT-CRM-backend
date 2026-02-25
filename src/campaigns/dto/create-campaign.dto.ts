import { IsString, IsOptional, IsObject, IsDateString } from 'class-validator';

export class CreateCampaignDto {
  @IsString()
  name: string;

  @IsString()
  segmentId: string;

  @IsString()
  templateId: string;

  @IsOptional()
  @IsDateString()
  scheduledAt?: string;

  @IsOptional()
  @IsString()
  channel?: 'email' | 'sms' | 'push';

  @IsOptional()
  @IsObject()
  abConfig?: {
    variantA?: { subject?: string; bodyHtml?: string };
    variantB?: { subject?: string; bodyHtml?: string };
    splitPercent?: number; // e.g. 20 = 20% A, 80% B
  };

  @IsOptional()
  @IsObject()
  scheduleConfig?: {
    timezone?: string; // e.g. America/New_York (for display / send window)
    sendWindow?: { start: string; end: string; timezone: string }; // e.g. { start: "09:00", end: "17:00", timezone: "America/New_York" }
  };

  @IsOptional()
  @IsString()
  fromName?: string;

  @IsOptional()
  @IsString()
  fromEmail?: string;

  @IsOptional()
  @IsString()
  replyTo?: string;
}
