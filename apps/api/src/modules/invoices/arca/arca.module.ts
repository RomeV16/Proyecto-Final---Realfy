import { Module } from '@nestjs/common';
import { CryptoModule } from '../../../common/crypto/crypto.module';
import { WsaaService } from './wsaa/wsaa.service';
import { Wsfev1Client } from './wsfev1-client';
import { ArcaClientFactory } from './arca-client.factory';
import { ArcaTaManager } from './arca-ta.manager';
import { ArcaParamCacheService } from './arca-param-cache.service';
import { ArcaRequestLogService } from './arca-request-log.service';
import { PadronA5Service } from './padron-a5.service';
import { ArcaService } from './arca.service';

@Module({
  imports: [CryptoModule],
  providers: [
    WsaaService,
    Wsfev1Client,
    ArcaClientFactory,
    ArcaTaManager,
    ArcaParamCacheService,
    ArcaRequestLogService,
    PadronA5Service,
    ArcaService,
  ],
  exports: [
    WsaaService,
    Wsfev1Client,
    ArcaClientFactory,
    ArcaTaManager,
    ArcaParamCacheService,
    ArcaRequestLogService,
    PadronA5Service,
    ArcaService,
  ],
})
export class ArcaModule {}
