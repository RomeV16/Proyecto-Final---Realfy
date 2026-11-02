-- migracion: 20261102235100_depositos
-- depositos: cada contrato con importe de depósito pasa a `contract_deposits` con una
-- cuota cobrada, y no se crea ninguna liquidación de egreso. Devuelve filas SOLO si
-- algo salió mal.

SELECT 'contrato con depósito sin migrar' AS problema, c."id" AS detalle
FROM "contracts" c
WHERE c."depositAmount" IS NOT NULL AND c."depositAmount" > 0
  AND NOT EXISTS (SELECT 1 FROM "contract_deposits" d WHERE d."contractId" = c."id")

UNION ALL
SELECT 'depósito sin contrato con importe', d."id"
FROM "contract_deposits" d
JOIN "contracts" c ON c."id" = d."contractId"
WHERE c."depositAmount" IS NULL OR c."depositAmount" <= 0

UNION ALL
SELECT 'importe o moneda distintos al contrato', d."id"
FROM "contract_deposits" d
JOIN "contracts" c ON c."id" = d."contractId"
WHERE d."amount" <> c."depositAmount"
   OR d."currency" <> COALESCE(c."depositCurrency", c."rentCurrency")

UNION ALL
SELECT 'depósito sin una cuota cobrada por el total', d."id"
FROM "contract_deposits" d
WHERE (SELECT count(*) FROM "contract_deposit_installments" i WHERE i."depositId" = d."id") <> 1
   OR (SELECT COALESCE(sum(i."amount"), 0) FROM "contract_deposit_installments" i
       WHERE i."depositId" = d."id" AND i."paidAt" IS NOT NULL) <> d."amount"

UNION ALL
SELECT 'depósito que no es del locador sin persona', d."id"
FROM "contract_deposits" d
WHERE d."heldBy" <> 'Locador' OR d."heldByPersonId" IS NOT NULL

UNION ALL
SELECT 'liquidación de egreso inesperada', m."id"
FROM "move_out_settlements" m;
