'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import type { OutboxItem } from '@realfy/shared';

/**
 * Textos de un mensaje de la bandeja de salida: canal, plantilla, documento y
 * la explicación de por qué quedó frenado o falló. Un valor que la web no
 * conoce se muestra tal cual (la API puede sumar plantillas o motivos).
 */
export function useMessageText() {
  const t = useTranslations('messaging');
  return useMemo(() => {
    const label = (group: string, value: string) => (t.has(`${group}.${value}`) ? t(`${group}.${value}`) : value);
    return {
      channel: (channel: string) => label('channels', channel),
      template: (key: string) => label('templates', key),
      related: (type: string) => label('related', type),
      /** Motivo legible (`statusReason`) o el error del proveedor; null si no hay nada que explicar. */
      explain: (item: Pick<OutboxItem, 'statusReason' | 'error'>): string | null => {
        if (item.statusReason) return label('reasons', item.statusReason);
        if (item.error) return t('providerError', { error: item.error });
        return null;
      },
    };
  }, [t]);
}
