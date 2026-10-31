import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { Request } from 'express';
import { TenantContextService } from '../tenant/tenant-context.service';
import { UserRole } from '@realfy/shared';
import { resolveJwtSecret } from './jwt-secret';
import { PrismaService } from '../prisma/prisma.service';

export interface JwtPayload {
  sub: string;       // userId
  tenantId: string;
  role: UserRole;
  iat?: number;
  exp?: number;
}

/**
 * Extract JWT from httpOnly cookie first, then Authorization header as fallback.
 */
function extractJwt(req: Request): string | null {
  // 1. Try httpOnly cookie
  const cookieToken = (req.cookies as Record<string, string>)?.access_token;
  if (cookieToken) return cookieToken;

  // 2. Fallback to Authorization: Bearer header
  return ExtractJwt.fromAuthHeaderAsBearerToken()(req);
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    private readonly tenantContext: TenantContextService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: extractJwt,
      ignoreExpiration: false,
      secretOrKey: resolveJwtSecret(configService),
    });
  }

  /**
   * Called after token signature is verified.
   * Stores tenant context in CLS for downstream use.
   */
  async validate(payload: JwtPayload) {
    // Reject portal tokens — they have type: 'portal' and no role
    if ((payload as any).type === 'portal' || !payload.role) {
      return null;
    }

    // La baja y el cambio de rol rigen desde el siguiente pedido: se lee el
    // estado vigente en lugar de confiar en lo que dice un token de hasta
    // 15 minutos.
    const current = await this.prisma.baseClient.user.findUnique({
      where: { id: payload.sub },
      select: { isActive: true, role: true, tenantId: true },
    });
    if (!current || !current.isActive || current.tenantId !== payload.tenantId) {
      return null;
    }

    this.tenantContext.setTenantId(current.tenantId);
    this.tenantContext.setUserId(payload.sub);
    this.tenantContext.setUserRole(current.role as UserRole);

    return {
      userId: payload.sub,
      tenantId: current.tenantId,
      role: current.role,
    };
  }
}
