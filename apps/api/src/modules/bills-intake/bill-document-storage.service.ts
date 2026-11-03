import { Injectable } from '@nestjs/common';
import { S3Service } from '../../common/media/s3.service';

/** Almacenamiento de los PDF de boletas: el mismo almacenamiento de objetos que usan los adjuntos. */
@Injectable()
export class BillDocumentStorage {
  constructor(private readonly s3: S3Service) {}

  /** Clave determinista por inmobiliaria y contenido: subir dos veces el mismo PDF escribe lo mismo. */
  keyFor(tenantId: string, sha256: string): string {
    return `bill-documents/${tenantId}/${sha256}.pdf`;
  }

  async put(key: string, content: Buffer): Promise<void> {
    await this.s3.upload(key, content, 'application/pdf');
  }

  /** Enlace temporal de lectura. */
  async urlFor(key: string): Promise<string> {
    return this.s3.getPresignedUrl(key, 600);
  }
}
