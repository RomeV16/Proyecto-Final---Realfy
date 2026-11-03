import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ListingsService } from './listings.service';
import { Roles } from '../../common/auth/roles.decorator';
import { MANAGEMENT_ROLES, SALES_MARKETING_ROLES } from '../../common/auth/role-groups';

/**
 * Publicación: estado de cada propiedad en cada portal, aviso para copiar y resumen.
 * Las lecturas las hace cualquier usuario del personal; cambiar un aviso, el equipo
 * comercial y marketing; configurar los portales, la administración.
 */
@Controller()
export class ListingsController {
  constructor(private readonly listings: ListingsService) {}

  /** GET /listings/overview — Qué falta publicar, qué vence y qué hay que bajar. */
  @Get('listings/overview')
  async overview() {
    return this.listings.overview();
  }

  /** POST /listings/pause-unavailable — Pausa los avisos de operaciones que ya no están disponibles. */
  @Roles(...SALES_MARKETING_ROLES)
  @Post('listings/pause-unavailable')
  async pauseUnavailable() {
    return this.listings.pauseUnavailable();
  }

  /** GET /listings/portals — Portales configurados y opciones de publicación. */
  @Get('listings/portals')
  async getPortals() {
    return this.listings.getPortals();
  }

  /** PUT /listings/portals — Reemplaza los portales y las opciones de publicación (Admin y Gerente). */
  @Roles(...MANAGEMENT_ROLES)
  @Put('listings/portals')
  async updatePortals(@Body() body: unknown) {
    return this.listings.updatePortals(body);
  }

  /** GET /properties/:id/listings — Estado de la propiedad en cada portal. */
  @Get('properties/:id/listings')
  async findForProperty(@Param('id', ParseUUIDPipe) id: string) {
    return this.listings.findForProperty(id);
  }

  /** PUT /properties/:id/listings — Guarda el estado de una o más operaciones en uno o más portales. */
  @Roles(...SALES_MARKETING_ROLES)
  @Put('properties/:id/listings')
  async upsertForProperty(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.listings.upsertForProperty(id, body);
  }

  /** GET /properties/:id/ad-copy?portal=&operation= — Título, descripción y fotos para publicar en un portal. */
  @Get('properties/:id/ad-copy')
  async adCopy(@Param('id', ParseUUIDPipe) id: string, @Query() query: Record<string, unknown>) {
    return this.listings.adCopy(id, query);
  }
}
