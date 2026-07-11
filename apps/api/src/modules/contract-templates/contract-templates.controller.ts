import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  Res,
  Header,
} from '@nestjs/common';
import type { Response } from 'express';
import { ContractTemplatesService } from './contract-templates.service';
import { Roles } from '../../common/auth/roles.decorator';
import { UserRole } from '@realfy/shared';

@Controller()
export class ContractTemplatesController {
  constructor(
    private readonly contractTemplatesService: ContractTemplatesService,
  ) {}

  // ─── Template CRUD ────────────────────────────────────

  /**
   * GET /contract-templates — List all contract templates for the tenant.
   */
  @Roles(UserRole.Admin, UserRole.Gerente)
  @Get('contract-templates')
  async findAll(@Query() query: Record<string, any>) {
    return this.contractTemplatesService.findAll(query);
  }

  /**
   * POST /contract-templates/seed-defaults — Seed default Argentine templates for the tenant.
   * Idempotent: returns empty array if defaults already exist.
   */
  @Roles(UserRole.Admin, UserRole.Gerente)
  @Post('contract-templates/seed-defaults')
  async seedDefaults() {
    return this.contractTemplatesService.seedDefaults();
  }

  /**
   * GET /contract-templates/:id — Get a single contract template.
   */
  @Roles(UserRole.Admin, UserRole.Gerente)
  @Get('contract-templates/:id')
  async findOne(@Param('id') id: string) {
    return this.contractTemplatesService.findOne(id);
  }

  /**
   * POST /contract-templates — Create a new contract template.
   */
  @Roles(UserRole.Admin, UserRole.Gerente)
  @Post('contract-templates')
  async create(@Body() body: Record<string, any>) {
    return this.contractTemplatesService.create(body);
  }

  /**
   * PATCH /contract-templates/:id — Update a contract template.
   */
  @Roles(UserRole.Admin, UserRole.Gerente)
  @Patch('contract-templates/:id')
  async update(
    @Param('id') id: string,
    @Body() body: Record<string, any>,
  ) {
    return this.contractTemplatesService.update(id, body);
  }

  /**
   * DELETE /contract-templates/:id — Delete a contract template.
   */
  @Roles(UserRole.Admin, UserRole.Gerente)
  @Delete('contract-templates/:id')
  async remove(@Param('id') id: string) {
    return this.contractTemplatesService.remove(id);
  }

  // ─── Contract-level endpoints ─────────────────────────

  /**
   * GET /contracts/:id/available-templates — List templates matching the contract type.
   */
  @Roles(UserRole.Admin, UserRole.Gerente, UserRole.Ventas)
  @Get('contracts/:id/available-templates')
  async getAvailableTemplates(@Param('id') id: string) {
    return this.contractTemplatesService.getAvailableTemplates(id);
  }

  /**
   * GET /contracts/:id/template-variables — Get resolved variables for a contract.
   */
  @Roles(UserRole.Admin, UserRole.Gerente, UserRole.Ventas)
  @Get('contracts/:id/template-variables')
  async getTemplateVariables(@Param('id') id: string) {
    return this.contractTemplatesService.getTemplateVariables(id);
  }

  /**
   * POST /contracts/:id/generate-document — Generate a PDF or DOCX document from a template.
   * Returns the binary file as a download.
   */
  @Roles(UserRole.Admin, UserRole.Gerente, UserRole.Ventas)
  @Post('contracts/:id/generate-document')
  async generateDocument(
    @Param('id') id: string,
    @Body() body: Record<string, any>,
    @Res() res: Response,
  ) {
    const result = await this.contractTemplatesService.generateDocument(id, body);

    const filename = `${result.templateName.replace(/[^a-zA-Z0-9áéíóúñÁÉÍÓÚÑ _-]/g, '_')}.${result.extension}`;

    res.status(200).set({
      'Content-Type': result.contentType,
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': result.buffer.length,
    });

    res.send(result.buffer);
  }
}
