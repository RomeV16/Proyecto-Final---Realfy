import { Controller, Get, Post, Param, Body, Query, Req, UseGuards, HttpCode } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { PublicService } from './public.service';
import { PublicTenantGuard } from './public-tenant.guard';
import { Public } from '../../common/auth/public.decorator';

/**
 * Public portal for a single inmobiliaria, addressed by its slug.
 * Every route hangs off @Public() to skip the global JwtAuthGuard and is
 * resolved through PublicTenantGuard, which loads the tenant and attaches
 * it to the request as `publicTenant`.
 */
@Public()
@UseGuards(PublicTenantGuard)
@Controller('public')
export class PublicController {
  constructor(private readonly publicService: PublicService) {}

  /**
   * GET /public/:slug — Inmobiliaria profile.
   */
  @Get(':slug')
  async getProfile(@Req() req: Request) {
    const tenant = (req as any).publicTenant;
    return {
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      province: tenant.province,
      logoUrl: tenant.logoUrl,
      brandPrimary: tenant.brandPrimary,
      brandSecondary: tenant.brandSecondary,
    };
  }

  /**
   * GET /public/:slug/properties — Paginated listing of available properties.
   */
  @Get(':slug/properties')
  async listProperties(@Req() req: Request, @Query() query: Record<string, any>) {
    const tenant = (req as any).publicTenant;
    const coerced = { ...query };
    if (coerced.page !== undefined) coerced.page = Number(coerced.page);
    if (coerced.limit !== undefined) coerced.limit = Number(coerced.limit);
    return this.publicService.findProperties(tenant.id, coerced);
  }

  /**
   * GET /public/:slug/properties/:id — Property detail with media.
   */
  @Get(':slug/properties/:id')
  async getProperty(@Req() req: Request, @Param('id') id: string) {
    const tenant = (req as any).publicTenant;
    return this.publicService.findProperty(tenant.id, id);
  }

  /**
   * POST /public/:slug/inquiries — Create a web lead. Throttled per IP.
   */
  @Post(':slug/inquiries')
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @HttpCode(201)
  async createInquiry(@Req() req: Request, @Body() body: Record<string, any>) {
    const tenant = (req as any).publicTenant;
    return this.publicService.createInquiry(tenant.id, body);
  }
}
