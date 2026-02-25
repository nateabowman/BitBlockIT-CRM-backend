import { IsOptional, IsString, IsUrl, IsObject, Matches, MaxLength } from 'class-validator';

/** Allow E.164 or common formats (spaces, dashes, parens), or empty to clear; backend normalizes before save. */
const PHONE_PATTERN = /^[\d\s+\-().]{0,25}$/;

export class UpdateMeDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(25, { message: 'Phone number is too long' })
  @Matches(PHONE_PATTERN, { message: 'Phone should contain 10–15 digits; spaces/dashes/parens allowed' })
  phone?: string;

  @IsOptional()
  @IsString()
  timezone?: string;

  @IsOptional()
  @IsUrl()
  avatarUrl?: string;

  @IsOptional()
  @IsString()
  signature?: string;

  @IsOptional()
  @IsObject()
  notificationPrefs?: Record<string, unknown>;
}
