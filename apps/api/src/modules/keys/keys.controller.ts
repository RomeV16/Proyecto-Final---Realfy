import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { UserRole } from '@realfy/shared';
import { AuditOperation } from '../../common/audit/audit-operation.decorator';
import { SALES_ROLES } from '../../common/auth/role-groups';
import { Roles } from '../../common/auth/roles.decorator';
import { KeysService } from './keys.service';

/** Todo el personal que atiende propiedades puede ver quién tiene las llaves; las cargan Ventas y la administración. */
const KEYS_READ_ROLES: readonly UserRole[] = [...SALES_ROLES, UserRole.Soporte, UserRole.Lectura];

/** Llaves por propiedad. */
@Controller('properties/:propertyId/keys')
export class PropertyKeysController {
  constructor(private readonly keys: KeysService) {}

  /** GET /properties/:propertyId/keys — juegos con quién los tiene y las últimas salidas. */
  @Roles(...KEYS_READ_ROLES)
  @Get()
  async list(@Param('propertyId') propertyId: string) {
    return this.keys.listByProperty(propertyId);
  }

  /** POST /properties/:propertyId/keys — alta de un juego de llaves. */
  @Roles(...SALES_ROLES)
  @Post()
  @AuditOperation('key-set-create')
  async create(@Param('propertyId') propertyId: string, @Body() body: unknown) {
    return this.keys.create(propertyId, body);
  }
}

/** Juegos de llaves por id y "llaves fuera". */
@Controller('keys')
export class KeysController {
  constructor(private readonly keys: KeysService) {}

  /** GET /keys/out?holder=&propertyId=&overdue=true&page=&limit= — salidas abiertas ("llaves fuera"). */
  @Roles(...KEYS_READ_ROLES)
  @Get('out')
  async out(@Query() query: Record<string, unknown>) {
    return this.keys.listOut(query);
  }

  /** GET /keys/:id */
  @Roles(...KEYS_READ_ROLES)
  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.keys.findOne(id);
  }

  /** PATCH /keys/:id — nombre, copias, lugar donde se guardan, notas o baja. */
  @Roles(...SALES_ROLES)
  @Patch(':id')
  async update(@Param('id') id: string, @Body() body: unknown) {
    return this.keys.update(id, body);
  }

  /** POST /keys/:id/check-out — salida de un juego. */
  @Roles(...SALES_ROLES)
  @Post(':id/check-out')
  @AuditOperation('key-check-out')
  @HttpCode(200)
  async checkOut(@Param('id') id: string, @Body() body: unknown) {
    return this.keys.checkOut(id, body);
  }

  /** POST /keys/:id/check-in — devolución: el juego vuelve a la oficina. */
  @Roles(...SALES_ROLES)
  @Post(':id/check-in')
  @AuditOperation('key-check-in')
  @HttpCode(200)
  async checkIn(@Param('id') id: string, @Body() body: unknown) {
    return this.keys.checkIn(id, body);
  }
}
