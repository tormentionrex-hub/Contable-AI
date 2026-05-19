# Por qué usamos Vitest (y no Jest) en FWD Contable AI

> **TL;DR**: nuestro motor es TypeScript + ESM nativo + Node 24. Vitest está pensado exactamente para ese stack y anda sin configuración. Jest sigue siendo un mundo CommonJS al que hay que forzar a entender ESM con flags experimentales, transformers extras y workarounds. Mismo API, menos dolor.

---

## 1. El stack del motor (lo que define la decisión)

El motor (`backend/`) corre así:

| Cosa | Valor | Implicación |
|---|---|---|
| Lenguaje | TypeScript estricto | Hay que transpilar antes de ejecutar |
| Sistema de módulos | ESM nativo (`"type": "module"`) | `import`/`export`, no `require` |
| Estilo de imports | `import { x } from './lib/y.js'` (con extensión) | Obligatorio en ESM |
| API moderna | `import.meta.url`, top-level `await` | Solo existe en ESM |
| Node | 24.x | ESM 100 % estable, CommonJS legacy |
| Runner de dev | `tsx watch` | Ejecuta `.ts` directo sin compilar |

Esa combinación se llama **TypeScript ESM moderno**. Es la stack default para proyectos nuevos en 2026.

---

## 2. Por qué Jest no es la elección obvia hoy

Jest nació en 2014 cuando todo era CommonJS (`require`). Su soporte de ESM se llama "experimental" desde 2021 y, aunque mejoró, sigue marcado así en la documentación oficial.

Para que Jest funcione contra **este motor** habría que:

1. Agregar `ts-jest` (o `@swc/jest`) como transformer.
2. Crear `jest.config.ts` con `preset: 'ts-jest/presets/default-esm'`, `extensionsToTreatAsEsm: ['.ts']` y un `moduleNameMapper` que reescriba `'./foo.js'` → `'./foo'` para que el resolver de Jest no rompa.
3. Correr siempre con `NODE_OPTIONS=--experimental-vm-modules npm test` (sigue marcado experimental en 2026).
4. Lidiar con `import.meta.url`: en Jest a veces es `undefined` o apunta a una URL falsa, hay que mockearlo.
5. Reemplazar `import { describe, it, expect } from 'vitest'` por `import { describe, it, expect } from '@jest/globals'`.
6. Aceptar que cada upgrade de Node o Jest puede romper la cadena de transforms.

Costo estimado en horas para dejarlo andando: **30–60 minutos de tuneo** y entre 0 y 3 horas más si aparece un edge case. **Ganancia funcional: cero** — los tests harían exactamente lo mismo que ya hacen con Vitest.

---

## 3. Por qué Vitest encaja en el primer intento

Vitest fue creado en 2021 por el equipo de Vite **específicamente para evitar el dolor anterior**. Por dentro usa el mismo transformer que Vite/esbuild, que ya entiende:

- TypeScript sin `ts-jest`.
- ESM nativo sin flags.
- `import.meta.url` real.
- Imports con extensión `.js`.

Para nuestro proyecto eso se traduce en:

- **Cero archivos de transform.** No hay `ts-jest`, no hay `babel.config`, no hay `@swc/jest`.
- **Cero variables de entorno raras.** `npm test` arranca y corre.
- **Mismas APIs de Jest.** `describe`, `it`, `expect`, `beforeAll`, `vi.mock` ≈ `jest.mock`, `vi.fn` ≈ `jest.fn`. Si algún día migramos a Jest, los archivos de test no cambian casi nada.
- **Watch mode rápido.** `npm run test:watch` re-corre solo el test que tocaste, en milisegundos, gracias al HMR de Vite.
- **Reporte legible.** Output limpio, sin la verbosidad clásica de Jest.

---

## 4. Lo que esto significa para el proyecto en concreto

### Hoy (Fase 1)
- 6 tests pasando en **~62 s** total.
- 3 tests de PDFs golden que llaman a **Claude real** y comparan la salida contra los valores conocidos del contador.
- 3 tests unitarios de `reconcileFactura` que validan la matemática de IVA.
- Sin un solo archivo de configuración fuera de `package.json`.

### Mañana (Fases 2-5)
A medida que se agreguen MCPs, endpoints, frontend y workflows, los tests crecen. Vitest sostiene esto sin ajustes:

- **MCPs custom** (`mcp-bccr`, `mcp-hacienda-cr`, `mcp-fwd-db`): cada uno será un paquete TS aparte. Vitest los descubre solo si compartimos `package.json` o agregamos `workspace` config.
- **Frontend React + Vite**: ya usa Vite por defecto. Vitest se enchufa al mismo `vite.config.ts` y los tests del frontend reusan toda la cadena.
- **Tests de integración con SQLite real**: los tres tests de `reconciliation.test.ts` ya escriben/leen DB. La opción `fileParallelism: false` + `sequence.concurrent: false` los serializa y evita choques. Eso ya está documentado en `package.json`.

---

## 5. Equivalencias con Jest (para que no se sienta lejano)

| Jest | Vitest | Notas |
|---|---|---|
| `jest.config.ts` | `package.json` clave `"vitest"` o `vitest.config.ts` | Misma idea |
| `jest --watch` | `vitest` | Watch por default |
| `import { jest } from '@jest/globals'` | `import { vi } from 'vitest'` | Mismo objetivo |
| `jest.fn()` | `vi.fn()` | Idem |
| `jest.mock('foo')` | `vi.mock('foo')` | Idem |
| `jest.setTimeout(30_000)` | `testTimeout: 30_000` en config o tercer arg de `it()` | Idem |
| `describe / it / expect / beforeAll` | `describe / it / expect / beforeAll` | **Iguales** |
| `--coverage` | `--coverage` | Idem (v8 o istanbul) |
| Snapshots `toMatchSnapshot()` | `toMatchSnapshot()` | Idem |

La curva de aprendizaje, viniendo de Jest, es **prácticamente nula**. Cambia el nombre del paquete, nada más.

---

## 6. Nuestra configuración (qué hace cada línea)

Toda la config vive en `backend/package.json`, clave `"vitest"`:

```json
{
  "vitest": {
    "include": ["tests/**/*.test.ts"],
    "testTimeout": 120000,
    "hookTimeout": 60000,
    "fileParallelism": false,
    "sequence": { "concurrent": false },
    "env": {
      "NODE_ENV": "test",
      "LOG_LEVEL": "warn"
    }
  }
}
```

| Opción | Por qué |
|---|---|
| `include` | Solo corremos tests dentro de `backend/tests/`. Evita que tome archivos `.test.ts` accidentales en `node_modules`. |
| `testTimeout: 120_000` | Cada test que llama a Claude tarda 18–29 s. El default de 5 s no alcanza. |
| `hookTimeout: 60_000` | `beforeAll` corre `initDb()` — margen para arranque frío de SQLite. |
| `fileParallelism: false` | Los tests comparten `backend/data/fwd-contable.db`. Sin esto se pisan los `INSERT OR REPLACE`. |
| `sequence.concurrent: false` | Refuerzo del anterior: serializa además los `it()` dentro de un mismo archivo. |
| `env.NODE_ENV: "test"` | El logger se vuelve silencioso (ver `src/lib/logger.ts`). |
| `env.LOG_LEVEL: "warn"` | Override fino: si querés debug, usá `LOG_LEVEL=debug npm test`. |

---

## 7. Comandos del día a día

```powershell
cd "C:\Users\torme\OneDrive\Desktop\FWD Contable AI\backend"

# Correr toda la suite (lo que usa CI/aceptación)
npm test

# Watch: re-corre solo lo que cambia
npm run test:watch

# Un solo test por nombre
npx vitest run -t "CSU Rompope"

# Solo un archivo
npx vitest run tests/reconciliation.test.ts

# Con logs detallados
LOG_LEVEL=debug npm test          # bash / git-bash
$env:LOG_LEVEL='debug'; npm test  # PowerShell
```

---

## 8. ¿Y si en el futuro alguien quiere Jest?

Es factible. El procedimiento sería:

1. `npm uninstall vitest && npm install --save-dev jest ts-jest @types/jest`.
2. En los archivos `.test.ts`, reemplazar `from 'vitest'` por `from '@jest/globals'`.
3. Convertir `vi.mock(...)` en `jest.mock(...)` (cero usos hoy — los tests no mockean).
4. Crear `jest.config.ts` con preset ESM (ver sección 2).
5. Cambiar el script `"test": "vitest run"` por `"test": "NODE_OPTIONS=--experimental-vm-modules jest"`.

Como los tests no usan ninguna feature exótica, el costo principal es **arreglar la cadena de transforms**, no reescribir lógica.

---

## 9. Resumen para el archivo

| Pregunta | Respuesta corta |
|---|---|
| ¿Por qué Vitest y no Jest? | TS + ESM + Node 24 = Vitest funciona en frío, Jest pide tuneo experimental. |
| ¿Está aprobado en CLAUDE.md? | Sí, lista oficial §13 de dependencias. |
| ¿Cambia algo para alguien que ya sabía Jest? | Solo el nombre. La API es la misma. |
| ¿Es estable? | Sí. Vitest 2.x (la que usamos) es producción desde 2024. La 1.x ya tenía millones de descargas. |
| ¿Lo usan proyectos serios? | Vite, Vue, Nuxt, Astro, SvelteKit, Remix, Solid — toda la generación moderna de frameworks. |
| ¿Cuánto cuesta migrar a Jest si nos arrepentimos? | 30–60 min, tests no se reescriben. |

Documentado para que cualquiera que tome este repo entienda la elección sin tener que repetir la conversación.
