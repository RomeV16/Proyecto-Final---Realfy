import { CsvParserService } from './csv-parser.service';

describe('CsvParserService', () => {
  let service: CsvParserService;

  beforeEach(() => {
    service = new CsvParserService();
  });

  it('parses a simple comma-delimited CSV', () => {
    const csv = 'title,city\nCasa en venta,Cordoba\nDepto,Rosario';
    const result = service.parse(Buffer.from(csv, 'utf-8'));

    expect(result.headers).toEqual(['title', 'city']);
    expect(result.rows).toEqual([
      ['Casa en venta', 'Cordoba'],
      ['Depto', 'Rosario'],
    ]);
  });

  it('strips a leading UTF-8 BOM before parsing headers', () => {
    const csv = '﻿title,city\nCasa,Cordoba';
    const result = service.parse(Buffer.from(csv, 'utf-8'));

    expect(result.headers).toEqual(['title', 'city']);
  });

  it('auto-detects a semicolon delimiter', () => {
    const csv = 'title;city\nCasa;Cordoba';
    const result = service.parse(Buffer.from(csv, 'utf-8'));

    expect(result.headers).toEqual(['title', 'city']);
    expect(result.rows).toEqual([['Casa', 'Cordoba']]);
  });

  it('auto-detects a tab delimiter', () => {
    const csv = 'title\tcity\nCasa\tCordoba';
    const result = service.parse(Buffer.from(csv, 'utf-8'));

    expect(result.headers).toEqual(['title', 'city']);
    expect(result.rows).toEqual([['Casa', 'Cordoba']]);
  });

  it('collapses repeated internal whitespace in header cells', () => {
    const csv = 'title,  city   name\nCasa,Cordoba';
    const result = service.parse(Buffer.from(csv, 'utf-8'));

    expect(result.headers).toEqual(['title', 'city name']);
  });

  it('respects quoted fields containing the delimiter', () => {
    const csv = 'title,notes\n"Casa, con jardin","Buen estado"';
    const result = service.parse(Buffer.from(csv, 'utf-8'));

    expect(result.rows).toEqual([['Casa, con jardin', 'Buen estado']]);
  });

  it('unescapes doubled quotes inside quoted fields', () => {
    const csv = 'title,notes\nCasa,"Dice ""hola"" al entrar"';
    const result = service.parse(Buffer.from(csv, 'utf-8'));

    expect(result.rows).toEqual([['Casa', 'Dice "hola" al entrar']]);
  });

  it('drops fully blank rows', () => {
    const csv = 'title,city\nCasa,Cordoba\n,\nDepto,Rosario';
    const result = service.parse(Buffer.from(csv, 'utf-8'));

    expect(result.rows).toEqual([
      ['Casa', 'Cordoba'],
      ['Depto', 'Rosario'],
    ]);
  });

  it('returns empty headers and rows for an empty buffer', () => {
    const result = service.parse(Buffer.from('', 'utf-8'));

    expect(result.headers).toEqual([]);
    expect(result.rows).toEqual([]);
  });
});
