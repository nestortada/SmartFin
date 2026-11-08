---
name: verificar
description: Ejecuta en local las mismas comprobaciones que la CI de SmartFin (typecheck, lint, Jest estable, reproducciones, pruebas de hooks, copias de skills y git diff --check) y entrega una tabla con el resultado real de cada una. Solo se invoca a mano con /verificar; con el argumento «rapido» omite las suites de Jest.
disable-model-invocation: true
---

# Verificación local equivalente a la CI

Ejecuta las comprobaciones de `.github/workflows/ci.yml` en esta máquina para saber, antes de subir cambios, si la CI pasará. Informa de lo que realmente ocurrió: una comprobación que falla se reporta con su salida, nunca como «probablemente bien».

## Pasos

Desde la raíz del repositorio, en este orden (primero las rápidas, para detectar pronto los fallos baratos). Ejecuta cada comando aunque falle uno anterior, para tener el panorama completo.

| # | Comprobación | Comando |
|---|---|---|
| 1 | TypeScript | `npm run typecheck` |
| 2 | ESLint | `npm run lint` |
| 3 | Copias de skills (`.claude` frente a `.agents`) | `npm run skills:check` |
| 4 | Hooks de Claude Code | `node --test .claude/hooks/__tests__/dangerous-command-guard.test.cjs .claude/hooks/__tests__/reviewer-reminder.test.cjs` |
| 5 | Jest estable | `npm test -- --runInBand` |
| 6 | Reproducciones de defectos | `npm run test:reproductions -- --runInBand` |
| 7 | Espacios y conflictos en el diff | `git diff --check` |

Si el usuario pasó el argumento `rapido`, omite los pasos 5 y 6 y dilo en el resultado.

Notas para que el resultado local coincida con la CI:

- La CI ejecuta Jest con `TZ=America/Bogota`. Comprueba la zona local con `node -p "Intl.DateTimeFormat().resolvedOptions().timeZone"`; si no es `America/Bogota`, avisa de que las pruebas de fechas pueden diferir y ejecuta Jest con `TZ=America/Bogota` delante del comando.
- La suite estable tarda varios minutos: usa un tiempo de espera amplio (hasta 10 minutos) o ejecútala en segundo plano y espera la notificación.
- La CI también hace `npm ci` y comprueba el parche de `react-native-sqlite-storage`. No reinstales dependencias aquí: si una prueba falla por `node_modules`, indícalo como posible causa en lugar de ejecutar `npm ci` por tu cuenta.
- El paso de la CI «Working tree is unchanged» no aplica en local, porque el árbol puede tener cambios en curso. Si después de las pruebas `git status` muestra archivos nuevos que antes no estaban (por ejemplo, evidencias), menciónalos.

## Resultado

Termina con una tabla y una conclusión de una línea:

| Comprobación | Resultado |
|---|---|
| TypeScript | Sin errores / N errores |
| ESLint | N errores, N advertencias |
| Copias de skills | Idénticas / N diferencias |
| Hooks | n/n |
| Jest estable | suites y pruebas aprobadas, omitidas y fallidas |
| Reproducciones | n/n |
| `git diff --check` | Limpio / problemas |

Conclusión: «la CI debería pasar» solo si todo está en verde; si no, enumera qué falla y la primera línea útil de cada error. No corrijas nada durante la verificación salvo que el usuario lo pida.
