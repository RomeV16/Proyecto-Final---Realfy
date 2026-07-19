'use client';

import { useParams } from 'next/navigation';
import { LiquidacionDetail } from '@/components/liquidaciones/liquidacion-detail';

export default function LiquidacionDetailPage() {
  const params = useParams();
  const liquidacionId = params.id as string;

  return <LiquidacionDetail liquidacionId={liquidacionId} />;
}
