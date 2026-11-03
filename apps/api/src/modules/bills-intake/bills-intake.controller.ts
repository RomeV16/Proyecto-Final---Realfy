import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { BillChannel } from '@realfy/shared';
import { AuditOperation } from '../../common/audit/audit-operation.decorator';
import { BILLING_READ_ROLES, BILLING_ROLES } from '../../common/auth/role-groups';
import { Roles } from '../../common/auth/roles.decorator';
import { BillDocumentsService } from './bill-documents.service';
import { BillIntakeService } from './bill-intake.service';
import { isPdf } from './pdf-text.service';

const MAX_FILES = 10;
const MAX_FILE_BYTES = 10 * 1024 * 1024;

/**
 * Documentos de boletas (ADR-0018): la subida de PDF y la cola de revisión. Leen
 * Admin, Gerente, Liquidaciones y Lectura; suben, aceptan y rechazan Admin, Gerente y
 * Liquidaciones (como la carga de boletas).
 */
@Controller('bills-intake/documents')
export class BillsIntakeController {
  constructor(
    private readonly intake: BillIntakeService,
    private readonly documents: BillDocumentsService,
  ) {}

  /**
   * POST /bills-intake/documents — Sube uno o varios PDF (multipart, campo `files`, hasta 10
   * de 10 MB). Cada uno entra al circuito: da de alta la boleta si todo cierra o queda en
   * revisión con el motivo. Idempotente por contenido.
   */
  @Roles(...BILLING_ROLES)
  @AuditOperation('bills-intake-upload')
  @Post()
  @HttpCode(200)
  @UseInterceptors(FilesInterceptor('files', MAX_FILES, { limits: { fileSize: MAX_FILE_BYTES } }))
  async upload(@UploadedFiles() files: Express.Multer.File[] | undefined) {
    if (!files || files.length === 0) {
      throw new BadRequestException({ error: 'FILE_REQUIRED', message: 'At least one PDF file is required' });
    }
    const results = [];
    for (const file of files) {
      if (!isPdf(file.buffer)) {
        results.push({ fileName: file.originalname, error: { code: 'NOT_A_PDF', message: 'The file is not a PDF' } });
        continue;
      }
      const { document, duplicate } = await this.intake.intake({
        channel: BillChannel.Archivo,
        origin: file.originalname,
        fileName: file.originalname,
        content: file.buffer,
      });
      results.push({ fileName: file.originalname, duplicate, ...document });
    }
    return { total: results.length, results };
  }

  /** GET /bills-intake/documents?status=&channel=&providerKey=&page=&limit= */
  @Roles(...BILLING_READ_ROLES)
  @Get()
  async list(@Query() query: Record<string, unknown>) {
    return this.documents.list(query);
  }

  /** GET /bills-intake/documents/:id — Lo leído, el motivo y las boletas que dio de alta. */
  @Roles(...BILLING_READ_ROLES)
  @Get(':id')
  async get(@Param('id', ParseUUIDPipe) id: string) {
    return this.documents.get(id);
  }

  /** GET /bills-intake/documents/:id/file — Enlace temporal al PDF original. */
  @Roles(...BILLING_READ_ROLES)
  @Get(':id/file')
  async file(@Param('id', ParseUUIDPipe) id: string) {
    return this.documents.fileUrl(id);
  }

  /** POST /bills-intake/documents/:id/accept — Da de alta lo leído, con correcciones opcionales. */
  @Roles(...BILLING_ROLES)
  @AuditOperation('bills-intake-accept')
  @Post(':id/accept')
  @HttpCode(200)
  async accept(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.documents.accept(id, body);
  }

  /** POST /bills-intake/documents/:id/reject — Descarta el documento con un motivo. */
  @Roles(...BILLING_ROLES)
  @AuditOperation('bills-intake-reject')
  @Post(':id/reject')
  @HttpCode(200)
  async reject(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.documents.reject(id, body);
  }
}
