import { IsString } from 'class-validator';

export class MergeLeadsDto {
  @IsString()
  mergeId: string; // lead to merge into keep (keepId is in URL)
}
