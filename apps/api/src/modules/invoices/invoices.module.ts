import { Module } from '@nestjs/common';
import { InvoicesController } from './invoices.controller';
import { InvoicesService } from './invoices.service';
import { IssuersService } from './issuers.service';
import { CertificateService } from './certificate.service';
import { FiscalPdfService } from './fiscal-pdf.service';
import { FiscalScheduler } from './fiscal.scheduler';
import { LessorInvoicingController } from './lessor-invoicing.controller';
import { LessorInvoicingScheduler } from './lessor-invoicing.scheduler';
import { LessorInvoicingService } from './lessor-invoicing.service';
import { TenantsModule } from '../tenants/tenants.module';
import { ArcaModule } from './arca/arca.module';
import { CryptoModule } from '../../common/crypto/crypto.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [ArcaModule, CryptoModule, NotificationsModule, TenantsModule],
  controllers: [LessorInvoicingController, InvoicesController],
  providers: [
    InvoicesService,
    IssuersService,
    CertificateService,
    FiscalPdfService,
    FiscalScheduler,
    LessorInvoicingService,
    LessorInvoicingScheduler,
  ],
  exports: [LessorInvoicingService, InvoicesService, FiscalPdfService, IssuersService, CertificateService],
})
export class InvoicesModule {}
