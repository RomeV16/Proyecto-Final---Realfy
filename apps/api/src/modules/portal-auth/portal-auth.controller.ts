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
import { PortalAuthService } from './portal-auth.service';
import { Public } from '../../common/auth/public.decorator';
import { PortalAuthGuard } from '../../common/auth/portal-auth.guard';

class PortalLoginDto {
  email!: string;
  password!: string;
}

class PortalRefreshDto {
  refreshToken!: string;
}

class PortalSetPasswordDto {
  token!: string;
  password!: string;
}

@Controller('portal/auth')
export class PortalAuthController {
  constructor(private readonly portalAuthService: PortalAuthService) {}

  @Public()
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
