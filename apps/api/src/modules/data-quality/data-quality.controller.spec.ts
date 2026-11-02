import { BadRequestException } from '@nestjs/common';
import { DataQualityController } from './data-quality.controller';

describe('DataQualityController', () => {
  const quality = { summary: jest.fn().mockResolvedValue({ total: 0 }), findings: jest.fn().mockResolvedValue({ items: [] }) };
  const merges = { preview: jest.fn().mockResolvedValue({ items: [] }), merge: jest.fn().mockResolvedValue({ merged: 1 }) };
  const controller = new DataQualityController(quality as any, merges as any);

  it('delega el resumen, la vista previa y la unión', async () => {
    await expect(controller.summary()).resolves.toEqual({ total: 0 });
    await expect(controller.previewMerge({ a: 1 })).resolves.toEqual({ items: [] });
    await expect(controller.merge({ b: 2 })).resolves.toEqual({ merged: 1 });
    expect(merges.preview).toHaveBeenCalledWith({ a: 1 });
    expect(merges.merge).toHaveBeenCalledWith({ b: 2 });
  });

  it('pasa los hallazgos de un control conocido y rechaza uno desconocido', async () => {
    await controller.findings('lessors-sum', { page: '2' });
    expect(quality.findings).toHaveBeenCalledWith('lessors-sum', { page: '2' });
    expect(() => controller.findings('nope', {})).toThrow(BadRequestException);
  });
});
