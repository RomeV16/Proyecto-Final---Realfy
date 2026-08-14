import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { Public } from '../../common/auth/public.decorator';
import { Throttle } from '@nestjs/throttler';
import { IsEmail, IsString, MinLength } from 'class-validator';

class RegisterDto {
  @IsEmail()
  email!: string;
  @IsString()
  @MinLength(8)
  password!: string;
  @IsString()
  firstName!: string;
  @IsString()
  lastName!: string;
}

class LoginDto {
  @IsEmail()
  email!: string;
  @IsString()
  password!: string;
}

// Cookie domain: use parent domain so api.realfy.app cookies work on app.realfy.app
const COOKIE_DOMAIN = process.env.COOKIE_DOMAIN || undefined; // e.g., '.realfy.app'

const COOKIE_OPTS_ACCESS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
  maxAge: 15 * 60 * 1000, // 15 minutes
  domain: COOKIE_DOMAIN,
};

const COOKIE_OPTS_REFRESH = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  domain: COOKIE_DOMAIN,
};

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Throttle({ default: { ttl: 60000, limit: 30 } })
  @Post('register')
  async register(
    @Body() dto: RegisterDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.register(
      dto.email,
      dto.password,
      dto.firstName,
      dto.lastName,
    );
    // Set httpOnly cookies
    res.cookie('access_token', result.tokens.accessToken, COOKIE_OPTS_ACCESS);
    res.cookie('refresh_token', result.tokens.refreshToken, COOKIE_OPTS_REFRESH);
    return result;
  }

  @Public()
  @Throttle({ default: { ttl: 60000, limit: 30 } })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.login(dto.email, dto.password);
    res.cookie('access_token', result.tokens.accessToken, COOKIE_OPTS_ACCESS);
    res.cookie('refresh_token', result.tokens.refreshToken, COOKIE_OPTS_REFRESH);
    return result;
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    // Read refresh token from cookie OR body (backward compat)
    const refreshToken =
      (req.cookies as Record<string, string>)?.refresh_token ||
      req.body?.refreshToken;

    if (!refreshToken) {
      res.status(401).json({ error: 'UNAUTHORIZED', message: 'No refresh token' });
      return;
    }

    const result = await this.authService.refreshToken(refreshToken);
    res.cookie('access_token', result.accessToken, COOKIE_OPTS_ACCESS);
    res.cookie('refresh_token', result.refreshToken, COOKIE_OPTS_REFRESH);
    return { tokens: result };
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const user = req.user as { userId: string };
    await this.authService.logout(user.userId);
    // Clear cookies
    res.clearCookie('access_token', { path: '/' });
    res.clearCookie('refresh_token', { path: '/' });
    return { message: 'Logged out successfully' };
  }
}
