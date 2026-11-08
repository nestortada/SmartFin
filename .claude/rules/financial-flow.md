---
paths:
  - "src/modules/*/useCases/**/*.ts"
  - "src/modules/*/types/**/*.ts"
  - "src/shared/types/finance.ts"
  - "src/shared/utils/exactCopCents.ts"
  - "src/shared/utils/copAmountInput.ts"
  - "src/shared/utils/transactionDate.ts"
---

# Flujo financiero: antes de cambiar comportamiento

Antes de cambiar comportamiento observable en estos archivos:

- Identifica las entradas (formulario, acción rápida, IA, mantenimiento), los consumidores, la persistencia y las proyecciones afectadas: dashboard, reportes, respaldo CSV e IA.
- Declara si el cambio es una refactorización equivalente o un cambio financiero funcional. Un cambio funcional requiere aprobación explícita del usuario antes de implementarlo.
- Nombra los invariantes afectados y cómo comprobarás que se conservan.
- Consulta la skill `smartfin-financial-domain` solo si hay impacto financiero; si no lo hay, dilo.
- Revisa las pruebas existentes del flujo y define las regresiones antes de editar.
