import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  Res,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { Public } from '../../common/auth/public.decorator';
import { PortalAuthGuard } from '../../common/auth/portal-auth.guard';
import { PortalService } from './portal.service';
import { PortalTicketsService } from './portal-tickets.service';

@Public()
@Controller('portal')
export class PortalController {
  constructor(
    private readonly portalService: PortalService,
    private readonly portalTicketsService: PortalTicketsService,
  ) {}

  /**
   * GET /portal/contract — Active contracts for the authenticated inquilino.
   */
  @UseGuards(PortalAuthGuard)
  @Get('contract')
  async getContracts() {
    return this.portalService.getContracts();
  }

  /**
   * GET /portal/liquidaciones — Paginated liquidaciones for inquilino's contracts.
   */
  @UseGuards(PortalAuthGuard)
  @Get('liquidaciones')
  async getLiquidaciones(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.portalService.getLiquidaciones({
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  /**
   * GET /portal/liquidaciones/:id/pdf — Download PDF receipt for a liquidacion.
   * Ownership check ensures inquilino can only access their own.
   */
  @UseGuards(PortalAuthGuard)
  @Get('liquidaciones/:id/pdf')
  async getLiquidacionPdf(@Param('id') id: string, @Res() res: Response) {
    const pdfBuffer = await this.portalService.getLiquidacionPdf(id);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="liquidacion-${id}.pdf"`,
      'Content-Length': pdfBuffer.length,
    });
    res.end(pdfBuffer);
  }

  // ─── Portal Tickets ───────────────────────────────────

  /**
   * GET /portal/categories — Active ticket categories for the tenant.
   */
  @UseGuards(PortalAuthGuard)
  @Get('categories')
  async getCategories() {
    return this.portalTicketsService.getCategories();
  }

  /**
   * GET /portal/tickets — List tickets for inquilino's properties.
   */
  @UseGuards(PortalAuthGuard)
  @Get('tickets')
  async getTickets(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.portalTicketsService.getTickets(
      page ? Number(page) : 1,
      limit ? Math.min(Number(limit), 100) : 10,
    );
  }

  /**
   * POST /portal/tickets — Create ticket from portal.
   */
  @UseGuards(PortalAuthGuard)
  @Post('tickets')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
      fileFilter: (_req: any, file: any, cb: any) => {
        if (!file.mimetype.startsWith('image/')) {
          cb(new BadRequestException('Only image files are allowed'), false);
        } else {
          cb(null, true);
        }
      },
    }),
  )
  async createTicket(
    @Body() body: Record<string, any>,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.portalTicketsService.createTicket(body, file);
  }

  /**
   * GET /portal/tickets/:id — Ticket detail with timeline.
   */
  @UseGuards(PortalAuthGuard)
  @Get('tickets/:id')
  async getTicketDetail(@Param('id') id: string) {
    return this.portalTicketsService.getTicketDetail(id);
  }

  /**
   * POST /portal/tickets/:id/comments — Add comment from portal.
   */
  @UseGuards(PortalAuthGuard)
  @Post('tickets/:id/comments')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
      fileFilter: (_req: any, file: any, cb: any) => {
        if (!file.mimetype.startsWith('image/')) {
          cb(new BadRequestException('Only image files are allowed'), false);
        } else {
          cb(null, true);
        }
      },
    }),
  )
  async addComment(
    @Param('id') id: string,
    @Body() body: Record<string, any>,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.portalTicketsService.addComment(id, body, file);
  }
}
