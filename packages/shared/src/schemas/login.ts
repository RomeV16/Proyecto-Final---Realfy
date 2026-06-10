import { z } from 'zod';

// Messages use i18n-compatible keys so the UI can swap Spanish defaults for other locales.
// Convention: message = 'auth.field.errorKey' — translate it client-side via t(message).
export const loginSchema = z.object({
  email: z
    .string()
    .min(1, { message: 'auth.email.required' })   // ES: "El correo es obligatorio"
    .email({ message: 'auth.email.invalid' }),     // ES: "El correo no es válido"
  password: z
    .string()
    .min(8, { message: 'auth.password.tooShort' }), // ES: "La contraseña debe tener al menos 8 caracteres"
});

export type LoginFormInput = z.infer<typeof loginSchema>;
