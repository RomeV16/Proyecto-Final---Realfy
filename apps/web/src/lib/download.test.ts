// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const apiBlob = vi.fn();
const portalApiBlob = vi.fn();
vi.mock('./api-client', () => ({ apiBlob: (...a: unknown[]) => apiBlob(...a) }));
vi.mock('./portal-api-client', () => ({
  portalApiBlob: (...a: unknown[]) => portalApiBlob(...a),
}));

import { downloadFile, saveBlob } from './download';

let clicked: { href: string; download: string }[];

beforeEach(() => {
  clicked = [];
  apiBlob.mockReset();
  portalApiBlob.mockReset();
  URL.createObjectURL = vi.fn(() => 'blob:fake');
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    clicked.push({ href: this.href, download: this.download });
  });
});

afterEach(() => vi.restoreAllMocks());

describe('saveBlob', () => {
  it('crea un enlace temporal, lo clickea y libera la URL', () => {
    saveBlob(new Blob(['x']), 'a.pdf');
    expect(clicked).toEqual([{ href: 'blob:fake', download: 'a.pdf' }]);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:fake');
    expect(document.querySelector('a')).toBeNull();
  });
});

describe('downloadFile', () => {
  it('descarga con la sesión del personal y el nombre pedido', async () => {
    apiBlob.mockResolvedValue({ blob: new Blob(['x']), filename: 'servidor.pdf' });
    await downloadFile('/invoices/1/pdf', 'comprobante-1.pdf');
    expect(apiBlob).toHaveBeenCalledWith('/invoices/1/pdf', {});
    expect(clicked[0].download).toBe('comprobante-1.pdf');
  });

  it('con preferServerName usa el nombre del servidor y, si falta, el sugerido', async () => {
    apiBlob.mockResolvedValueOnce({ blob: new Blob(['x']), filename: 'servidor.xlsx' });
    await downloadFile('/r', 'reporte.xlsx', { preferServerName: true });
    apiBlob.mockResolvedValueOnce({ blob: new Blob(['x']), filename: null });
    await downloadFile('/r', 'reporte.xlsx', { preferServerName: true });
    expect(clicked.map((c) => c.download)).toEqual(['servidor.xlsx', 'reporte.xlsx']);
  });

  it('pasa método y cuerpo al cliente', async () => {
    apiBlob.mockResolvedValue({ blob: new Blob(['x']), filename: null });
    await downloadFile('/c/generate-document', 'c.pdf', {
      init: { method: 'POST', body: '{"format":"pdf"}' },
    });
    expect(apiBlob).toHaveBeenCalledWith('/c/generate-document', {
      method: 'POST',
      body: '{"format":"pdf"}',
    });
  });

  it('con portal usa la sesión del portal', async () => {
    portalApiBlob.mockResolvedValue({ blob: new Blob(['x']), filename: null });
    await downloadFile('/portal/liquidaciones/1/pdf', 'factura-1.pdf', { portal: true });
    expect(portalApiBlob).toHaveBeenCalled();
    expect(apiBlob).not.toHaveBeenCalled();
  });

  it('propaga el error y no descarga nada', async () => {
    apiBlob.mockRejectedValue(new Error('403'));
    await expect(downloadFile('/x', 'x.pdf')).rejects.toThrow('403');
    expect(clicked).toEqual([]);
  });
});
