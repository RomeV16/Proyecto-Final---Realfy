import { Module } from '@nestjs/common';
import { ServicesModule } from '../services/services.module';
import { TenantsModule } from '../tenants/tenants.module';
import { BillDocumentStorage } from './bill-document-storage.service';
import { BillDocumentsService } from './bill-documents.service';
import { BillIntakeService } from './bill-intake.service';
import { BillMailService } from './bill-mail.service';
import { BillsIntakeController } from './bills-intake.controller';
import { BillsIntakeMailController } from './bills-intake-mail.controller';
import { PdfTextService } from './pdf-text.service';

/** Obtención automática de boletas de servicios e impuestos (ADR-0018). */
@Module({
  imports: [ServicesModule, TenantsModule],
  controllers: [BillsIntakeController, BillsIntakeMailController],
  providers: [
    PdfTextService,
    BillDocumentStorage,
    BillIntakeService,
    BillDocumentsService,
    BillMailService,
  ],
  exports: [BillIntakeService],
})
export class BillsIntakeModule {}
