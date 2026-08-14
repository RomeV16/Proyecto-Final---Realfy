import { Global, Module } from '@nestjs/common';
import { CommonEmailService } from './common-email.service';

@Global()
@Module({
  providers: [CommonEmailService],
  exports: [CommonEmailService],
})
export class CommonEmailModule {}
