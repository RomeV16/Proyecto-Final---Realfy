'use client';

import { useEffect, useState } from 'react';
import { USER_STATUSES, type TeamMember } from '@realfy/shared';
import { apiClient } from '@/lib/api-client';
import { memberName } from '@/components/users/member-name';

export interface StaffUserOption {
  id: string;
  name: string;
}

/** Personal activo de la inmobiliaria, para asignarle una comisión sobre un honorario. */
export function useStaffUsers(enabled: boolean): StaffUserOption[] {
  const [users, setUsers] = useState<StaffUserOption[]>([]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void (async () => {
      try {
        const members = await apiClient<TeamMember[]>('/users');
        if (cancelled) return;
        setUsers(
          (Array.isArray(members) ? members : [])
            .filter((m) => m.status === USER_STATUSES.Active)
            .map((m) => ({ id: m.id, name: memberName(m) })),
        );
      } catch {
        if (!cancelled) setUsers([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return users;
}
