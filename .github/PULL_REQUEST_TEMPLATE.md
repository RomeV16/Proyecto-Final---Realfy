## Qué cambia y por qué

<!-- Una o dos frases. El detalle va en los commits. -->

Cierra #N

## Lista de verificación

### Trazabilidad
- [ ] El issue está vinculado (`#N`), con etiqueta (`requisito`, `defecto` o `feedback`) y origen (CI, revisión o piloto).
- [ ] Hay un CP con el resultado esperado fijado antes de ejecutarlo (`docs/calidad/05-casos-de-prueba.md`).
- [ ] Si corrige un defecto: hay un DEF-nn y una prueba de regresión que falla antes del cambio (rojo) y pasa después (verde).

### Pruebas
- [ ] Cada endpoint nuevo o modificado tiene prueba unitaria y e2e, con RBAC (rol permitido y rol rechazado) y aislamiento entre inmobiliarias.
- [ ] Los errores usan los códigos de dominio del ADR-0005.
- [ ] Todo modelo nuevo con `tenantId` está en `TENANT_SCOPED_MODELS` y en la limpieza de las pruebas e2e (ADR-0006).

### Migraciones
- [ ] El SQL de la migración empieza con `--` o con SQL (nunca con una línea de URL).
- [ ] Probada sobre una base vacía y sobre datos sintéticos con la forma real. El plan de reversa quedó anotado en el PR.
- [ ] Toda migración actualiza `docs/tesis/03-modelo-datos.md` y la lista del ADR-0006.

### Código
- [ ] Textos de interfaz en `es.json` y `en.json` (mismas claves en ambos).
- [ ] Se reutilizó antes de escribir: helpers de `common/`, `shared/` y `components/ui`; sin copias.
- [ ] Si un dato se reemplaza por otro, cambian todos los que lo leen.

### Documentación y repositorio
- [ ] La documentación va en este mismo PR (manual de usuario, `docs/api.md`, ADR, `docs/calidad/`) cuando corresponde.
- [ ] No hay datos personales reales (ni en pruebas, ni en fixtures, ni en capturas).
- [ ] No se incluye `tsconfig.tsbuildinfo`.
