import { UpdateTenantSchema } from '@realfy/shared';
import type { UpdateTenantInput } from '@realfy/shared';

export class UpdateTenantDto {
  /**
   * Validates and strips unknown fields using the shared Zod schema.
   * Returns the parsed input or throws a descriptive error.
   */
  static validate(data: unknown): UpdateTenantInput {
    return UpdateTenantSchema.parse(data);
  }
}
