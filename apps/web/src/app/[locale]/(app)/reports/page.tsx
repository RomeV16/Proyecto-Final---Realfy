'use client';

import { ReportsPage } from '@/components/reports/reports-page';
import { ReadGate } from '@/components/ui/read-gate';

export default function ReportsRoutePage() {
  return (
    <ReadGate resource="reports.financial">
      <ReportsPage />
    </ReadGate>
  );
}
