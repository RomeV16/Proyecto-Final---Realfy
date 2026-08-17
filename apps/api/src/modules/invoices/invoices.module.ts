import { Module } from '@nestjs/common';
import { InvoicesController } from './invoices.controller';
import { InvoicesService } from './invoices.service';
import { IssuersService } from './issuers.service';
import { CertificateService } from './certificate.service';
import { FiscalPdfService } from './fiscal-pdf.service';
import { FiscalScheduler } from './fiscal.scheduler';
import { ArcaModule } from './arca/arca.module';
import { CryptoModule } from '../../common/crypto/crypto.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [ArcaModule, CryptoModule, NotificationsModule],
  controllers: [InvoicesController],
  providers: [InvoicesService, IssuersService, CertificateService, FiscalPdfService, FiscalScheduler],
  exports: [InvoicesService, FiscalPdfService, IssuersService, CertificateService],
})
export class InvoicesModule {}
