import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  HttpCode,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { TicketsService } from './tickets.service';
import { Roles } from '../../common/auth/roles.decorator';
import { UserRole } from '@realfy/shared';

@Controller('tickets')
export class TicketsController {
  constructor(private readonly ticketsService: TicketsService) {}

  /**
   * POST /tickets — Create a ticket.
   * Admin, Gerente, Soporte can create.
   */
  @Roles(UserRole.Admin, UserRole.Gerente, UserRole.Soporte)
  @Post()
  async create(@Body() body: Record<string, any>) {
    return this.ticketsService.create(body);
  }

  /**
   * GET /tickets — List with filters + pagination.
   * Any authenticated user can read (Lectura included via ticket:read).
   */
  @Get()
  async findAll(@Query() query: Record<string, any>) {
    // Coerce numeric query params from strings
    const coerced = { ...query };
    if (coerced.page !== undefined) coerced.page = Number(coerced.page);
    if (coerced.limit !== undefined) coerced.limit = Number(coerced.limit);
    return this.ticketsService.findAll(coerced);
  }

  /**
   * GET /tickets/:id — Full detail with comments, attachments, valid transitions.
   */
  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.ticketsService.findOne(id);
  }

  /**
   * PATCH /tickets/:id — Update ticket fields.
   * Admin, Gerente, Soporte.
   */
  @Roles(UserRole.Admin, UserRole.Gerente, UserRole.Soporte)
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() body: Record<string, any>,
  ) {
    return this.ticketsService.update(id, body);
  }

  /**
   * POST /tickets/:id/transition — Validate and apply state transition.
   * Admin, Gerente, Soporte.
   */
  @Roles(UserRole.Admin, UserRole.Gerente, UserRole.Soporte)
  @Post(':id/transition')
  @HttpCode(200)
  async transition(
    @Param('id') id: string,
    @Body() body: Record<string, any>,
  ) {
    return this.ticketsService.transition(id, body);
  }

  /**
   * POST /tickets/:id/assign-provider — Assign a provider to a ticket.
   * Admin, Gerente, Soporte.
   */
  @Roles(UserRole.Admin, UserRole.Gerente, UserRole.Soporte)
  @Post(':id/assign-provider')
  @HttpCode(200)
  async assignProvider(
    @Param('id') id: string,
    @Body() body: Record<string, any>,
  ) {
    return this.ticketsService.assignProvider(id, body);
  }

  /**
   * PATCH /tickets/:id/cost — Update cost tracking fields.
   * Admin, Gerente, Soporte.
   */
  @Roles(UserRole.Admin, UserRole.Gerente, UserRole.Soporte)
  @Patch(':id/cost')
  async updateCost(
    @Param('id') id: string,
    @Body() body: Record<string, any>,
  ) {
    return this.ticketsService.updateCost(id, body);
  }

  /**
   * POST /tickets/:id/comments — Add comment with optional photo.
   * Admin, Gerente, Soporte.
   */
  @Roles(UserRole.Admin, UserRole.Gerente, UserRole.Soporte)
  @Post(':id/comments')
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
    return this.ticketsService.addComment(id, body, file);
  }

  /**
   * GET /tickets/:id/comments — List comments with attachments.
   */
  @Get(':id/comments')
  async listComments(@Param('id') id: string) {
    return this.ticketsService.listComments(id);
  }
}
