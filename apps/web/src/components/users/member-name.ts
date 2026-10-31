import type { TeamMember } from '@realfy/shared';

/** Nombre para mostrar: "Nombre Apellido", o el correo si todavía no aceptó la invitación. */
export function memberName(member: Pick<TeamMember, 'firstName' | 'lastName' | 'email'>): string {
  const full = [member.firstName, member.lastName].filter(Boolean).join(' ');
  return full || member.email;
}
