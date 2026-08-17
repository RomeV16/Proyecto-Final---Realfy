# AfipSDK Mock Strategy

## Overview

`afip-mock.ts` is a test-only shim that replaces `@afipsdk/afip.js` with a deterministic in-memory implementation. It never makes network calls to AFIP servers.

## When to use each approach

### A. Jest module mock (unit tests)

In unit-test spec files that exercise `ArcaClientFactory` directly:

```ts
jest.mock('@afipsdk/afip.js', () => require('./__mocks__/afip-mock').MockAfipConstructor);
```

The `__mocks__` directory is adjacent to `arca-client.factory.ts`, so Jest can auto-wire it if you configure `moduleNameMapper` or use `jest.mock()` manually.

### B. Environment flag `ARCA_MOCK=1` (integration + e2e)

`ArcaClientFactory.getClient()` checks `process.env.ARCA_MOCK`. When `ARCA_MOCK=1`:

1. It skips decrypting the certificate from the database.
2. It constructs a `MockAfip` instance instead of the real `Afip` SDK.
3. All downstream AFIP calls return deterministic fake data.

Start the test server with:

```bash
ARCA_MOCK=1 pnpm --filter @realfy/api run dev
```

Or in Docker / CI:

```yaml
env:
  ARCA_MOCK: "1"
```

## Deterministic responses

| Method | Returns |
|--------|---------|
| `createVoucher(data)` | `CAE = '12345678901234'`, `CAEFchVto = today + 10 days`, `numero = auto-increment per (CUIT, PtoVta, CbteTipo)` |
| `getLastVoucher(ptoVta, cbteTipo)` | Last value from internal counter (starts at 0) |
| `getSalesPoints()` | `[{ Nro: 1, EmisionTipo: 'Web Services', Bloqueado: 'N' }]` |
| `getServerStatus()` | `{ AppServer: 'OK', AuthServer: 'OK', DbServer: 'OK' }` |
| `getTaxpayerDetails(cuit)` | Minimal struct with `estadoClave: 'ACTIVO'` |

## Counter isolation between tests

Call `MockAfip.resetCounters()` or `resetAfipMock()` in `beforeEach` to avoid voucher number bleed between tests:

```ts
import { resetAfipMock } from './__mocks__/afip-mock';
beforeEach(() => resetAfipMock());
```

## Production safety

This file is only imported in test contexts (`*.spec.ts`, or a dev/e2e server started with `ARCA_MOCK=1`).

It is NOT referenced by any production module. TypeScript `noImplicitAny` and ESLint will catch accidental production imports.
