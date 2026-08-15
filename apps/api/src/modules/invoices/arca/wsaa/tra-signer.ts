/**
 * tra-signer.ts — Pure function to sign a TRA (Ticket de Requerimiento de Acceso)
 * as a CMS/PKCS#7 detached signature (SMIME detached, DER), base64-encoded.
 *
 * AFIP expects the CMS signed in DER encoding, then base64-encoded, sent inside
 * <loginCms> in the WSAA SOAP envelope.
 *
 * Uses node-forge (already in dependencies) — no extra packages needed.
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const forge = require('node-forge');

/**
 * Build the TRA XML for a given service.
 *
 * @param service  AFIP service identifier (e.g. "wsfe", "ws_sr_padron_a5")
 * @returns TRA XML string
 */
export function buildTra(service: string): string {
  const now = new Date();
  const genTime = new Date(now.getTime() - 60 * 1000); // now - 60s
  const expTime = new Date(now.getTime() + 10 * 60 * 60 * 1000); // now + 10h

  const uniqueId = Math.floor(Date.now() / 1000);

  const toAfipIso = (d: Date): string => d.toISOString().replace('.000Z', '-03:00');

  return `<?xml version="1.0" encoding="UTF-8"?>
<loginTicketRequest version="1.0">
  <header>
    <uniqueId>${uniqueId}</uniqueId>
    <generationTime>${toAfipIso(genTime)}</generationTime>
    <expirationTime>${toAfipIso(expTime)}</expirationTime>
  </header>
  <service>${service}</service>
</loginTicketRequest>`;
}

/**
 * Sign a TRA XML using the agency certificate and key, producing
 * a base64-encoded DER-encoded CMS SignedData message.
 *
 * @param traXml   The TRA XML string
 * @param certPem  X.509 certificate in PEM format
 * @param keyPem   RSA private key in PEM format
 * @returns Base64-encoded DER CMS SignedData
 */
export function signTra(traXml: string, certPem: string, keyPem: string): string {
  const cert = forge.pki.certificateFromPem(certPem);
  const key = forge.pki.privateKeyFromPem(keyPem);

  // Create PKCS#7 SignedData
  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(traXml, 'utf8');

  p7.addCertificate(cert);
  p7.addSigner({
    key,
    certificate: cert,
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      {
        type: forge.pki.oids.contentType,
        value: forge.pki.oids.data,
      },
      {
        type: forge.pki.oids.messageDigest,
      },
      {
        type: forge.pki.oids.signingTime,
        value: new Date(),
      },
    ],
  });

  p7.sign({ detached: true });

  // Convert to DER, then base64
  const der = forge.asn1.toDer(p7.toAsn1()).getBytes();
  return forge.util.encode64(der);
}
