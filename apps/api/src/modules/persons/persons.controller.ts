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
import { PersonsService } from './persons.service';
import { Roles } from '../../common/auth/roles.decorator';
import { UserRole } from '@realfy/shared';

@Controller('persons')
export class PersonsController {
  constructor(private readonly personsService: PersonsService) {}

  /**
   * GET /persons — List with filters + pagination.
   * Any authenticated user can read.
   */
  @Get()
  async findAll(@Query() query: Record<string, any>) {
    const coerced = { ...query };
    const numericFields = ['page', 'limit'];
    for (const field of numericFields) {
      if (coerced[field] !== undefined) {
        coerced[field] = Number(coerced[field]);
      }
    }
    if (coerced.isActive !== undefined) {
      coerced.isActive = coerced.isActive === 'true';
    }
    return this.personsService.findAll(coerced);
  }

  /**
   * GET /persons/:id — Full detail with roles + documents.
   * Any authenticated user can read.
   */
  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.personsService.findOne(id);
  }

  /**
   * POST /persons — Create a person.
   * Admin, Gerente, Ventas roles.
   */
  @Roles(UserRole.Admin, UserRole.Gerente, UserRole.Ventas)
  @Post()
  async create(@Body() body: Record<string, any>) {
    return this.personsService.create(body);
  }

  /**
   * PATCH /persons/:id — Update a person.
   * Admin, Gerente, Ventas roles.
   */
  @Roles(UserRole.Admin, UserRole.Gerente, UserRole.Ventas)
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() body: Record<string, any>,
  ) {
    return this.personsService.update(id, body);
  }

  /**
   * DELETE /persons/:id — Soft delete.
   * Admin and Gerente only.
   */
  @Roles(UserRole.Admin, UserRole.Gerente)
  @Delete(':id')
  async remove(@Param('id') id: string) {
    return this.personsService.softDelete(id);
  }

  // ─── Roles ──────────────────────────────────────────

  /**
   * POST /persons/:id/roles — Assign a role.
   * Admin, Gerente, Ventas roles.
   */
  @Roles(UserRole.Admin, UserRole.Gerente, UserRole.Ventas)
  @Post(':id/roles')
  async assignRole(
    @Param('id') id: string,
    @Body() body: Record<string, any>,
  ) {
    return this.personsService.assignRole(id, body);
  }

  /**
   * DELETE /persons/:id/roles/:roleId — Remove a role.
   * Admin, Gerente, Ventas roles.
   */
  @Roles(UserRole.Admin, UserRole.Gerente, UserRole.Ventas)
  @Delete(':id/roles/:roleId')
  async removeRole(
    @Param('id') id: string,
    @Param('roleId') roleId: string,
  ) {
    return this.personsService.removeRole(id, roleId);
  }

  // ─── Documents ──────────────────────────────────────

  /**
   * POST /persons/:id/documents — Upload a document (image or PDF).
   * Multer memory storage, 10MB limit, image/* and application/pdf filter.
   * Admin, Gerente, Ventas roles.
   */
  @Roles(UserRole.Admin, UserRole.Gerente, UserRole.Ventas)
  @Post(':id/documents')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
      fileFilter: (_req: any, file: any, cb: any) => {
        if (
          !file.mimetype.startsWith('image/') &&
          file.mimetype !== 'application/pdf'
        ) {
          cb(
            new BadRequestException(
              'Only image and PDF files are allowed',
            ),
            false,
          );
        } else {
          cb(null, true);
        }
      },
    }),
  )
  async uploadDocument(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException({
        error: 'FILE_REQUIRED',
        message: 'A file is required',
      });
    }
    return this.personsService.uploadDocument(id, file);
  }

  /**
   * DELETE /persons/:id/documents/:docId — Remove a document.
   * Admin, Gerente, Ventas roles.
   */
  @Roles(UserRole.Admin, UserRole.Gerente, UserRole.Ventas)
  @Delete(':id/documents/:docId')
  async deleteDocument(
    @Param('id') id: string,
    @Param('docId') docId: string,
  ) {
    return this.personsService.deleteDocument(id, docId);
  }

  // ─── Invitaciones al portal ─────────────────────────

  /**
   * POST /persons/:id/portal-invite — Genera el token con el que el inquilino
   * crea su contraseña y activa el acceso al portal. Admin y Gerente.
   */
  @Roles(UserRole.Admin, UserRole.Gerente)
  @Post(':id/portal-invite')
  async createPortalInvitation(@Param('id') id: string) {
    return this.personsService.createPortalInvitation(id);
  }
}
