# Golden Fixtures

PDFs reales del cliente FUNDACION CRC Endurance. Usados como golden set para tests del agente DocScan.

| Archivo | Dialecto | Caso de prueba |
|---|---|---|
| `50626112500310200722315100046010000285222100000000.pdf` | CSU FE v4.4 | **Tarifa mixta sin marca** (IVA 1% + IVA 13% en misma factura, columna IMP vacía). Inferencia obligatoria. |
| `FE CONFITES OH 22 NOVIEMBRE 2025.pdf` | CSU FE v4.4 | Tarifa única 13%, IVA derivado del diferencial. |
| `FE PEQUEÑO MUNDO2  CC MAYO 2025.pdf` | ALPEMUSA FE v4.3 | Ticket con tarifa marcada por línea. Descripción multilinea. |
| `Caja Chica Santa Ana Julio 2024.pdf` | Multi-factura (10 pág, 6 facturas) | **Splitter previo**: detectar dónde empieza/termina cada factura. Incluye OCR degradado (página 4 con anotación a lápiz). |

## Resultados esperados (resumen)

### CSU Rompope
- 2 líneas
- Tarifas: 1% (SALS CRI LIZ) + 13% (ROMPOPE)
- Total: ₡25.970,00
- Confianza: ≥ 0.9

### CSU Confites OH
- 1 línea (SUPER SURTID)
- Tarifa: 13%
- Total: ₡3.760,00

### Pequeño Mundo Zapote
- 1 línea (Caja heavy duty plástica 100lt)
- Tarifa marcada: 13%
- Total: ₡6.900,00

### Caja Chica Santa Ana (6 facturas)
1. Pequeño Mundo Guachipelín: 4 líneas (3× IVA 1% + 1× IVA 13%), total ₡16.500
2. PriceSmart Santa Ana: 6 líneas (5×G + 1×P), total ₡39.970
3. Market Río Oro **escaneado con anotación a lápiz**: 1 línea (Azúcar Don Harris), total ₡1.800, IVA inferido 1%. **OCR_DEGRADADO esperado**.
4. Market Río Oro formal: 1 línea (Té Frío Melocotón), total ₡2.650, IVA 13%
5. PriceSmart factura 119 (MS Popcorn): 1 línea G, total ₡10.595
6. PriceSmart factura 139: 8 líneas (7×G + 1×P), total ₡55.560
7. Almacenes El Rey: 3 líneas (Cartulina Opalina), total ₡6.750

Estos valores están verificados manualmente y deben usarse como ground truth en los tests.
