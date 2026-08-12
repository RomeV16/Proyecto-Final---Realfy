import { z } from 'zod';

export const PortalLoginRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const PortalSetPasswordRequestSchema = z.object({
  token: z.string().uuid(),
  password: z.string().min(8).max(128),
});

export const PortalRefreshTokenRequestSchema = z.object({
  refreshToken: z.string().uuid(),
});
