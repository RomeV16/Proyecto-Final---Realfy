import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
} from '@nestjs/common';
import { InteractionsService } from './interactions.service';
import { Roles } from '../../common/auth/roles.decorator';
import { UserRole } from '@realfy/shared';

@Controller('leads')
export class InteractionsController {
  constructor(private readonly interactionsService: InteractionsService) {}

  /**
   * POST /leads/:leadId/interactions — Log a new interaction (call, email, WhatsApp, visit, note).
   * Admin/Gerente/Ventas can create.
   */
  @Roles(UserRole.Admin, UserRole.Gerente, UserRole.Ventas)
  @Post(':leadId/interactions')
  async createInteraction(
    @Param('leadId') leadId: string,
    @Body() body: Record<string, any>,
  ) {
    return this.interactionsService.createInteraction(leadId, body);
  }

  /**
   * GET /leads/:leadId/interactions — List interactions for a lead (chronological).
   * Any authenticated user can read.
   */
  @Get(':leadId/interactions')
  async findInteractions(
    @Param('leadId') leadId: string,
    @Query() query: Record<string, any>,
  ) {
    return this.interactionsService.findInteractions(leadId, query);
  }

  /**
   * POST /leads/:leadId/visits — Schedule a new visit.
   * Admin/Gerente/Ventas can create.
   */
  @Roles(UserRole.Admin, UserRole.Gerente, UserRole.Ventas)
  @Post(':leadId/visits')
  async createVisit(
    @Param('leadId') leadId: string,
    @Body() body: Record<string, any>,
  ) {
    return this.interactionsService.createVisit(leadId, body);
  }

  /**
   * GET /leads/:leadId/visits — List visits for a lead.
   * Any authenticated user can read.
   */
  @Get(':leadId/visits')
  async findVisits(
    @Param('leadId') leadId: string,
    @Query() query: Record<string, any>,
  ) {
    return this.interactionsService.findVisits(leadId, query);
  }

  /**
   * PATCH /leads/:leadId/visits/:visitId — Update visit status/outcome.
   * Admin/Gerente/Ventas can update.
   */
  @Roles(UserRole.Admin, UserRole.Gerente, UserRole.Ventas)
  @Patch(':leadId/visits/:visitId')
  async updateVisit(
    @Param('leadId') leadId: string,
    @Param('visitId') visitId: string,
    @Body() body: Record<string, any>,
  ) {
    return this.interactionsService.updateVisit(leadId, visitId, body);
  }
}
