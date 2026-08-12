import {
  Injectable,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class PortalAuthGuard extends AuthGuard('portal-jwt') {
  constructor(private reflector: Reflector) {
    super();
  }

  /**
   * Always validate the portal JWT — do NOT skip on @Public().
   * @Public() is used to bypass the global JwtAuthGuard, but this guard
   * must still run to authenticate portal users.
   */
  canActivate(context: ExecutionContext) {
    return super.canActivate(context);
  }

  handleRequest(err: any, user: any, info: any) {
    if (err || !user) {
      throw (
        err ||
        new UnauthorizedException({
          error: 'PORTAL_UNAUTHORIZED',
          message: info?.message || 'Invalid or expired portal token',
        })
      );
    }
    return user;
  }
}
