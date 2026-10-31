import { SetMetadata } from '@nestjs/common';
import type { ReadResource as ReadResourceName } from '@realfy/shared';

export const READ_RESOURCE_KEY = 'readResource';
export const MASK_READS_KEY = 'maskReads';

/**
 * Exige que la política de lectura de la inmobiliaria permita al rol del
 * usuario leer el recurso. Se suma a @Roles: deben cumplirse las dos.
 */
export const ReadResource = (resource: ReadResourceName) =>
  SetMetadata(READ_RESOURCE_KEY, resource);

/**
 * En la respuesta de la ruta, enmascara los campos de los recursos que el rol
 * del usuario no puede leer, en lugar de rechazar la lectura completa.
 */
export const MaskReads = (...resources: ReadResourceName[]) =>
  SetMetadata(MASK_READS_KEY, resources);
