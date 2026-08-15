/**
 * CryptoService — edge-case tests.
 * Covers: empty plaintext, very large plaintext, rotateKek with wrong old KEK.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { CryptoService } from './crypto.service';

const TEST_KEK_B64 = Buffer.alloc(32, 0xab).toString('base64');
const OTHER_KEK_B64 = Buffer.alloc(32, 0x01).toString('base64');

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
      { provide: ConfigService, useValue: makeConfigService(kekB64) },
    ],
  }).compile();
  return module.get<CryptoService>(CryptoService);
}

describe('CryptoService — edge cases', () => {
  let svc: CryptoService;

  beforeAll(async () => {
    svc = await buildService(TEST_KEK_B64);
  });

  // ── Empty plaintext ────────────────────────────────────────────────────────

  describe('empty plaintext', () => {
    it('encrypts and decrypts an empty buffer without error', async () => {
      const plain = Buffer.alloc(0);
      const blob = await svc.encrypt(plain);
      const decrypted = await svc.decrypt(blob);
      expect(decrypted.length).toBe(0);
    });

    it('produces a non-empty ciphertext even for empty input (nonce + MAC overhead)', async () => {
      const plain = Buffer.alloc(0);
      const blob = await svc.encrypt(plain);
      // libsodium secretbox adds 24-byte nonce + 16-byte MAC = 40 bytes overhead
      expect(blob.ciphertext.length).toBeGreaterThan(0);
    });
  });

  // ── Very large plaintext (10 MB) ───────────────────────────────────────────

  describe('very large plaintext (10 MB)', () => {
    it('encrypts and decrypts a 10 MB buffer', async () => {
      const plain = Buffer.alloc(10 * 1024 * 1024, 0x42); // 10 MB of 0x42 bytes
      const blob = await svc.encrypt(plain);
      const decrypted = await svc.decrypt(blob);
      expect(decrypted.equals(plain)).toBe(true);
    }, 30_000);

    it('ciphertext is approximately the same size as plaintext (+ nonce + MAC)', async () => {
      const plain = Buffer.alloc(10 * 1024 * 1024, 0x00);
      const blob = await svc.encrypt(plain);
      // ciphertext = nonce(24) + mac(16) + plaintext bytes
      expect(blob.ciphertext.length).toBeGreaterThanOrEqual(plain.length);
      expect(blob.ciphertext.length).toBeLessThan(plain.length + 200);
    }, 30_000);
  });

  // ── rotateKek — wrong old KEK must fail cleanly ─────────────────────────────

  describe('rotateKek with wrong old KEK', () => {
    it('throws when rotating with a wrong (current) KEK', async () => {
      const plain = Buffer.from('sensitive data');
      const blob = await svc.encrypt(plain);

      // Build a service with a DIFFERENT KEK — this one has the wrong KEK loaded
      const wrongKeySvc = await buildService(OTHER_KEK_B64);

      // Using the wrong KEK as the "current" one should fail to unwrap DEK
      const newKek = Buffer.alloc(32, 0xee);
      await expect(wrongKeySvc.rotateKek(newKek, blob)).rejects.toThrow();
    });

    it('error message from wrong-KEK rotation is informative (not a silent null)', async () => {
      const plain = Buffer.from('cert bytes');
      const blob = await svc.encrypt(plain);

      const wrongKeySvc = await buildService(OTHER_KEK_B64);
      const newKek = Buffer.alloc(32, 0xff);

      let caughtError: Error | null = null;
      try {
        await wrongKeySvc.rotateKek(newKek, blob);
      } catch (err: any) {
        caughtError = err;
      }
      expect(caughtError).not.toBeNull();
      // libsodium or CryptoService throws with a meaningful message
      expect(caughtError!.message).toBeTruthy();
      expect(typeof caughtError!.message).toBe('string');
    });

    it('after failed rotation, original blob is still decryptable with original KEK', async () => {
      const plain = Buffer.from('still intact after failed rotation');
      const blob = await svc.encrypt(plain);

      const wrongKeySvc = await buildService(OTHER_KEK_B64);
      const newKek = Buffer.alloc(32, 0x11);
      try {
        await wrongKeySvc.rotateKek(newKek, blob);
      } catch {
        // expected
      }

      // The original blob should still be decryptable with the original KEK
      const decrypted = await svc.decrypt(blob);
      expect(decrypted.toString()).toBe('still intact after failed rotation');
    });
  });

  // ── Boundary: exactly 32-byte plaintext (block boundary) ──────────────────

  describe('plaintext at block boundary', () => {
    it('encrypts and decrypts exactly 32 bytes', async () => {
      const plain = Buffer.alloc(32, 0x55);
      const blob = await svc.encrypt(plain);
      const decrypted = await svc.decrypt(blob);
      expect(decrypted.equals(plain)).toBe(true);
    });

    it('each 32-byte encrypt produces unique ciphertexts (nonce randomness)', async () => {
      const plain = Buffer.alloc(32, 0x55);
      const b1 = await svc.encrypt(plain);
      const b2 = await svc.encrypt(plain);
      expect(b1.ciphertext.equals(b2.ciphertext)).toBe(false);
    });
  });
});
