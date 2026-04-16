# Realfy - Diagrama de Gantt del proyecto final

Duracion total: 8 meses  
Periodo propuesto: abril a noviembre de 2026  
Fuente de alcance: anteproyecto REALFY y presentacion Realfy.pptx

## Criterio de planificacion

El cronograma esta organizado para una tesis de software con entregas incrementales. Primero se cierra el alcance y la arquitectura, luego se construye el nucleo operativo de gestion inmobiliaria, despues se integran los modulos de negocio y finalmente se completa la inteligencia artificial, analytics, pruebas, documentacion y presentacion final.

No se incluyen funcionalidades declaradas fuera de alcance en el anteproyecto: firma digital certificada, aplicacion movil nativa, publicacion en portales externos, operacion fuera de Argentina, consulta automatica de deuda en organismos recaudadores, scoring cruzado entre inmobiliarias ni prediccion de precios de mercado con modelos externos.

## Gantt

```mermaid
gantt
    title Realfy - Proyecto final de tesis 2026
    dateFormat  YYYY-MM-DD
    axisFormat  %b

    section Planificacion y diseno
    Relevamiento, validacion de alcance y objetivos            :a1, 2026-04-01, 2026-04-14
    Roles, casos de uso y criterios de aceptacion               :a2, 2026-04-08, 2026-04-24
    Arquitectura, modelo de datos y contratos de API            :a3, 2026-04-15, 2026-05-15
    Backlog, sprints y plan de seguimiento                      :a4, 2026-04-20, 2026-05-08
    Hito 1 - Alcance y arquitectura aprobados                   :milestone, h1, 2026-05-15, 0d

    section Base tecnica
    Configuracion de repositorio, entornos y CI                 :b1, 2026-05-01, 2026-05-29
    Autenticacion, roles y permisos                             :b2, 2026-05-11, 2026-06-05
    Multi-inmobiliaria, auditoria y logging                     :b3, 2026-05-25, 2026-06-19
    UI base, navegacion y dashboard inicial                     :b4, 2026-05-18, 2026-06-19

    section MVP operativo inmobiliario
    Gestion de propiedades, estados e imagenes                  :c1, 2026-06-01, 2026-06-26
    Personas, propietarios, inquilinos y garantes               :c2, 2026-06-08, 2026-07-03
    Contratos, garantias, documentos y plantillas               :c3, 2026-06-22, 2026-07-24
    Actualizacion de alquiler por IPC, UVA o valor manual       :c4, 2026-07-06, 2026-07-31
    Liquidaciones mensuales, impuestos, servicios y honorarios  :c5, 2026-07-13, 2026-08-07
    Registro de pagos y estados de deuda                        :c6, 2026-07-27, 2026-08-14
    Hito 2 - MVP operativo demostrable                          :milestone, h2, 2026-08-14, 0d

    section Gestion diaria y autogestion
    Morosidad, punitorios y derivacion legal                    :d1, 2026-08-03, 2026-08-28
    Reclamos, tickets de mantenimiento y proveedores            :d2, 2026-08-10, 2026-09-04
    Portal de autogestion para inquilinos                       :d3, 2026-08-24, 2026-09-18
    Notificaciones de vencimientos, deudas y cambios de estado  :d4, 2026-09-07, 2026-09-25

    section Modulos de negocio
    CRM, leads, pipeline e historial de interacciones           :e1, 2026-09-01, 2026-09-25
    Portal publico con templates y branding                     :e2, 2026-09-14, 2026-10-09
    Facturacion electronica via ARCA                            :e3, 2026-09-28, 2026-10-23
    Scoring interno de inquilinos y tasaciones                  :e4, 2026-10-05, 2026-10-23
    Importacion y exportacion con validacion de datos           :e5, 2026-10-12, 2026-10-30
    Hito 3 - Beta integrada                                     :milestone, h3, 2026-10-30, 0d

    section IA, analytics y cierre
    Dashboard de KPIs, ocupacion, rentabilidad y flujo de caja  :f1, 2026-10-05, 2026-10-30
    Panel de priorizacion diaria con IA                         :f2, 2026-10-19, 2026-11-06
    Resumen de gestion con IA al cierre de contrato             :f3, 2026-10-26, 2026-11-13
    Pruebas integrales, seguridad, rendimiento y correcciones   :f4, 2026-11-02, 2026-11-20
    Documentacion tecnica, manuales y demo                      :f5, 2026-11-09, 2026-11-25
    Informe final y preparacion de defensa                      :f6, 2026-11-16, 2026-11-30
    Hito 4 - Entrega final de tesis                             :milestone, h4, 2026-11-30, 0d
```

## Vista por meses

| Etapa / actividad principal | Abr | May | Jun | Jul | Ago | Sep | Oct | Nov | Entregable |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|---|
| Relevamiento, alcance, objetivos y casos de uso | X | X |  |  |  |  |  |  | Alcance funcional aprobado |
| Arquitectura, modelo de datos, APIs y backlog | X | X |  |  |  |  |  |  | Diseno tecnico y plan de sprints |
| Repositorio, entornos, CI, autenticacion y roles |  | X | X |  |  |  |  |  | Base tecnica operativa |
| Multi-inmobiliaria, auditoria, logging y UI base |  | X | X |  |  |  |  |  | Plataforma base navegable |
| Propiedades, estados, imagenes y busquedas |  |  | X |  |  |  |  |  | Modulo de propiedades |
| Personas, propietarios, inquilinos y garantes |  |  | X | X |  |  |  |  | Gestion de actores |
| Contratos, garantias, documentos y plantillas |  |  | X | X |  |  |  |  | Modulo de contratos |
| Actualizacion de alquiler por IPC, UVA o manual |  |  |  | X |  |  |  |  | Motor de actualizacion |
| Liquidaciones, impuestos, servicios y honorarios |  |  |  | X | X |  |  |  | Liquidacion mensual automatizada |
| Pagos, deuda, morosidad y punitorios |  |  |  | X | X |  |  |  | Gestion de cobranzas |
| Reclamos, tickets de mantenimiento y proveedores |  |  |  |  | X | X |  |  | Trazabilidad de mantenimiento |
| Portal de autogestion del inquilino |  |  |  |  | X | X |  |  | Portal con liquidaciones, pagos y tickets |
| Notificaciones automaticas |  |  |  |  |  | X |  |  | Alertas de vencimientos y cambios |
| CRM, leads, pipeline e interacciones |  |  |  |  |  | X |  |  | Gestion comercial |
| Portal publico personalizable |  |  |  |  |  | X | X |  | Publicacion propia de propiedades |
| Facturacion electronica via ARCA |  |  |  |  |  |  | X |  | Comprobantes electronicos |
| Scoring interno, tasaciones e importacion/exportacion |  |  |  |  |  |  | X |  | Modulos complementarios de gestion |
| Dashboard de analytics |  |  |  |  |  |  | X |  | KPIs de ocupacion, rentabilidad y caja |
| Panel de priorizacion diaria y resumen IA de contratos |  |  |  |  |  |  | X | X | Funciones de asistencia con IA |
| Pruebas integrales, seguridad, rendimiento y correcciones |  |  |  |  |  |  |  | X | Version candidata a entrega |
| Documentacion, demo, informe final y defensa |  |  |  |  |  |  |  | X | Entrega final de tesis |

## Hitos principales

| Fecha | Hito | Criterio de aceptacion |
|---|---|---|
| 15/05/2026 | Alcance y arquitectura aprobados | Roles, casos de uso, modelo de datos, APIs iniciales y backlog priorizado. |
| 14/08/2026 | MVP operativo demostrable | Propiedades, personas, contratos, actualizacion de alquileres, liquidaciones y pagos funcionando en entorno de prueba. |
| 30/10/2026 | Beta integrada | Gestion diaria, portal de inquilino, CRM, portal publico, facturacion ARCA, analytics y modulos complementarios integrados. |
| 30/11/2026 | Entrega final de tesis | Sistema probado, documentado, con demo preparada e informe final listo para presentacion. |

## Cadencia sugerida

- Sprints de 2 semanas con revision funcional al cierre de cada sprint.
- Demo mensual asociada a cada hito de avance.
- Congelamiento de alcance funcional al finalizar mayo para proteger la entrega de tesis.
- Noviembre reservado para integracion, correcciones, documentacion y defensa, evitando sumar nuevas funcionalidades en el cierre.
