import { Global, Module } from '@nestjs/common';
import { S3Service } from './s3.service';
import { MediaService } from './media.service';

@Global()
@Module({
  providers: [S3Service, MediaService],
  exports: [S3Service, MediaService],
})
export class MediaModule {}
