import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import sharp from 'sharp';
import { S3Service } from './s3.service';

export interface ProcessedMedia {
  originalKey: string;
  thumbnailKey: string;
  url: string;
  thumbnailUrl: string;
  width: number;
  height: number;
  sizeBytes: number;
}

@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);

  /** Max width for original image */
  private readonly originalMaxWidth = 1920;
  /** Max width for thumbnail */
  private readonly thumbnailWidth = 400;

  constructor(private readonly s3: S3Service) {}

  /**
   * Process a Multer file buffer: resize to original + thumbnail, upload both to S3.
   * Returns S3 keys and URLs for both versions.
   *
   * Buffer-to-buffer processing — no temp files.
   */
  async processAndUpload(
    file: { buffer: Buffer; mimetype: string; originalname: string },
    keyPrefix: string,
  ): Promise<ProcessedMedia> {
    if (!file.buffer || file.buffer.length === 0) {
      throw new BadRequestException({
        error: 'EMPTY_FILE',
        message: 'Uploaded file is empty',
      });
    }

    // Get image metadata
    const metadata = await sharp(file.buffer).metadata();
    if (!metadata.width || !metadata.height) {
      throw new BadRequestException({
        error: 'INVALID_IMAGE',
        message: 'Could not read image dimensions',
      });
    }

    // Resize original to max 1920px wide, JPEG 80%
    const originalBuffer = await sharp(file.buffer)
      .resize({ width: this.originalMaxWidth, withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer();

    // Resize thumbnail to 400px wide, JPEG 70%
    const thumbnailBuffer = await sharp(file.buffer)
      .resize({ width: this.thumbnailWidth, withoutEnlargement: true })
      .jpeg({ quality: 70 })
      .toBuffer();

    // Get processed dimensions
    const originalMeta = await sharp(originalBuffer).metadata();

    const originalKey = `${keyPrefix}/original.jpg`;
    const thumbnailKey = `${keyPrefix}/thumb.jpg`;

    // Upload to S3 — upload both before returning
    // If either upload fails, the S3Service throws with context
    await this.s3.upload(originalKey, originalBuffer, 'image/jpeg');
    await this.s3.upload(thumbnailKey, thumbnailBuffer, 'image/jpeg');

    return {
      originalKey,
      thumbnailKey,
      url: this.s3.getObjectUrl(originalKey),
      thumbnailUrl: this.s3.getObjectUrl(thumbnailKey),
      width: originalMeta.width ?? metadata.width,
      height: originalMeta.height ?? metadata.height,
      sizeBytes: originalBuffer.length,
    };
  }

  /**
   * Delete both original and thumbnail from S3.
   */
  async deleteMedia(keyPrefix: string): Promise<void> {
    await this.s3.delete(`${keyPrefix}/original.jpg`);
    await this.s3.delete(`${keyPrefix}/thumb.jpg`);
  }
}
