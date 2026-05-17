# Contexto ampliado del proyecto (post-lectura del Drive)

Este documento captura lo que aprendí leyendo el Drive "Taller de Contabilidad - Mayo 2026" para que no se pierda contexto entre sesiones.

## Forward Costa Rica es una **firma contable multi-cliente**

No es UN cliente final. Es una empresa que lleva los libros de **varias empresas**. Lo confirmé porque:

- Las facturas de muestra tienen como receptor a `FUNDACION CRC Endurance (3-006-696489)`.
- El workbook EEFF de muestra es de `SERVICIOS INTERNACIONALES, S.A. (3-101-813165)`.
- El prefijo `03.` en `03. Servicios Internacionales EEFF 032025.xlsm` sugiere numeración de cliente.

**Implicación para el sistema**: multi-tenant desde día 1. Cada empresa tiene:
- Su propio chart of accounts.
- Su propio Google Sheet machote.
- Su propio histórico de facturas.
- Sus propios EEFF.

**Decisión tomada**: arrancamos con **FUNDACION CRC Endurance** como única empresa piloto. La DB soporta multi-tenancy desde el inicio.

## La contabilidad real del contador es mucho más grande que los 3 proyectos del catálogo

El xlsm `03. Servicios Internacionales EEFF 032025.xlsm` tiene **13 hojas**:

| Hoja | Contenido |
|---|---|
| PORTADA | Nombre y cédula de la empresa, periodo |
| TC | Tipo de cambio mensual histórico (desde Dec 2021) |
| Parámetros | TC del mes actual y anterior, año actual |
| NOTAS FORMATO | Plantilla en blanco para notas a EEFF |
| BBCC | Balanza de Comprobación (~1500 cuentas con saldos en CRC y USD) |
| BSF | Balance de Situación Financiera (Activos, Pasivos, Patrimonio en CRC y USD) |
| ERI | Estado de Resultados Integral (Ingresos − Gastos) |
| ECP | Estado de Cambios en el Patrimonio |
| EFE | Estado de Flujos de Efectivo |
| HojaTrabajoFlujo | Working sheet para construir el EFE |
| NOTAS | Notas a los Estados Financieros |
| Detalle de Gastos | Matriz cuenta × mes (Enero a Diciembre) |
| Detalle Ingresos | Matriz cuenta × mes |

### Flujo contable real del contador

```
Facturas (PDFs, XMLs)
   ↓ (DocScan extrae)
Asiento contable (con código de cuenta + IVA)
   ↓ (clasificación por cuenta)
Detalle de Gastos / Detalle Ingresos  (matrices mensuales)
   ↓ (acumulación)
BBCC — Balanza de Comprobación        (todas las cuentas con saldos)
   ↓ (consolidación)
BSF / ERI / ECP / EFE                  (Estados Financieros)
   ↓ (descripción)
NOTAS                                  (explican cada partida importante)
```

**El catálogo del taller cubre solo los 2 primeros pasos** (DocScan → Asiento, sin clasificación de cuenta).

### Lo que el sistema actual hará vs. lo que NO hará

| Función | ¿En scope? |
|---|---|
| Extraer datos de factura (PDF/XML) | ✅ Fase 1 |
| Clasificar tarifa IVA (0/1/2/4/13/Exento) | ✅ Fase 1 |
| Reconciliar IVA contra pie de factura | ✅ Fase 1 |
| Escribir en machote "Reintegro de Caja Chica" | ✅ Fase 1-2 |
| Validar cédula contra padrón Hacienda | ✅ Fase 2 |
| Multi-moneda con tipo de cambio BCCR | ✅ Fase 2 |
| Chat NL→SQL del contador | ✅ Fase 3 |
| **Clasificación cuenta contable** | ⏳ Fase 5+ |
| Generación de asientos automáticos | ⏳ Futuro |
| Balanza de Comprobación | ⏳ Futuro |
| Estados Financieros completos (BSF/ERI/ECP/EFE) | ⏳ Futuro |
| Notas a EEFF | ⏳ Futuro |
| Planillas, CCSS, Renta | ⏳ Futuro |

## Chart of accounts costarricense (estructura observada)

Formato: `D-S-GG-CC-DD-EE` (12 dígitos en 6 grupos).

| Dígito | Significado |
|---|---|
| **1** | 1=Activo  2=Pasivo  3=Patrimonio  4=Ingresos  6=Gastos  7=Otros Ingresos  8=Otros Gastos |
| **2** | Subgrupo: 1=Corriente · 2=No Corriente · 1/2 según subgrupo |
| **3-4** | Categoría (Caja y Bancos, Cuentas por Cobrar, Inventarios, etc.) |
| **5-6** | Subcategoría |
| **7-8** | Cuenta auxiliar |
| **9-10** | Sub-cuenta |
| **11-12** | Item específico |

### Ejemplos reales observados

```
1-1-01-01-04-01  Caja Chica
1-1-01-02-02-01  BCT # 1140288 Cta. ¢  (banco en colones)
1-1-01-02-02-02  BCT # 1140289 Cta. $  (banco en dólares)
1-1-05-05-05-00  IVA Crédito Fiscal al 13% (IVA pagado en compras)
1-1-02-01-01-00  CxC Clientes Comerciales
2-1-01-01-01-00  Cuentas por pagar Proveedores Locales
2-1-03-03-05-00  IVA Débito Fiscal al 13% (IVA cobrado en ventas)
4-1-01-02-02-00  Ingresos por servicios contables
6-2-02-01-03-01  Uniformes (gasto)
6-2-02-04-00-00  Transporte y Viáticos
8-1-01-03-00-00  Gasto por Diferencial Cambiario
```

Cuando lleguemos a Fase 5+ de tagging automático, el agente sugerirá uno de estos códigos por línea de factura.

## Asientos contables modelo (4 patrones canónicos)

Del archivo `Datos de información.xlsx`:

### Venta de servicios al contado

```
Débito  1-1-01-02-02-02  BCT # 1140289 Cta. $        $5,000.00
Crédito 4-1-01-02-02-00  Ingresos por servicios                $4,424.78
Crédito 2-1-03-03-05-00  IVA Débito Fiscal al 13%              $  575.22
```

### Venta de servicios al crédito (plazo 30 días, mora 5%)

```
Débito  1-1-02-01-01-00  CxC Clientes Comerciales    $5,000.00
Crédito 4-1-01-02-02-00  Ingresos por servicios                $4,424.78
Crédito 2-1-03-03-05-00  IVA Débito Fiscal al 13%              $  575.22
```

### Compra/Gasto al contado

```
Débito  6-2-02-01-03-01  Uniformes                   $2,433.63
Débito  1-1-05-05-05-00  IVA Crédito Fiscal al 13%   $  316.37
Crédito 1-1-01-02-02-02  BCT # 1140289 Cta. $                  $2,750.00
```

### Compra/Gasto al crédito (plazo 30 días, mora 5%)

```
Débito  6-2-02-01-03-01  Uniformes                   $2,433.63
Débito  1-1-05-05-05-00  IVA Crédito Fiscal al 13%   $  316.37
Crédito 2-1-01-01-01-00  CxP Proveedores Locales               $2,750.00
```

## Brackets fiscales costarricenses (referencia)

### Renta de salarios (mensual)

| Desde | Hasta | % | Rebajo |
|---|---|---|---|
| 0 | 918.000 | 0 % | 0 |
| 918.000 | 1.347.000 | 10 % | 42.900 |
| 1.347.000 | 2.364.000 | 15 % | 152.550 |
| 2.364.000 | 4.727.000 | 20 % | 472.600 |
| 4.727.000 | 5.000.000 | 25 % | 68.250 |

### Cargas sociales

- Trabajador: **10,83 %**
- Patrono: **26,83 %**
- Total: **37,66 %**

### Trabajador independiente (anual, sobre utilidad neta)

| Desde | Hasta | % |
|---|---|---|
| 0 | 6.244.000 | 0 % |
| 6.244.000 | 8.329.000 | 10 % |
| 8.329.000 | 10.414.000 | 15 % |
| 10.414.000 | 20.872.000 | 20 % |
| 20.872.000 | en adelante | 25 % |

### Sociedades

- Si renta bruta < ₡119.174.000:
  - 5 % hasta ₡5.621.000
  - 10 % hasta ₡8.433.000
  - 15 % hasta ₡11.243.000
  - 20 % hasta ₡25.000.000
- Si renta bruta > ₡119.174.000: **30 % flat**

### Créditos fiscales

- Por cada hijo: ₡1.710/mes (₡20.520/año)
- Por cónyuge: ₡2.590/mes (₡31.080/año)

### Otros impuestos

- **Renta de Capital Inmobiliario (alquileres)**: 15 % sobre 85 % del bruto (= 12,75 % efectivo)
- **Impuesto Sociedades (anual)**: ₡115.500 (pequeñas) / ₡231.500 (medianas) / ₡69.330 (inactivas)
- **Timbre Educación y Cultura**: calculado sobre patrimonio
