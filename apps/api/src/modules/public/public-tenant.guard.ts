import {
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Request } from 'express';
import { PrismaService } from '../../common/prisma/prisma.service';

/**
 * Resolves the `:slug` route param into a tenant and attaches it to the
 * request as `publicTenant`. Runs on every /public/:slug/* route.
 *
 * Always reads through prisma.baseClient — this guard fires before any
 * tenant context is (or ever will be) set on the request, so the extended
 * client would fail open and scan across every inmobiliaria.
 */
@Injectable()
export class PublicTenantGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const slug = request.params?.slug as string | undefined;

    if (!slug) {
      throw new NotFoundException({
        error: 'TENANT_NOT_FOUND',
        message: 'Inmobiliaria not found',
      });
    }

    const tenant = await this.prisma.baseClient.tenant.findUnique({
      where: { slug },
      select: {
        id: true,
        name: true,
        slug: true,
        province: true,
        logoUrl: true,
        brandPrimary: true,
        brandSecondary: true,
        isActive: true,
      },
    });

    if (!tenant || !tenant.isActive) {
      throw new NotFoundException({
        error: 'TENANT_NOT_FOUND',
        message: 'Inmobiliaria not found',
      });
    }

    (request as any).publicTenant = tenant;
    return true;
  }
}
