import { Injectable, Logger } from '@nestjs/common';
import { WsaaService } from './wsaa/wsaa.service';

/**
 * ArcaTaManager — thin wrapper over WsaaService that provides the same
 * `ensureTA(tenantId, issuerId, actor)` interface used by ArcaService.
 *
 * Previously this called AfipSDK to trigger TA acquisition. Now it delegates
 * to WsaaService which owns single-flight + caching.
 *
 * The `issuerId` parameter is accepted but not used for TA acquisition:
 * WSAA is signed with the agency cert (not the issuer cert), so all issuers
 * under a tenant share the same TA per service.
 */
@Injectable()
export class ArcaTaManager {
  private readonly logger = new Logger(ArcaTaManager.name);

  constructor(private readonly wsaa: WsaaService) {}

  /**
   * Ensure the TA for a given tenant is acquired and cached.
   * Returns immediately if TA is already valid.
   *
   * @param tenantId  Agency tenant
   * @param issuerId  Ignored (kept for backward compatibility with ArcaService)
   * @param actor     Log context string
   */
  async ensureTA(tenantId: string, issuerId: string, actor: string): Promise<void> {
    this.logger.debug('ensureTA called', { tenantId, issuerId, actor });
    // WsaaService handles single-flight + caching internally
    await this.wsaa.getTa(tenantId, 'wsfe');
    this.logger.debug('TA ensured', { tenantId, actor });
  }
}
