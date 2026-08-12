import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { TenantContextService } from '../tenant/tenant-context.service';

export interface PortalJwtPayload {
  sub: string;       // personId
  tenantId: string;
  type: 'portal';
  iat?: number;
  exp?: number;
}

@Injectable()
export class PortalJwtStrategy extends PassportStrategy(Strategy, 'portal-jwt') {
  constructor(
    configService: ConfigService,
    private readonly tenantContext: TenantContextService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_SECRET', 'dev-jwt-secret-change-me'),
    });
  }

  /**
   * Called after token signature is verified.
   * Rejects tokens that don't have type:'portal' to prevent staff token cross-use.
   * Stores portal context in CLS for downstream use.
   */
  async validate(payload: PortalJwtPayload) {
    if (payload.type !== 'portal') {
      throw new UnauthorizedException({
        error: 'INVALID_TOKEN_TYPE',
        message: 'Token is not a portal token',
      });
    }

    this.tenantContext.setTenantId(payload.tenantId);
    this.tenantContext.setPersonId(payload.sub);
    this.tenantContext.setIsPortalRequest(true);

    return {
      personId: payload.sub,
      tenantId: payload.tenantId,
      type: 'portal',
    };
  }
}
