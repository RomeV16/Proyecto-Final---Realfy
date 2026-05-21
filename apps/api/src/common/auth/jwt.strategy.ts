import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { Request } from 'express';
import { TenantContextService } from '../tenant/tenant-context.service';
import { UserRole } from '@realfy/shared';

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
  ) {
    super({
      jwtFromRequest: extractJwt,
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_SECRET', 'dev-jwt-secret-change-me'),
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

    this.tenantContext.setTenantId(payload.tenantId);
    this.tenantContext.setUserId(payload.sub);
    this.tenantContext.setUserRole(payload.role as UserRole);

    return {
      userId: payload.sub,
      tenantId: payload.tenantId,
      role: payload.role,
    };
  }
}
