import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { Throttle } from '@nestjs/throttler';
import { IsEmail, IsString, MinLength } from 'class-validator';
import { PortalAuthService } from './portal-auth.service';
import { Public } from '../../common/auth/public.decorator';
import { PortalAuthGuard } from '../../common/auth/portal-auth.guard';

/* El ValidationPipe global corre con whitelist + forbidNonWhitelisted: sin
   decoradores toda propiedad se considera no permitida y el request se
   rechaza con 400 antes de llegar al servicio. */
class PortalLoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(1)
  password!: string;
}

class PortalRefreshDto {
  @IsString()
  @MinLength(1)
  refreshToken!: string;
}

class PortalSetPasswordDto {
  @IsString()
  @MinLength(1)
  token!: string;

  @IsString()
  @MinLength(8)
  password!: string;
}

@Controller('portal/auth')
export class PortalAuthController {
  constructor(private readonly portalAuthService: PortalAuthService) {}

  /* El ingreso del inquilino también valida credenciales, así que va con el mismo
     límite estricto que el del staff. */
  @Public()
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: PortalLoginDto) {
    return this.portalAuthService.login(dto.email, dto.password);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Body() dto: PortalRefreshDto) {
    return this.portalAuthService.refreshToken(dto.refreshToken);
  }

  @Public()
  @Post('set-password')
  @HttpCode(HttpStatus.OK)
  async setPassword(@Body() dto: PortalSetPasswordDto) {
    return this.portalAuthService.setPassword(dto.token, dto.password);
  }

  @Public()
  @UseGuards(PortalAuthGuard)
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@Req() req: Request) {
    const user = req.user as { personId: string };
    await this.portalAuthService.logout(user.personId);
    return { message: 'Logged out successfully' };
  }
}
