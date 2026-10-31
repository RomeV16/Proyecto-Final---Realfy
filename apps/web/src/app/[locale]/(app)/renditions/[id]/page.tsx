'use client';

import { useParams } from 'next/navigation';
import { RenditionDetail } from '@/components/renditions/rendition-detail';
import { ReadGate } from '@/components/ui/read-gate';

export default function RenditionDetailPage() {
  const params = useParams();
  const renditionId = params.id as string;

  return (
    <ReadGate resource="renditions">
      <RenditionDetail renditionId={renditionId} />
    </ReadGate>
  );
}
