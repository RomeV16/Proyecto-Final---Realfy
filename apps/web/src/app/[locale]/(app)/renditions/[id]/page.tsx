'use client';

import { useParams } from 'next/navigation';
import { RenditionDetail } from '@/components/renditions/rendition-detail';

export default function RenditionDetailPage() {
  const params = useParams();
  const renditionId = params.id as string;

  return <RenditionDetail renditionId={renditionId} />;
}
