import {
  ArgumentMetadata,
  BadRequestException,
  Injectable,
  PipeTransform,
} from '@nestjs/common';
import type { z, ZodTypeAny } from 'zod';

/** Estructural: evita depender de la identidad de clase de `zod` entre paquetes. */
function isZodError(err: unknown): err is { errors: unknown[] } {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { name?: unknown }).name === 'ZodError' &&
    'errors' in err
  );
}

/**
 * Valida `input` con `schema`. Si falla, lanza el 400 uniforme de la API
 * (`VALIDATION_ERROR` con los problemas en `details`); cualquier otro error
 * se propaga tal cual.
 */
export function parseOrThrow<S extends ZodTypeAny>(
  schema: S,
  input: unknown,
  message = 'Invalid data',
): z.output<S> {
  try {
    return schema.parse(input);
  } catch (err) {
    if (isZodError(err)) {
      throw new BadRequestException({
        error: 'VALIDATION_ERROR',
        message,
        details: err.errors,
      });
    }
    throw err;
  }
}

/** Pipe para controladores: `@Body(new ZodValidationPipe(Schema))`. */
@Injectable()
export class ZodValidationPipe<S extends ZodTypeAny> implements PipeTransform {
  constructor(
    private readonly schema: S,
    private readonly message?: string,
  ) {}

  transform(value: unknown, _metadata?: ArgumentMetadata): z.output<S> {
    return parseOrThrow(this.schema, value, this.message);
  }
}
