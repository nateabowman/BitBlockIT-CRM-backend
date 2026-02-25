import { IsString, IsOptional, IsBoolean, IsEmail, IsObject } from 'class-validator';

export class UpdateContactDto {
  @IsOptional()
  @IsString()
  firstName?: string;

  @IsOptional()
  @IsString()
  lastName?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;

  @IsOptional()
  @IsObject()
  customFields?: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  unsubscribed?: boolean;

  @IsOptional()
  @IsBoolean()
  smsOptOut?: boolean;

  @IsOptional()
  @IsBoolean()
  dnc?: boolean; // do not contact

  @IsOptional()
  consentAt?: string | null; // ISO date

  @IsOptional()
  @IsString()
  consentSource?: string | null; // form | website | import
}
