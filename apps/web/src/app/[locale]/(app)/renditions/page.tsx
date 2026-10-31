'use client';

import { RenditionList } from '@/components/renditions/rendition-list';
import { ReadGate } from '@/components/ui/read-gate';

export default function RenditionListPage() {
  return (
    <ReadGate resource="renditions">
      <RenditionList />
    </ReadGate>
  );
}
