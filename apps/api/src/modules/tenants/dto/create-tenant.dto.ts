import { CreateTenantSchema } from '@realfy/shared';
import type { CreateTenantInput } from '@realfy/shared';

export class CreateTenantDto {
  /**
   * Validates and strips unknown fields using the shared Zod schema.
   * Returns the parsed input or throws a descriptive error.
   */
  static validate(data: unknown): CreateTenantInput {
    return CreateTenantSchema.parse(data);
  }
}
