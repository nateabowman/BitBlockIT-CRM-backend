import { IsString, IsNotEmpty } from 'class-validator';

export class DialCallDto {
  @IsString()
  @IsNotEmpty({ message: 'Phone number is required' })
  to: string;
}
