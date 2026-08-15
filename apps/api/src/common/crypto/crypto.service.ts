import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
// libsodium-wrappers is a CJS module that mutates itself after `.ready` resolves.
// We must require() it so we reference the same mutable object that gains methods
// after initialisation (import * as sodium would freeze the pre-ready snapshot).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const sodium = require('libsodium-wrappers') as typeof import('libsodium-wrappers');
import * as forge from 'node-forge';

export interface EncryptedBlob {
  ciphertext: Buffer;
  dek_wrapped: Buffer;
}

/**
 * CryptoService — envelope encryption for ARCA digital certificates.
 *
 * Algorithm: XSalsa20-Poly1305 (libsodium secretbox).
 * Key hierarchy:
 *   KEK (Key Encryption Key) = ARCA_MASTER_KEY env var, base64-encoded 32 bytes.
 *   DEK (Data Encryption Key) = 32 random bytes per encrypt() call.
 *   dek_wrapped = secretbox(DEK, nonce_kek, KEK)  [nonce_kek prepended]
 *   ciphertext  = secretbox(plain, nonce_dek, DEK) [nonce_dek prepended]
 *
 * Never exposes the DEK outside this service.
 *
 * The KEK is resolved on first use, not on boot. Only tenants that actually
 * upload an ARCA certificate need a master key, so an instance without
 * ARCA_MASTER_KEY must still start: the error belongs to the request that
 * tries to encrypt or decrypt, not to the whole API.
 */
@Injectable()
export class CryptoService {
  private readonly logger = new Logger(CryptoService.name);
  private kek: Uint8Array | null = null;

  constructor(private readonly configService: ConfigService) {}

  /**
   * Encrypt plain bytes with a fresh DEK, then wrap the DEK with the KEK.
   * Returns { ciphertext, dek_wrapped } — both include their nonce prepended.
   */
  async encrypt(plain: Buffer): Promise<EncryptedBlob> {
    await sodium.ready;
    this.assertKek();

    // Generate a fresh DEK
    const dek = sodium.randombytes_buf(sodium.crypto_secretbox_KEYBYTES);

    // Encrypt the plaintext with the DEK
    const nonceDek = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
    const ciphertextRaw = sodium.crypto_secretbox_easy(
      new Uint8Array(plain),
      nonceDek,
      dek,
    );
    const ciphertext = Buffer.concat([
      Buffer.from(nonceDek),
      Buffer.from(ciphertextRaw),
    ]);

    // Wrap the DEK with the KEK
    const nonceKek = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
    const dekWrappedRaw = sodium.crypto_secretbox_easy(dek, nonceKek, this.kek!);
    const dek_wrapped = Buffer.concat([
      Buffer.from(nonceKek),
      Buffer.from(dekWrappedRaw),
    ]);

    return { ciphertext, dek_wrapped };
  }

  /**
   * Decrypt a blob previously produced by encrypt().
   */
  async decrypt(blob: EncryptedBlob): Promise<Buffer> {
    await sodium.ready;
    this.assertKek();

    const NONCE_LEN = sodium.crypto_secretbox_NONCEBYTES;

    // Unwrap the DEK
    const dekWrappedBytes = new Uint8Array(blob.dek_wrapped);
    const nonceKek = dekWrappedBytes.slice(0, NONCE_LEN);
    const dekWrappedCipher = dekWrappedBytes.slice(NONCE_LEN);
    const dek = sodium.crypto_secretbox_open_easy(dekWrappedCipher, nonceKek, this.kek!);
    if (!dek) {
      throw new Error('Failed to unwrap DEK — wrong KEK or corrupted blob');
    }

    // Decrypt the ciphertext with the DEK
    const ciphertextBytes = new Uint8Array(blob.ciphertext);
    const nonceDek = ciphertextBytes.slice(0, NONCE_LEN);
    const cipherBody = ciphertextBytes.slice(NONCE_LEN);
    const plain = sodium.crypto_secretbox_open_easy(cipherBody, nonceDek, dek);
    if (!plain) {
      throw new Error('Failed to decrypt ciphertext — corrupted blob');
    }

    return Buffer.from(plain);
  }

  /**
   * Re-wrap the DEK under a new KEK without re-encrypting the data.
   * Use this during KEK rotation: decrypt DEK with old KEK, re-encrypt with new KEK.
   * The caller must provide newKek as a 32-byte Buffer.
   */
  async rotateKek(newKek: Buffer, blob: EncryptedBlob): Promise<EncryptedBlob> {
    await sodium.ready;
    this.assertKek();

    if (newKek.length < 32) {
      throw new Error('newKek must be at least 32 bytes');
    }

    const NONCE_LEN = sodium.crypto_secretbox_NONCEBYTES;

    // Unwrap DEK with current KEK
    const dekWrappedBytes = new Uint8Array(blob.dek_wrapped);
    const nonceKek = dekWrappedBytes.slice(0, NONCE_LEN);
    const dekWrappedCipher = dekWrappedBytes.slice(NONCE_LEN);
    const dek = sodium.crypto_secretbox_open_easy(dekWrappedCipher, nonceKek, this.kek!);
    if (!dek) {
      throw new Error('Failed to unwrap DEK with current KEK');
    }

    // Re-wrap DEK with new KEK
    const newKekBytes = new Uint8Array(newKek.slice(0, 32));
    const newNonceKek = sodium.randombytes_buf(NONCE_LEN);
    const newDekWrappedRaw = sodium.crypto_secretbox_easy(dek, newNonceKek, newKekBytes);
    const dek_wrapped = Buffer.concat([
      Buffer.from(newNonceKek),
      Buffer.from(newDekWrappedRaw),
    ]);

    return { ciphertext: blob.ciphertext, dek_wrapped };
  }

  /**
   * Parse a PEM certificate and extract commonName, notBefore, notAfter.
   */
  parseCertificate(pem: Buffer): {
    commonName: string;
    notBefore: Date;
    notAfter: Date;
  } {
    const cert = forge.pki.certificateFromPem(pem.toString('utf8'));
    const commonName =
      cert.subject.getField('CN')?.value ?? '';

    return {
      commonName,
      notBefore: cert.validity.notBefore,
      notAfter: cert.validity.notAfter,
    };
  }

  /**
   * Load and validate ARCA_MASTER_KEY the first time a crypto operation runs.
   * Memoised, so the base64 decode happens once per process.
   */
  private assertKek(): void {
    if (this.kek) return;

    const raw = this.configService.get<string>('ARCA_MASTER_KEY');
    if (!raw) {
      throw new Error(
        'ARCA_MASTER_KEY is not set. Generate with: openssl rand -base64 32',
      );
    }

    const decoded = Buffer.from(raw, 'base64');
    if (decoded.length < 32) {
      throw new Error(
        `ARCA_MASTER_KEY is too short (${decoded.length} bytes). Minimum 32 bytes required.`,
      );
    }

    this.kek = new Uint8Array(decoded.slice(0, 32));
    this.logger.log('KEK loaded (kekVersion=1)');
  }
}
