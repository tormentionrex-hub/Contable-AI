# Layout del Google Sheet "machote Forward CR"

El Sheet vive en Google Drive y es la **fuente de verdad visible** para el contador. SQLite es la copia interna para el chatbot. Tax-IVA escribe a ambos.

## Hoja 1 — "Reintegro Caja Chica"

Vista del contador. Idéntica al machote actual de Forward Costa Rica.

### Encabezado (filas 1-4, formato fijo)

| Fila | Contenido |
|------|-----------|
| 1 | Logo "Forward Costa Rica" (color morado #6B2C8F, imagen pegada) en columnas A-C |
| 2 | (vacío) |
| 3 | `Nombre:` (columna A) — celda libre para que el contador escriba; `Fecha:` (columna F) — auto-llenar con HOY() |
| 4 | (vacío) |

### Tabla de datos (fila 5 = headers, fila 6 en adelante = datos)

Headers exactos:

| Col | Header | Tipo | Notas |
|-----|--------|------|-------|
| A | **Fecha** | DATE (`dd/mm/yyyy`) | Fecha de emisión de la factura |
| B | **Proveedor** | TEXT | Nombre tal cual aparece en factura |
| C | **Cédula física o jurídica** | TEXT | Sin guiones: `3101231707` |
| D | **No. Factura** | TEXT | `Consecutivo` de Hacienda (20 dígitos) o número interno |
| E | **Descripción** | TEXT | "N artículos (IVA X%)" si hay agrupación, sino descripción del primer artículo |
| F | **Moneda** | TEXT | `CRC` o `USD` |
| G | **Monto del documento** | NUMBER (₡#.##0,00) | Total tal cual lo emite el proveedor, en moneda original |
| H | **Monto Gravado** | NUMBER (₡#.##0,00) | Base sin IVA |
| I | **% IVA** | NUMBER (0%) | `0`, `1`, `2`, `4`, `13` (NO `Exento` — eso va como fila aparte con 0) |
| J | **Monto IVA** | NUMBER (₡#.##0,00) | IVA calculado |
| K | **Total** | NUMBER (₡#.##0,00) | Gravado + IVA |

### Pie (al final de los datos)

| Fila | Contenido |
|------|-----------|
| Última+2 | `Total USD: ₡XXX` — celda calculada `=SUMIF(F:F,"USD",K:K)` |
| Última+3 | `Total CRC: ₡XXX` — celda calculada `=SUMIF(F:F,"CRC",K:K)` |

### Regla de agrupación

Si una factura tiene **múltiples tarifas de IVA**, se escribe **una fila por tarifa**, no una por línea de producto. Esto preserva el formato actual del contador.

Ejemplo CSU Rompope (IVA mixto 1% + 13%):

| Fecha | Proveedor | Cédula | No. Factura | Descripción | Moneda | Monto doc. | Gravado | % IVA | IVA | Total |
|---|---|---|---|---|---|---|---|---|---|---|
| 26/11/2025 | CORPORACION SUPERMERCADOS UNIDOS S.R.L. | 3102007223 | 15100046010000285222 | 1 artículo (IVA 1%) | CRC | 25.970,00 | 2.504,95 | 1% | 25,05 | 2.530,00 |
| 26/11/2025 | CORPORACION SUPERMERCADOS UNIDOS S.R.L. | 3102007223 | 15100046010000285222 | 1 artículo (IVA 13%) | CRC | 25.970,00 | 20.743,36 | 13% | 2.696,64 | 23.440,00 |

- Las columnas `Fecha`, `Proveedor`, `Cédula`, `No. Factura` y `Monto del documento` se REPITEN en ambas filas (es el total de la factura completa).
- `Descripción`, `Gravado`, `% IVA`, `IVA`, `Total` son por tarifa.
- La suma de la columna `Total` por factura debe igualar el `Monto del documento`.

## Hoja 2 — "Detalle Hacienda"

Vista fiscal completa. 24 columnas oficiales de Hacienda CR.

| Col | Header |
|---|---|
| A | Clave (50 dígitos) |
| B | Numeración Consecutiva (20 dígitos) |
| C | Tipo Documento (FE/TE/NC/ND) |
| D | Consecutivo Nota Referencia |
| E | Actividad Económica |
| F | Fecha Emisión |
| G | Fecha de carga en el sistema |
| H | Nombre Proveedor |
| I | Tipo Cédula |
| J | Cédula Proveedor |
| K | Estado Hacienda |
| L | Moneda |
| M | Tipo Cambio |
| N | Total Gravado |
| O | Total Exento |
| P | Descuento |
| Q | SubTotal |
| R | Sub total Colones |
| S | Otros Cargos |
| T | Porcentaje Impuesto |
| U | Total Impuesto |
| V | Impuesto en Colones |
| W | Total Factura |
| X | Total Colones |

**Una fila por factura completa** (no por línea, no por tarifa). El detalle por línea queda en SQLite.

## Hoja 3 — "Resumen por Tarifa"

Tabla pivote calculada con fórmulas (no se escribe desde el motor):

| Tarifa IVA | # Líneas | Base Gravable CRC | Monto IVA CRC | Total con IVA CRC | % del Total |
|---|---|---|---|---|---|
| 0%  | `=COUNTIF(...)` | `=SUMIF(...)` | `=SUMIF(...)` | `=...` | `=...%` |
| 1%  | ... | ... | ... | ... | ... |
| 2%  | ... | ... | ... | ... | ... |
| 4%  | ... | ... | ... | ... | ... |
| 13% | ... | ... | ... | ... | ... |
| **Total** | suma | suma | suma | suma | 100% |

Las fórmulas referencian la Hoja "Reintegro Caja Chica" (filtrando por columna I = `% IVA`).

## Hoja 4 — "Para Revisión" (auto-filtrada)

Vista filtrada de "Reintegro Caja Chica" donde `requiere_revision_humana = TRUE`. El contador la abre cuando algo necesita verificación manual.

Columnas: las mismas de Hoja 1 + columna extra **"Motivo de revisión"** (`OCR_DEGRADADO`, `RECONCILIACION_FALLIDA`, etc., traducido a texto humano: "El escaneo está borroso, verificá el monto", "Las tarifas no cuadran con el pie de la factura").

## Estilo visual

- Header de la tabla en color morado Forward (#6B2C8F) con texto blanco.
- Filas alternadas en gris claro (#F4F4F4) para legibilidad.
- Columnas de montos: alineadas a la derecha, formato `₡#.##0,00`.
- Columna `% IVA`: alineada al centro, formato `0%`.
- Celdas con `requiere_revision_humana = TRUE` (Hoja 1): fondo amarillo claro (#FFF3CD).
