// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { act, render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { ApiRequestError } from '@/lib/api-client';
import { fieldErrorsFromApi, useSchemaMessages, useZodForm, type FormSchema } from './use-zod-form';

type Values = { name: string; email: string };

/** Esquema a mano con la forma mínima de zod (la web no depende de zod). */
const schema: FormSchema<Values> = {
  safeParse(input) {
    const v = input as Values;
    const issues: { path: string[]; message: string }[] = [];
    if (!v.name) issues.push({ path: ['name'], message: 'validation.required' });
    if (!v.email.includes('@')) issues.push({ path: ['email'], message: 'validation.email.invalid' });
    if (!v.email.includes('@') && !v.name) issues.push({ path: ['email'], message: 'segundo' });
    return issues.length ? { success: false, error: { issues } } : { success: true, data: v };
  },
};
const initialValues = { name: '', email: '' };

function api(body: Record<string, unknown>, status = 400) {
  return new ApiRequestError(status, 'X', 'Falló', { message: 'Falló', ...body });
}

describe('fieldErrorsFromApi', () => {
  const fields = ['name', 'email'];

  it('lee details.fieldErrors con texto o lista', () => {
    const err = api({ fieldErrors: { name: ['Muy corto', 'Otro'], email: 'Repetido', ajeno: 'x' } });
    expect(fieldErrorsFromApi(err, fields)).toEqual({ name: 'Muy corto', email: 'Repetido' });
  });

  it('lee details.errors con field o path, y descarta campos desconocidos', () => {
    const err = api({ errors: [{ field: 'name', message: 'A' }, { path: 'email.sub', message: 'B' }, { field: 'zzz', message: 'C' }, null] });
    expect(fieldErrorsFromApi(err, fields)).toEqual({ name: 'A', email: 'B' });
  });

  it('lee la lista de mensajes de class-validator por prefijo de campo', () => {
    const err = api({ message: ['email must be an email', 'name should not be empty', 'otro texto', 7] });
    expect(fieldErrorsFromApi(err, fields)).toEqual({
      email: 'email must be an email',
      name: 'name should not be empty',
    });
  });

  it('se queda con el primer mensaje de cada campo', () => {
    const err = api({ errors: [{ field: 'name', message: 'Primero' }, { field: 'name', message: 'Segundo' }] });
    expect(fieldErrorsFromApi(err, fields)).toEqual({ name: 'Primero' });
  });

  it('sin información de campos devuelve vacío', () => {
    expect(fieldErrorsFromApi(api({}), fields)).toEqual({});
  });
});

describe('useZodForm', () => {
  it('set actualiza el valor, limpia el error del campo y marca dirty', async () => {
    const { result } = renderHook(() => useZodForm({ schema, initialValues }));
    expect(result.current.dirty).toBe(false);
    await act(async () => {
      await result.current.submit(vi.fn())();
    });
    expect(result.current.errors.name).toBe('validation.required');
    act(() => result.current.set('name', 'Ana'));
    expect(result.current.values.name).toBe('Ana');
    expect(result.current.errors.name).toBeUndefined();
    expect(result.current.errors.email).toBe('validation.email.invalid');
    expect(result.current.dirty).toBe(true);
  });

  it('setValues acepta un parche y una función', () => {
    const { result } = renderHook(() => useZodForm({ schema, initialValues }));
    act(() => result.current.setValues({ name: 'A' }));
    act(() => result.current.setValues((prev) => ({ email: `${prev.name}@x.test` })));
    expect(result.current.values).toEqual({ name: 'A', email: 'A@x.test' });
  });

  it('si no valida, no llama a la función y traduce con translate', async () => {
    const fn = vi.fn();
    const translate = (m: string) => `T:${m}`;
    const { result } = renderHook(() => useZodForm({ schema, initialValues, translate }));
    await act(async () => {
      await result.current.submit(fn)();
    });
    expect(fn).not.toHaveBeenCalled();
    expect(result.current.errors).toEqual({ name: 'T:validation.required', email: 'T:validation.email.invalid' });
  });

  it('valida y entrega los datos parseados; maneja submitting', async () => {
    const fn = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useZodForm({ schema, initialValues: { name: 'Ana', email: 'ana@prueba.test' } }));
    const preventDefault = vi.fn();
    await act(async () => {
      await result.current.submit(fn)({ preventDefault } as never);
    });
    expect(preventDefault).toHaveBeenCalled();
    expect(fn).toHaveBeenCalledWith({ name: 'Ana', email: 'ana@prueba.test' });
    expect(result.current.submitting).toBe(false);
    expect(result.current.formError).toBeNull();
  });

  it('un ApiRequestError con campos se mapea a errors y queda en formError', async () => {
    const error = api({ fieldErrors: { email: 'Ya existe' } }, 409);
    const { result } = renderHook(() => useZodForm({ schema, initialValues: { name: 'Ana', email: 'ana@prueba.test' } }));
    await act(async () => {
      await result.current.submit(() => Promise.reject(error))();
    });
    expect(result.current.errors).toEqual({ email: 'Ya existe' });
    expect(result.current.formError).toBe(error);
    expect(result.current.submitting).toBe(false);
  });

  it('un error cualquiera queda en formError sin tocar los campos', async () => {
    const { result } = renderHook(() => useZodForm({ schema, initialValues: { name: 'Ana', email: 'ana@prueba.test' } }));
    await act(async () => {
      await result.current.submit(() => Promise.reject(new Error('caída')))();
    });
    expect(result.current.errors).toEqual({});
    expect((result.current.formError as Error).message).toBe('caída');
    act(() => result.current.setFormError(null));
    expect(result.current.formError).toBeNull();
  });

  it('un ApiRequestError sin campos reconocibles no pinta errores', async () => {
    const { result } = renderHook(() => useZodForm({ schema, initialValues: { name: 'Ana', email: 'ana@prueba.test' } }));
    await act(async () => {
      await result.current.submit(() => Promise.reject(api({}, 500)))();
    });
    expect(result.current.errors).toEqual({});
  });

  it('con errores de validación, el foco va al primer campo inválido', async () => {
    function Harness() {
      const { values, set, errors, submit } = useZodForm({ schema, initialValues });
      return (
        <form onSubmit={submit(() => undefined)}>
          <input aria-label="name" value={values.name} onChange={(e) => set('name', e.target.value)} aria-invalid={errors.name ? true : undefined} />
          <input aria-label="email" value={values.email} onChange={(e) => set('email', e.target.value)} aria-invalid={errors.email ? true : undefined} />
          <button type="submit">Enviar</button>
        </form>
      );
    }
    render(<Harness />);
    await userEvent.click(screen.getByText('Enviar'));
    await vi.waitFor(() => expect(screen.getByLabelText('name')).toHaveFocus());
  });
});

describe('useSchemaMessages', () => {
  it('traduce las claves conocidas y deja pasar las otras', () => {
    const messages = { validation: { required: 'Obligatorio' } };
    const { result } = renderHook(() => useSchemaMessages(), {
      wrapper: ({ children }) => (
        <NextIntlClientProvider locale="es" messages={messages}>
          {children}
        </NextIntlClientProvider>
      ),
    });
    expect(result.current('validation.required')).toBe('Obligatorio');
    expect(result.current('texto libre')).toBe('texto libre');
  });
});
