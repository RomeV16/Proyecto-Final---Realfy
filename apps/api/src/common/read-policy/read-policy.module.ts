import { Global, Module } from '@nestjs/common';
import { ReadPolicyService } from './read-policy.service';

@Global()
@Module({
  providers: [ReadPolicyService],
  exports: [ReadPolicyService],
})
export class ReadPolicyModule {}
