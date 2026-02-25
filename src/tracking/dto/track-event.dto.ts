import { IsString, IsOptional, IsObject } from 'class-validator';

export class TrackEventDto {
  @IsString()
  visitorId: string;

  @IsOptional()
  @IsString()
  contactId?: string;

  @IsOptional()
  @IsString()
  leadId?: string;

  @IsString()
  name: string;

  @IsOptional()
  @IsObject()
  properties?: Record<string, unknown>;
}
