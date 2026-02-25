import { IsString, IsEmail, IsOptional, IsObject, IsArray } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class WebhookLeadDto {
  @ApiProperty({ example: 'Jane Doe', description: 'Full name, or leave empty if sending firstName + lastName' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ example: 'Jane', description: 'If name is omitted, firstName + lastName are used' })
  @IsOptional()
  @IsString()
  firstName?: string;

  @ApiPropertyOptional({ example: 'Doe', description: 'If name is omitted, firstName + lastName are used' })
  @IsOptional()
  @IsString()
  lastName?: string;

  @ApiProperty({ example: 'jane@example.com' })
  @IsEmail()
  email: string;

  @ApiPropertyOptional({ example: 'Acme Inc' })
  @IsOptional()
  @IsString()
  company?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({ example: 'Website' })
  @IsOptional()
  @IsString()
  source?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  utm_source?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  utm_medium?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  utm_campaign?: string;

  @ApiPropertyOptional({ description: 'Visitor IP address (capture from request on your server)' })
  @IsOptional()
  @IsString()
  ip?: string;

  @ApiPropertyOptional({ description: 'Browser user agent string' })
  @IsOptional()
  @IsString()
  user_agent?: string;

  @ApiPropertyOptional({ description: 'Referrer URL (document.referrer or Referer header)' })
  @IsOptional()
  @IsString()
  referrer?: string;

  @ApiPropertyOptional({ description: 'Geo/location data: { city, region, country, timezone, lat, lon }' })
  @IsOptional()
  @IsObject()
  geo?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Custom key-value pairs stored on the lead' })
  @IsOptional()
  @IsObject()
  custom?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Form message; stored in custom.message if provided' })
  @IsOptional()
  @IsString()
  message?: string;

  @ApiPropertyOptional({ description: 'Sequence ID to auto-enroll the lead in (drip campaign)' })
  @IsOptional()
  @IsString()
  sequence_id?: string;

  @ApiPropertyOptional({ description: 'Tag IDs to add to the lead (segment/campaign targeting)' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tag_ids?: string[];
}
