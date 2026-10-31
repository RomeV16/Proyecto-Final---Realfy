import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { canReadResource, ReadResource } from '@realfy/shared';
import { READ_RESOURCE_KEY } from './read-resource.decorator';
import { ReadPolicyService } from './read-policy.service';
import { IS_PUBLIC_KEY } from '../auth/public.decorator';

/**
 * Aplica @ReadResource: además del rol de @Roles, la política de lectura de
 * la inmobiliaria debe permitir al rol del usuario leer el recurso. Si la
 * política no se puede cargar, se deniega (falla cerrado).
 */
@Injectable()
export class ReadPolicyGuard implements CanActivate {
  private readonly logger = new Logger(ReadPolicyGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly policies: ReadPolicyService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) {
      return true;
    }
    const resource = this.reflector.getAllAndOverride<ReadResource | undefined>(
      READ_RESOURCE_KEY,
      targets,
    );
    if (!resource) return true;

    const user = context.switchToHttp().getRequest().user as
      | { role?: string; tenantId?: string }
      | undefined;
    if (!user?.role || !user.tenantId) throw this.forbidden(resource);

    let allowed = false;
    try {
      const policy = await this.policies.getPolicy(user.tenantId);
      allowed = canReadResource(policy, resource, user.role);
    } catch (err) {
      this.logger.error(
        `No se pudo cargar la política de lectura (tenant=${user.tenantId}): ${(err as Error).message}`,
      );
    }
    if (!allowed) throw this.forbidden(resource);
    return true;
  }

  private forbidden(resource: ReadResource) {
    return new ForbiddenException({
      error: 'READ_FORBIDDEN',
      message: `Tu rol no tiene acceso de lectura a ${resource}`,
      resource,
    });
  }
}
