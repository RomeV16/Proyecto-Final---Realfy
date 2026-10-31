import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import { parseOrThrow, ZodValidationPipe } from './zod';

const Schema = z.object({ name: z.string().min(1), age: z.number().default(3) });

describe('parseOrThrow', () => {
  it('devuelve el valor parseado con sus defaults', () => {
    expect(parseOrThrow(Schema, { name: 'a' })).toEqual({ name: 'a', age: 3 });
  });

  it('lanza 400 VALIDATION_ERROR con details y el mensaje dado', () => {
    let caught: unknown;
    try {
      parseOrThrow(Schema, { name: '' }, 'Invalid thing');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(BadRequestException);
    const ex = caught as BadRequestException;
    const body = ex.getResponse() as any;
    expect(ex.getStatus()).toBe(400);
    expect(body.error).toBe('VALIDATION_ERROR');
    expect(body.message).toBe('Invalid thing');
    expect(body.details[0].path).toEqual(['name']);
  });

  it('propaga errores que no son de validación', () => {
    const boom = z.any().transform(() => {
      throw new Error('boom');
    });
    expect(() => parseOrThrow(boom, 1)).toThrow('boom');
  });
});

describe('ZodValidationPipe', () => {
  it('transforma una entrada válida', () => {
    expect(new ZodValidationPipe(Schema).transform({ name: 'x' })).toEqual({ name: 'x', age: 3 });
  });

  it('rechaza una entrada inválida con 400', () => {
    expect(() => new ZodValidationPipe(Schema, 'Bad').transform({})).toThrow(BadRequestException);
  });
});
