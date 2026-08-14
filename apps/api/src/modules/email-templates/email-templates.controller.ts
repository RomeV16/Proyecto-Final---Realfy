import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
} from '@nestjs/common';
import { EmailTemplatesService } from './email-templates.service';
import { Roles } from '../../common/auth/roles.decorator';
import { UserRole } from '@realfy/shared';

@Controller()
export class EmailTemplatesController {
  constructor(
    private readonly emailTemplatesService: EmailTemplatesService,
  ) {}

  /**
   * GET /email-templates — List all email templates for the tenant.
   * Admin/Gerente/Marketing (campaign comms).
   */
  @Roles(UserRole.Admin, UserRole.Gerente, UserRole.Marketing)
  @Get('email-templates')
  async findAll(@Query() query: Record<string, any>) {
    return this.emailTemplatesService.findAll(query);
  }

  /**
   * GET /email-templates/:id — Get a single email template.
   * Admin/Gerente/Marketing (campaign comms).
   */
  @Roles(UserRole.Admin, UserRole.Gerente, UserRole.Marketing)
  @Get('email-templates/:id')
  async findOne(@Param('id') id: string) {
    return this.emailTemplatesService.findOne(id);
  }

  /**
   * POST /email-templates — Create a new email template.
   * Admin/Gerente/Marketing (campaign comms).
   */
  @Roles(UserRole.Admin, UserRole.Gerente, UserRole.Marketing)
  @Post('email-templates')
  async create(@Body() body: Record<string, any>) {
    return this.emailTemplatesService.create(body);
  }

  /**
   * PATCH /email-templates/:id — Update an email template.
   * Admin/Gerente/Marketing (campaign comms).
   */
  @Roles(UserRole.Admin, UserRole.Gerente, UserRole.Marketing)
  @Patch('email-templates/:id')
  async update(
    @Param('id') id: string,
    @Body() body: Record<string, any>,
  ) {
    return this.emailTemplatesService.update(id, body);
  }

  /**
   * DELETE /email-templates/:id — Delete an email template.
   * Admin/Gerente/Marketing (campaign comms).
   */
  @Roles(UserRole.Admin, UserRole.Gerente, UserRole.Marketing)
  @Delete('email-templates/:id')
  async remove(@Param('id') id: string) {
    return this.emailTemplatesService.remove(id);
  }

  /**
   * POST /email-templates/:id/preview — Preview a template with sample data.
   * Admin/Gerente/Ventas can preview.
   */
  @Roles(UserRole.Admin, UserRole.Gerente, UserRole.Ventas, UserRole.Marketing)
  @Post('email-templates/:id/preview')
  async preview(
    @Param('id') id: string,
    @Body() body: Record<string, any>,
  ) {
    return this.emailTemplatesService.preview(id, body);
  }

  /**
   * POST /leads/:leadId/send-email — Send email using a template for a lead.
   * Admin/Gerente/Ventas can send.
   */
  @Roles(UserRole.Admin, UserRole.Gerente, UserRole.Ventas, UserRole.Marketing)
  @Post('leads/:leadId/send-email')
  async sendEmail(
    @Param('leadId') leadId: string,
    @Body() body: Record<string, any>,
  ) {
    return this.emailTemplatesService.sendEmail(leadId, body);
  }
}
