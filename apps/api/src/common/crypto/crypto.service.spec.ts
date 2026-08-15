import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import * as path from 'path';
import * as fs from 'fs';
import { CryptoService, EncryptedBlob } from './crypto.service';

// A 32-byte key encoded as base64 for test use
const TEST_KEK_BYTES = Buffer.alloc(32, 0xab); // 32 bytes of 0xab
const TEST_KEK_B64 = TEST_KEK_BYTES.toString('base64');

const FIXTURE_DIR = path.join(__dirname, 'fixtures');

function makeConfigService(key: string): ConfigService {
  return {
    get: jest.fn().mockImplementation((k: string) => {
      if (k === 'ARCA_MASTER_KEY') return key;
      return undefined;
    }),
  } as unknown as ConfigService;
}

async function buildService(kekB64: string): Promise<CryptoService> {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      CryptoService,
      {
        provide: ConfigService,
        useValue: makeConfigService(kekB64),
      },
    ],
  }).compile();

  return module.get<CryptoService>(CryptoService);
}

describe('CryptoService', () => {
  let svc: CryptoService;

  beforeAll(async () => {
    svc = await buildService(TEST_KEK_B64);
  });

  describe('encrypt / decrypt — roundtrip', () => {
    it('decrypts to original plaintext for small payload', async () => {
      const plain = Buffer.from('Hello, ARCA!');
      const blob = await svc.encrypt(plain);
      const decrypted = await svc.decrypt(blob);
      expect(decrypted.toString()).toBe('Hello, ARCA!');
    });

    it('decrypts to original plaintext for binary payload', async () => {
      const plain = Buffer.alloc(1024, 0xff);
      const blob = await svc.encrypt(plain);
      const decrypted = await svc.decrypt(blob);
      expect(decrypted.equals(plain)).toBe(true);
    });

    it('produces unique ciphertexts for the same plaintext (random nonce)', async () => {
      const plain = Buffer.from('same plaintext');
      const blob1 = await svc.encrypt(plain);
      const blob2 = await svc.encrypt(plain);
      expect(blob1.ciphertext.equals(blob2.ciphertext)).toBe(false);
      expect(blob1.dek_wrapped.equals(blob2.dek_wrapped)).toBe(false);
    });
  });

  describe('decrypt — wrong KEK fails', () => {
    it('throws when decrypting with a different KEK', async () => {
      const plain = Buffer.from('secret certificate bytes');
      const blob = await svc.encrypt(plain);

      // Build a second service with a different KEK
      const wrongKek = Buffer.alloc(32, 0x01).toString('base64');
      const svc2 = await buildService(wrongKek);

      await expect(svc2.decrypt(blob)).rejects.toThrow();
    });
  });

  describe('rotateKek — roundtrip', () => {
    it('re-wraps DEK so the new KEK can decrypt the same ciphertext', async () => {
      const plain = Buffer.from('certificate data to protect');
      const blob = await svc.encrypt(plain);

      const newKek = Buffer.alloc(32, 0xcc);
      const rotatedBlob = await svc.rotateKek(newKek, blob);

      // ciphertext bytes are unchanged
      expect(rotatedBlob.ciphertext.equals(blob.ciphertext)).toBe(true);
      // dek_wrapped bytes have changed
      expect(rotatedBlob.dek_wrapped.equals(blob.dek_wrapped)).toBe(false);

      // Build a service with the new KEK and decrypt
      const svc2 = await buildService(newKek.toString('base64'));
      const decrypted = await svc2.decrypt(rotatedBlob);
      expect(decrypted.toString()).toBe('certificate data to protect');
    });

    it('old KEK can no longer decrypt after rotation', async () => {
      const plain = Buffer.from('another secret');
      const blob = await svc.encrypt(plain);

      const newKek = Buffer.alloc(32, 0xdd);
      const rotatedBlob = await svc.rotateKek(newKek, blob);

      // The original service (old KEK) should fail to decrypt the rotated blob
      await expect(svc.decrypt(rotatedBlob)).rejects.toThrow();
    });
  });

  describe('parseCertificate', () => {
    it('extracts CN, notBefore, notAfter from a self-signed PEM fixture', () => {
      const pemPath = path.join(FIXTURE_DIR, 'test-cert.pem');
      const pem = fs.readFileSync(pemPath);

      const result = svc.parseCertificate(pem);

      expect(result.commonName).toBe('20-12345678-9');
      expect(result.notBefore).toBeInstanceOf(Date);
      expect(result.notAfter).toBeInstanceOf(Date);
      expect(result.notAfter.getTime()).toBeGreaterThan(result.notBefore.getTime());
    });
  });

  describe('KEK validation — deferred to first use', () => {
    it('instantiates without ARCA_MASTER_KEY so the API can boot without it', async () => {
      const module = await Test.createTestingModule({
        providers: [
          CryptoService,
          {
            provide: ConfigService,
            useValue: { get: jest.fn().mockReturnValue(undefined) },
          },
        ],
      }).compile();

      expect(module.get<CryptoService>(CryptoService)).toBeInstanceOf(CryptoService);
    });

    it('throws on encrypt if ARCA_MASTER_KEY is not set', async () => {
      const svcMissing = await buildService(undefined as unknown as string);
      await expect(svcMissing.encrypt(Buffer.from('x'))).rejects.toThrow(
        'ARCA_MASTER_KEY is not set',
      );
    });

    it('throws on decrypt if ARCA_MASTER_KEY is not set', async () => {
      const blob = await svc.encrypt(Buffer.from('x'));
      const svcMissing = await buildService(undefined as unknown as string);
      await expect(svcMissing.decrypt(blob)).rejects.toThrow('ARCA_MASTER_KEY is not set');
    });

    it('throws if ARCA_MASTER_KEY decodes to fewer than 32 bytes', async () => {
      const svcShort = await buildService(Buffer.alloc(16, 0xaa).toString('base64'));
      await expect(svcShort.encrypt(Buffer.from('x'))).rejects.toThrow('too short');
    });
  });
});
