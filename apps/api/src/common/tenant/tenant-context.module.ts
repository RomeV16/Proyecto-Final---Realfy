import { Global, Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { ClsModule, ClsMiddleware } from 'nestjs-cls';
import { TenantContextService } from './tenant-context.service';
import { TenantContextMiddleware } from './tenant-context.middleware';

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
  providers: [TenantContextService],
  exports: [TenantContextService],
})
export class TenantContextModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // Mount CLS middleware first, then tenant context middleware.
    // Using mount: false + explicit apply ensures correct ordering.
    consumer
      .apply(ClsMiddleware, TenantContextMiddleware)
      .forRoutes('*');
  }
}
