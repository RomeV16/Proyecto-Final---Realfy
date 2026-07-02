import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
} from '@nestjs/common';
import { ContractsService } from './contracts.service';
import { Roles } from '../../common/auth/roles.decorator';
import { UserRole } from '@realfy/shared';

@Controller('contracts')
export class ContractsController {
  constructor(
    private readonly contractsService: ContractsService,
  ) {}

  /**
   * GET /contracts — List with filters + pagination.
   * Any authenticated user can read.
   */
  @Get()
  async findAll(@Query() query: Record<string, any>) {
    const coerced = { ...query };
    const numericFields = ['page', 'limit', 'guaranteeExpiringWithinDays'];
    for (const field of numericFields) {
      if (coerced[field] !== undefined) {
        coerced[field] = Number(coerced[field]);
      }
    }
    return this.contractsService.findAll(coerced);
  }

  /**
   * GET /contracts/:id — Full detail with persons and guarantees.
   * Any authenticated user can read.
   */
  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.contractsService.findOne(id);
  }

  /**
   * POST /contracts — Create a contract with linked persons and guarantees.
   * Ventas+ roles (Admin, Gerente, Ventas).
   */
  @Roles(UserRole.Admin, UserRole.Gerente, UserRole.Ventas)
  @Post()
  async create(@Body() body: Record<string, any>) {
    return this.contractsService.create(body);
  }

  /**
   * PATCH /contracts/:id — Update contract fields.
   * Ventas+ roles (Admin, Gerente, Ventas).
   */
  @Roles(UserRole.Admin, UserRole.Gerente, UserRole.Ventas)
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() body: Record<string, any>,
  ) {
    return this.contractsService.update(id, body);
  }

  /**
   * POST /contracts/:id/terminate — Terminate contract (set Rescindido, isActive false).
   * Admin and Gerente only.
   */
  @Roles(UserRole.Admin, UserRole.Gerente)
  @Post(':id/terminate')
  async terminate(@Param('id') id: string) {
    return this.contractsService.terminate(id);
  }
}
