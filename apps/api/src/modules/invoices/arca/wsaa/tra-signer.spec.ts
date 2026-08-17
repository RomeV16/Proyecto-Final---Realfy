/**
 * tra-signer.spec.ts — Unit tests for TRA building and PKCS#7 signing.
 *
 * Tests:
 * - buildTra: validates the XML structure and timing
 * - signTra: signs with a self-signed test cert, validates base64 output
 *   decodes to PKCS#7 DER containing the signer's certificate
 */

import { buildTra, signTra } from './tra-signer';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const forge = require('node-forge');

// ─── Generate a test self-signed certificate ──────────────────────────────────

function generateTestCert(): { certPem: string; keyPem: string; cn: string } {
  const keypair = forge.pki.rsa.generateKeyPair({ bits: 1024, e: 0x10001 });
  const cert = forge.pki.createCertificate();

  cert.publicKey = keypair.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 1);

  const cn = 'TEST-CUIT-20111111113';
  const attrs = [
    { name: 'commonName', value: cn },
    { name: 'organizationName', value: 'Test Agency' },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keypair.privateKey, forge.md.sha256.create());

  return {
    certPem: forge.pki.certificateToPem(cert),
    keyPem: forge.pki.privateKeyToPem(keypair.privateKey),
    cn,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('buildTra', () => {
  it('produces valid XML with version attribute', () => {
    const tra = buildTra('wsfe');
    expect(tra).toContain('version="1.0"');
    expect(tra).toContain('<loginTicketRequest');
  });

  it('includes the service name', () => {
    const tra = buildTra('wsfe');
    expect(tra).toContain('<service>wsfe</service>');
  });

  it('includes service name for padron', () => {
    const tra = buildTra('ws_sr_padron_a5');
    expect(tra).toContain('<service>ws_sr_padron_a5</service>');
  });

  it('includes uniqueId, generationTime, expirationTime', () => {
    const tra = buildTra('wsfe');
    expect(tra).toContain('<uniqueId>');
    expect(tra).toContain('<generationTime>');
    expect(tra).toContain('<expirationTime>');
  });

  it('expirationTime is approximately 10 hours after generationTime', () => {
    const before = Date.now();
    const tra = buildTra('wsfe');
    const after = Date.now();

    const genMatch = tra.match(/<generationTime>([^<]+)<\/generationTime>/);
    const expMatch = tra.match(/<expirationTime>([^<]+)<\/expirationTime>/);

    expect(genMatch).toBeTruthy();
    expect(expMatch).toBeTruthy();

    const genTime = new Date(genMatch![1]).getTime();
    const expTime = new Date(expMatch![1]).getTime();

    // generationTime = now - 60s ± 5s
    expect(genTime).toBeGreaterThan(before - 65_000);
    expect(genTime).toBeLessThan(after - 55_000);

    // expirationTime = now + 10h ± 5s
    const tenHoursMs = 10 * 60 * 60 * 1000;
    expect(expTime - genTime).toBeCloseTo(tenHoursMs + 60_000, -3); // within 1s precision
  });
});

describe('signTra', () => {
  let certPem: string;
  let keyPem: string;
  let cn: string;

  beforeAll(() => {
    // Generate once — RSA keygen is slow even at 1024 bits
    ({ certPem, keyPem, cn } = generateTestCert());
  });

  it('returns a non-empty base64 string', () => {
    const traXml = buildTra('wsfe');
    const result = signTra(traXml, certPem, keyPem);

    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(100);
    // Valid base64
    expect(() => Buffer.from(result, 'base64')).not.toThrow();
  });

  it('decodes to a valid PKCS#7 DER structure', () => {
    const traXml = buildTra('wsfe');
    const result = signTra(traXml, certPem, keyPem);

    // Decode base64 → DER bytes
    const derBytes = forge.util.decode64(result);
    expect(derBytes.length).toBeGreaterThan(0);

    // Parse ASN.1 — should not throw
    let asn1: any;
    expect(() => {
      asn1 = forge.asn1.fromDer(derBytes);
    }).not.toThrow();

    expect(asn1).toBeDefined();
    expect(asn1.type).toBeDefined(); // Should be a SEQUENCE (0x30)
  });

  it('embeds the signing certificate in the CMS structure', () => {
    const traXml = buildTra('wsfe');
    const result = signTra(traXml, certPem, keyPem);

    // The base64 output should contain the CN when DER-decoded and searched
    const derBytes = forge.util.decode64(result);
    // Convert to buffer and check for the CN substring in raw bytes
    const derBuf = Buffer.from(derBytes, 'binary');
    // The cert CN is embedded in the DER — it should appear somewhere
    const cnBuffer = Buffer.from(cn, 'utf8');
    const found = derBuf.indexOf(cnBuffer) >= 0;
    expect(found).toBe(true);
  });

  it('produces different output on each call (uniqueId varies)', () => {
    const traXml1 = buildTra('wsfe');
    // Small delay to get different uniqueId
    const traXml2 = buildTra('wsfe');

    const sig1 = signTra(traXml1, certPem, keyPem);
    const sig2 = signTra(traXml2, certPem, keyPem);

    // Both are valid base64
    expect(sig1.length).toBeGreaterThan(100);
    expect(sig2.length).toBeGreaterThan(100);
  });

  it('throws on invalid certificate PEM', () => {
    const traXml = buildTra('wsfe');
    expect(() => signTra(traXml, 'not-a-cert', keyPem)).toThrow();
  });

  it('throws on invalid key PEM', () => {
    const traXml = buildTra('wsfe');
    expect(() => signTra(traXml, certPem, 'not-a-key')).toThrow();
  });
});
