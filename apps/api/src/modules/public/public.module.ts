import { Module } from '@nestjs/common';
import { InboxModule } from '../inbox/inbox.module';
import { PublicController } from './public.controller';
import { PublicService } from './public.service';
import { PublicTenantGuard } from './public-tenant.guard';

@Module({
  imports: [InboxModule],
  controllers: [PublicController],
  providers: [PublicService, PublicTenantGuard],
})
export class PublicModule {}
