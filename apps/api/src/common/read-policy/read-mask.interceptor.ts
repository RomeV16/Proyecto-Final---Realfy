import {
  CallHandler,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { canReadResource, ReadResource } from '@realfy/shared';
import { Observable, from, map, switchMap } from 'rxjs';
import { MASK_READS_KEY } from './read-resource.decorator';
import { ReadPolicyService } from './read-policy.service';
import { fieldsToMask, maskFields } from './mask';

/**
 * Aplica @MaskReads: pone en null los campos de los recursos que el rol del
 * usuario no puede leer. Si la política no se puede cargar, la lectura se
 * deniega (falla cerrado) en lugar de devolver datos sin enmascarar.
 */
@Injectable()
export class ReadMaskInterceptor implements NestInterceptor {
  private readonly logger = new Logger(ReadMaskInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly policies: ReadPolicyService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const resources = this.reflector.getAllAndOverride<ReadResource[] | undefined>(
      MASK_READS_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!resources?.length) return next.handle();

    const user = context.switchToHttp().getRequest().user as
      | { role?: string; tenantId?: string }
      | undefined;

    return from(this.restricted(resources, user)).pipe(
      switchMap((restricted) =>
        next
          .handle()
          .pipe(
            map((body: unknown) =>
              restricted.length ? maskFields(body, fieldsToMask(restricted)) : body,
            ),
          ),
      ),
    );
  }

  private async restricted(
    resources: ReadResource[],
    user: { role?: string; tenantId?: string } | undefined,
  ): Promise<ReadResource[]> {
    if (!user?.role || !user.tenantId) return resources;
    try {
      const policy = await this.policies.getPolicy(user.tenantId);
      return resources.filter((r) => !canReadResource(policy, r, user.role));
    } catch (err) {
      this.logger.error(
        `No se pudo cargar la política de lectura (tenant=${user.tenantId}): ${(err as Error).message}`,
      );
      throw new ForbiddenException({
        error: 'READ_FORBIDDEN',
        message: 'No se pudo verificar el acceso de lectura',
      });
    }
  }
}
