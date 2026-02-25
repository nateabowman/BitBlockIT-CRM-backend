import { IsString, IsOptional, IsBoolean, IsEmail, IsObject } from 'class-validator';

export class CreateContactDto {
  @IsString()
  organizationId: string;

  @IsString()
  firstName: string;

  @IsString()
  lastName: string;

  @IsEmail()
  email: string;

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
  consentAt?: string; // ISO date; when consent was given

  @IsOptional()
  @IsString()
  consentSource?: string; // form | website | import
}
