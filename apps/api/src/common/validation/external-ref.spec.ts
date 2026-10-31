import { ConflictException } from '@nestjs/common';
import { rethrowExternalRefConflict } from './external-ref';

describe('rethrowExternalRefConflict', () => {
  it('maps a P2002 on externalRef to EXTERNAL_REF_TAKEN (409)', () => {
    const err = { code: 'P2002', meta: { target: ['tenantId', 'externalRef'] } };
    try {
      rethrowExternalRefConflict(err, 'person');
      throw new Error('should have thrown');
    } catch (e: any) {
      expect(e).toBeInstanceOf(ConflictException);
      expect(e.getResponse().error).toBe('EXTERNAL_REF_TAKEN');
    }
  });

  it('rethrows other unique violations untouched', () => {
    const err = { code: 'P2002', meta: { target: ['tenantId', 'cuit'] } };
    expect(() => rethrowExternalRefConflict(err, 'person')).toThrow();
    try {
      rethrowExternalRefConflict(err, 'person');
    } catch (e) {
      expect(e).toBe(err);
    }
  });

  it('rethrows unknown errors untouched', () => {
    const err = new Error('boom');
    expect(() => rethrowExternalRefConflict(err, 'person')).toThrow(err);
  });
});
