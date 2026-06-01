import {
  Injectable,
  Logger,
  HttpException,
  HttpStatus,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  CreateBucketCommand,
  HeadBucketCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { GetObjectCommand } from '@aws-sdk/client-s3';

@Injectable()
export class S3Service implements OnModuleInit {
  private readonly logger = new Logger(S3Service.name);
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(private readonly config: ConfigService) {
    const endpoint = this.config.get<string>('S3_ENDPOINT');
    const region = this.config.get<string>('S3_REGION', 'us-east-1');
    const accessKeyId = this.config.get<string>('S3_ACCESS_KEY', '');
    const secretAccessKey = this.config.get<string>('S3_SECRET_KEY', '');

    this.bucket = this.config.get<string>('S3_BUCKET', 'realfy-media');

    this.client = new S3Client({
      endpoint,
      region,
      credentials: { accessKeyId, secretAccessKey },
      forcePathStyle: true, // required for MinIO
    });
  }

  async onModuleInit() {
    try {
      await this.ensureBucket();
    } catch (err) {
      // Log but don't crash — bucket creation may fail in test environments
      this.logger.warn(
        `Could not ensure S3 bucket exists: bucket=${this.bucket} error=${(err as Error).message}`,
      );
    }
  }

  /**
   * Create the bucket if it doesn't exist.
   */
  async ensureBucket(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch {
      this.logger.log(`Creating S3 bucket: ${this.bucket}`);
      await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
    }
  }

  /**
   * Upload a buffer to S3.
   */
  async upload(key: string, buffer: Buffer, contentType: string): Promise<void> {
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: buffer,
          ContentType: contentType,
        }),
      );
      this.logger.log(`S3 upload success: bucket=${this.bucket} key=${key}`);
    } catch (err) {
      const message = (err as Error).message;
      this.logger.error(
        `S3 upload failed: bucket=${this.bucket} key=${key} error=${message}`,
      );
      throw new HttpException(
        {
          error: 'S3_UPLOAD_FAILED',
          message: `Failed to upload file to storage`,
          context: { bucket: this.bucket, key },
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Delete an object from S3.
   */
  async delete(key: string): Promise<void> {
    try {
      await this.client.send(
        new DeleteObjectCommand({
          Bucket: this.bucket,
          Key: key,
        }),
      );
      this.logger.log(`S3 delete success: bucket=${this.bucket} key=${key}`);
    } catch (err) {
      const message = (err as Error).message;
      this.logger.error(
        `S3 delete failed: bucket=${this.bucket} key=${key} error=${message}`,
      );
      // Don't throw on delete — orphan cleanup is best-effort
    }
  }

  /**
   * Generate a pre-signed URL for reading an object.
   */
  async getPresignedUrl(key: string, expiresIn = 3600): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn },
    );
  }

  /**
   * Build the public URL for an object.
   * Uses the S3 endpoint + bucket + key path.
   */
  getObjectUrl(key: string): string {
    const endpoint = this.config.get<string>('S3_ENDPOINT', 'http://localhost:9000');
    return `${endpoint}/${this.bucket}/${key}`;
  }
}
