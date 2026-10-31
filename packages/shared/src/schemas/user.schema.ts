import { z } from 'zod';
import { UserRole } from '../enums';

export const CreateUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  role: z.nativeEnum(UserRole),
});

export const InviteUserSchema = z.object({
  email: z.string().email(),
  role: z.nativeEnum(UserRole),
});

/** Mínimo y máximo de una contraseña nueva, en un solo lugar para API y web. */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

const newPassword = z
  .string()
  .min(PASSWORD_MIN_LENGTH, { message: 'validation.minLength' })
  .max(PASSWORD_MAX_LENGTH, { message: 'validation.maxLength' });

export const UpdateUserSchema = z.object({
  role: z.nativeEnum(UserRole),
});

export const AcceptInvitationSchema = z.object({
  token: z.string().min(1),
  password: newPassword,
  firstName: z.string().trim().min(1, { message: 'validation.required' }).max(100),
  lastName: z.string().trim().min(1, { message: 'validation.required' }).max(100),
});

export const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1, { message: 'validation.required' }),
  newPassword,
});

export const PasswordResetRequestSchema = z.object({
  email: z
    .string()
    .min(1, { message: 'validation.required' })
    .email({ message: 'validation.email.invalid' }),
});

export const PasswordResetConfirmSchema = z.object({
  token: z.string().min(1),
  newPassword,
});

/** Estado visible de una persona del equipo en el listado. */
export type UserStatus = 'invited' | 'active' | 'inactive';

export interface TeamMember {
  /** Id del usuario; para una invitación pendiente, el de la invitación. */
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: UserRole;
  status: UserStatus;
  lastLoginAt: string | null;
  createdAt: string;
  /** Solo en invitaciones pendientes. */
  invitationExpiresAt: string | null;
  invitationExpired: boolean;
}

/** Respuesta de invitar, reenviar o generar un enlace de recupero (solo Admin). */
export interface ShareableLink {
  id: string;
  email: string;
  role?: UserRole;
  expiresAt: string;
  /** Token en claro, visible una única vez. */
  token: string;
  /** Enlace listo para compartir. */
  link: string;
  /** `true` si el servidor además lo mandó por correo. */
  emailSent: boolean;
}
