-- Corrige la fecha de saldado de las liquidaciones ya cobradas.
--
-- Hasta ahora, al completarse el pago de una liquidacion se guardaba el momento
-- en que se registraba en el sistema y no la fecha en que se pago. Toda cobranza
-- cargada despues del hecho quedo con dias de atraso que no existieron, y de esa
-- fecha dependen la puntualidad, el puntaje del inquilino y el resumen de cierre.
--
-- Se toma la fecha del ultimo pago de cada liquidacion, que es cuando quedo
-- efectivamente saldada. Solo alcanza filas que tienen pagos y una fecha distinta.
UPDATE "liquidaciones" AS l
SET "paidAt" = ultimo."paidAt"
FROM (
    SELECT "liquidacionId", MAX("paidAt") AS "paidAt"
    FROM "payments"
    GROUP BY "liquidacionId"
) AS ultimo
WHERE ultimo."liquidacionId" = l."id"
  AND l."paidAt" IS NOT NULL
  AND l."paidAt" <> ultimo."paidAt";
