import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { PropertiesService } from './properties.service';
import { Roles } from '../../common/auth/roles.decorator';
import { UserRole } from '@realfy/shared';

@Controller('properties')
export class PropertiesController {
  constructor(private readonly propertiesService: PropertiesService) {}

  /**
   * GET /properties — List with filters + pagination.
   * Any authenticated user can read.
   */
  @Get()
  async findAll(@Query() query: Record<string, any>) {
    // Coerce numeric query params from strings
    const coerced = { ...query };
    const numericFields = [
      'minPrice', 'maxPrice', 'minArea', 'maxArea',
      'minRooms', 'bedrooms', 'page', 'limit',
    ];
    for (const field of numericFields) {
      if (coerced[field] !== undefined) {
        coerced[field] = Number(coerced[field]);
      }
    }
    if (coerced.isActive !== undefined) {
      coerced.isActive = coerced.isActive === 'true';
    }
    return this.propertiesService.findAll(coerced);
  }

  /**
   * GET /properties/:id — Full detail.
   * Any authenticated user can read.
   */
  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.propertiesService.findOne(id);
  }

  /**
   * POST /properties — Create a property.
   * Ventas+ roles.
   */
  @Roles(UserRole.Admin, UserRole.Gerente, UserRole.Ventas)
  @Post()
  async create(@Body() body: Record<string, any>) {
    return this.propertiesService.create(body);
  }

  /**
   * PATCH /properties/:id — Update a property.
   * Ventas+ roles.
   */
  @Roles(UserRole.Admin, UserRole.Gerente, UserRole.Ventas)
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() body: Record<string, any>,
  ) {
    return this.propertiesService.update(id, body);
  }

  /**
   * DELETE /properties/:id — Soft delete.
   * Admin and Gerente only.
   */
  @Roles(UserRole.Admin, UserRole.Gerente)
  @Delete(':id')
  async remove(@Param('id') id: string) {
    return this.propertiesService.softDelete(id);
  }

  // ─── Operations ─────────────────────────────────────

  /**
   * POST /properties/:id/operations — Add a new operation.
   * Ventas+ roles.
   */
  @Roles(UserRole.Admin, UserRole.Gerente, UserRole.Ventas)
  @Post(':id/operations')
  async addOperation(
    @Param('id') id: string,
    @Body() body: Record<string, any>,
  ) {
    return this.propertiesService.addOperation(id, body);
  }

  /**
   * PATCH /properties/:id/operations/:opId/state — Transition state.
   * Ventas+ roles.
   */
  @Roles(UserRole.Admin, UserRole.Gerente, UserRole.Ventas)
  @Patch(':id/operations/:opId/state')
  async transitionState(
    @Param('id') id: string,
    @Param('opId') opId: string,
    @Body() body: Record<string, any>,
  ) {
    return this.propertiesService.transitionState(id, opId, body);
  }

  // ─── Media ──────────────────────────────────────────

  /**
   * POST /properties/:id/media — Upload an image.
   * Multer memory storage, 10MB limit, image/* filter.
   * Ventas+ roles.
   */
  @Roles(UserRole.Admin, UserRole.Gerente, UserRole.Ventas)
  @Post(':id/media')
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
  async uploadMedia(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException({
        error: 'FILE_REQUIRED',
        message: 'An image file is required',
      });
    }
    return this.propertiesService.uploadMedia(id, file);
  }

  /**
   * DELETE /properties/:id/media/:mediaId — Remove an image.
   * Ventas+ roles.
   */
  @Roles(UserRole.Admin, UserRole.Gerente, UserRole.Ventas)
  @Delete(':id/media/:mediaId')
  async deleteMedia(
    @Param('id') id: string,
    @Param('mediaId') mediaId: string,
  ) {
    return this.propertiesService.deleteMedia(id, mediaId);
  }

  /**
   * PATCH /properties/:id/media/reorder — Reorder media.
   * Ventas+ roles.
   */
  @Roles(UserRole.Admin, UserRole.Gerente, UserRole.Ventas)
  @Patch(':id/media/reorder')
  async reorderMedia(
    @Param('id') id: string,
    @Body('mediaIds') mediaIds: string[],
  ) {
    return this.propertiesService.reorderMedia(id, mediaIds);
  }
}
