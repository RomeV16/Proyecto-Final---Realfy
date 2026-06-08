import { IsEmail, IsString, MinLength } from 'class-validator';

/**
 * DTO de registro — valida email, contraseña (min 8 chars) y nombre.
 * Extraído de auth.controller para centralizar las validaciones de auth.
 */
export class RegisterDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;

  @IsString()
  firstName!: string;

  @IsString()
  lastName!: string;
}

/**
 * DTO de login — valida email y contraseña.
 */
export class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  password!: string;
}
