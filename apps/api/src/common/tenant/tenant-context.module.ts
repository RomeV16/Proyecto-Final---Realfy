import { Global, Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { ClsModule, ClsMiddleware } from 'nestjs-cls';
import { TenantContextService } from './tenant-context.service';
import { TenantContextMiddleware } from './tenant-context.middleware';
import { CorrelationIdMiddleware } from '../middleware/correlation-id.middleware';
import { RequestContextService } from '../logger/request-context.service';

@Global()
@Module({
  imports: [
    ClsModule.forRoot({
      global: true,
      middleware: {
        mount: false,
        generateId: true,
      },
    }),
  ],
  providers: [TenantContextService, RequestContextService],
  exports: [TenantContextService, RequestContextService],
})
export class TenantContextModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // El CLS va primero (el identificador de correlación se guarda ahí) y el
    // contexto del tenant al final. Con mount: false y apply explícito el
    // orden queda garantizado.
    consumer
      .apply(ClsMiddleware, CorrelationIdMiddleware, TenantContextMiddleware)
      .forRoutes('*');
  }
}
