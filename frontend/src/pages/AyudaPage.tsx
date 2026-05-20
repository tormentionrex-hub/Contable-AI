import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';

interface Seccion {
  id: string;
  titulo: string;
  resumen: string;
  contenido: ReactNode;
}

const SECCIONES: Seccion[] = [
  {
    id: 'que-es',
    titulo: '1. ¿Qué es Contable AI y para qué sirve?',
    resumen: 'Una herramienta que lee tus facturas y arma los reportes contables por vos.',
    contenido: (
      <>
        <p>
          <strong>Contable AI</strong> es un asistente que se encarga de tres tareas que
          hoy te toman horas a mano:
        </p>
        <ol>
          <li>
            <strong>Leer tus facturas</strong> (en PDF o XML) y sacar los datos
            importantes: fecha, proveedor, cédula, número, montos.
          </li>
          <li>
            <strong>Calcular el IVA</strong> de cada línea según las 6 tarifas
            costarricenses (0 %, 1 %, 2 %, 4 %, 13 %, Exento) y armar el Excel oficial.
          </li>
          <li>
            <strong>Responderte preguntas</strong> en lenguaje natural sobre la base
            contable: "¿cuánto se gastó en marzo?", "¿qué proveedor facturó más?", etc.
          </li>
        </ol>
        <p>
          Vos no tenés que saber programación, IA ni APIs. Solo subís facturas y leés
          el resultado. El sistema deja todo anotado en el Google Sheet de Forward y
          en tu base de datos local.
        </p>
      </>
    ),
  },
  {
    id: 'primer-dia',
    titulo: '2. Tu primer día con el sistema',
    resumen: '5 pasos sencillos para empezar.',
    contenido: (
      <>
        <ol className="help-steps">
          <li>
            <strong>Entrá con tu correo y contraseña.</strong> Si es la primera vez,
            te las da el administrador.
          </li>
          <li>
            <strong>Andá a <Link to="/upload">Subir facturas</Link>.</strong> Arrastrá
            tus PDFs o XMLs al recuadro grande del centro. Podés subir hasta 50 a la vez.
          </li>
          <li>
            <strong>Hacé clic en "Procesar".</strong> Cada factura tarda entre 25 y 40
            segundos. Mientras procesa, podés irte a otra pestaña tranquilo.
          </li>
          <li>
            <strong>Revisá el resultado.</strong> Si una factura sale con fondo
            amarillo (etiqueta "Revisión humana"), abrila y verificá los números antes
            de aceptarla.
          </li>
          <li>
            <strong>Descargá el Excel.</strong> Hay dos botones:
            <ul>
              <li><em>Excel de Caja Chica</em> → para tu reporte interno de reintegro.</li>
              <li><em>Excel para Hacienda</em> → para la declaración fiscal con las 24 columnas oficiales.</li>
            </ul>
          </li>
        </ol>
        <div className="alert alert-info">
          <strong>Truco:</strong> si tenés todas las facturas del mes en una carpeta,
          podés arrastrar la carpeta completa y el sistema las procesa todas seguidas.
        </div>
      </>
    ),
  },
  {
    id: 'subir-facturas',
    titulo: '3. Cómo subir facturas',
    resumen: 'PDFs, XMLs y carpetas enteras.',
    contenido: (
      <>
        <h4>¿Qué archivos acepta?</h4>
        <ul>
          <li>
            <strong>PDF nativo</strong> (generado por la computadora del proveedor) —
            es el más fácil y rápido de leer.
          </li>
          <li>
            <strong>PDF escaneado</strong> (foto de un tiquete o factura impresa) —
            el sistema usa visión por IA para leerlo. Tarda un poco más.
          </li>
          <li>
            <strong>XML de Hacienda</strong> (factura electrónica) — el formato más
            confiable; los datos están estructurados.
          </li>
        </ul>
        <h4>Tres formas de subir</h4>
        <ol>
          <li><strong>Arrastrá y soltá</strong> los archivos al recuadro grande.</li>
          <li><strong>Hacé clic en el recuadro</strong> y elegí archivos uno a uno.</li>
          <li><strong>Hacé clic en "Elegir carpeta…"</strong> para subir todos los archivos de una carpeta.</li>
        </ol>
        <h4>Lo que pasa después</h4>
        <p>
          Verás un texto que va cambiando: "Extrayendo factura con DocScan…",
          "Clasificando tarifas IVA…", "Escribiendo en la base y Google Sheets…".
          Cuando termina, aparecen las tarjetas con el desglose por factura.
        </p>
        <div className="alert alert-warning">
          <strong>Límites:</strong> hasta 50 archivos por lote, 20 MB por archivo. Si
          tenés más, subilos en tandas.
        </div>
      </>
    ),
  },
  {
    id: 'marcar-pago',
    titulo: '4. Marcar facturas como pagadas',
    resumen: 'Llevá control de qué le pagaste al proveedor y qué falta.',
    contenido: (
      <>
        <p>
          Cada factura tiene un <strong>estado de pago</strong> independiente del estado fiscal.
          Sirve para llevar control de a qué proveedores ya les pagaste y cuánto falta.
        </p>
        <h4>Cómo marcar una factura como pagada</h4>
        <ol>
          <li>Andá a <Link to="/facturas">Facturas</Link>.</li>
          <li>Buscá la factura en la lista. Las pendientes tienen una etiqueta amarilla; las pagadas verde.</li>
          <li>Hacé clic en <strong>"Marcar pagada"</strong> en la columna de la derecha.</li>
          <li>El sistema te muestra una confirmación: <em>"Vas a marcar como PAGADA la factura de X por ₡Y. ¿Estás seguro?"</em></li>
          <li>Aceptás y la factura queda registrada como pagada con la fecha de hoy.</li>
        </ol>
        <h4>¿Y si me equivoqué?</h4>
        <p>
          Hacé clic en <strong>"Revertir pago"</strong> en esa misma factura. Volverá a quedar
          pendiente. Es seguro hacerlo cuantas veces necesites — el sistema no pierde datos.
        </p>
        <h4>Lo que ves en el dashboard</h4>
        <p>En la página de Facturas, los totales muestran:</p>
        <ul>
          <li><strong>Pagado:</strong> suma de todas las facturas ya marcadas como pagadas (verde).</li>
          <li><strong>Pendiente:</strong> suma de las facturas que todavía debés pagar (rojo).</li>
        </ul>
        <h4>Lo que ves en el Excel</h4>
        <p>
          Cuando descargás el Excel de Caja Chica o el de Hacienda, vas a ver una columna nueva
          <strong> "Estado de pago"</strong> con la celda en verde si está pagada (con la fecha)
          o en amarillo si está pendiente. Al pie del reporte hay un desglose:{' '}
          <em>Monto pagado</em> y <em>Monto pendiente de pago</em>.
        </p>
      </>
    ),
  },
  {
    id: 'leer-resultado',
    titulo: '5. Cómo leer el resultado',
    resumen: 'Entender las tarjetas, los estados y la "revisión humana".',
    contenido: (
      <>
        <h4>Tarjeta de resultado por factura</h4>
        <p>Cada factura procesada muestra:</p>
        <ul>
          <li><strong>Proveedor y número</strong> — quién emitió la factura.</li>
          <li><strong>Total / Subtotal / IVA</strong> — los montos reconciliados.</li>
          <li><strong>Desglose por tarifa</strong> — cuántas líneas y cuánto IVA hay en cada tarifa (0/1/2/4/13).</li>
          <li><strong>Estado</strong> — verde si todo cuadró, amarillo si necesita tu mirada.</li>
        </ul>
        <h4>¿Qué significa "Revisión humana"?</h4>
        <p>
          El sistema marca así a las facturas que <strong>no pudo procesar con
          certeza al 100 %</strong>. No es un error — es un aviso de "esto te
          conviene mirarlo vos antes de declararlo a Hacienda". Causas típicas:
        </p>
        <ul>
          <li><code>OCR_DEGRADADO</code> — la foto del tiquete estaba muy borrosa.</li>
          <li><code>RECONCILIACION_FALLIDA</code> — los números de las líneas no cuadran con el pie de la factura.</li>
          <li><code>CEDULA_NO_HACIENDA</code> — la cédula del proveedor no apareció en el padrón de Hacienda.</li>
          <li><code>TARIFA_DUDOSA</code> — la IA no pudo determinar la tarifa con seguridad.</li>
        </ul>
        <h4>¿Qué hacer con una factura en revisión?</h4>
        <ol>
          <li>Hacé clic en "Ver" para abrir el detalle.</li>
          <li>Comparalo con la factura física o el PDF original.</li>
          <li>Si está bien, dejala como está (ya quedó en el Sheet).</li>
          <li>Si está mal, corregila directamente en el Google Sheet o re-procesá la factura.</li>
        </ol>
      </>
    ),
  },
  {
    id: 'caja-chica',
    titulo: '6. Caja Chica y adelantos',
    resumen: 'Cómo lleva el saldo después del adelanto.',
    contenido: (
      <>
        <p>
          La página <Link to="/caja-chica">Caja Chica</Link> sirve para llevar el
          control del efectivo que te dieron por adelantado y que vas gastando con
          las facturas.
        </p>
        <h4>Cómo funciona</h4>
        <ol>
          <li><strong>Registrá el adelanto</strong> que recibiste (ejemplo: ₡200.000).</li>
          <li>A medida que vas subiendo facturas, el sistema las descuenta del adelanto.</li>
          <li>El <strong>saldo líquido</strong> que ves es: <code>adelanto − Σ facturas del período</code>.</li>
          <li>Cuando llegás a saldo bajo, generás el Excel de Reintegro para pedir más fondos.</li>
        </ol>
        <div className="alert alert-info">
          Un adelanto pertenece a un período. Si abrís un adelanto nuevo, el período
          anterior queda cerrado y las facturas siguientes se cuentan contra el nuevo.
        </div>
      </>
    ),
  },
  {
    id: 'resumen-iva',
    titulo: '7. Resumen IVA',
    resumen: 'Cuánto IVA pagaste por cada tarifa.',
    contenido: (
      <>
        <p>
          La página <Link to="/resumen-iva">Resumen IVA</Link> muestra un cuadro
          con las 6 tarifas costarricenses (0 %, 1 %, 2 %, 4 %, 13 %, Exento) y, por
          cada una:
        </p>
        <ul>
          <li><strong># Líneas</strong> — cuántas líneas de factura aplicaron esa tarifa.</li>
          <li><strong>Base gravable</strong> — el monto sin IVA.</li>
          <li><strong>Monto IVA</strong> — el impuesto.</li>
          <li><strong>Total con IVA</strong> — base + IVA.</li>
          <li><strong>% del total</strong> — qué peso tiene esa tarifa sobre el gasto total.</li>
        </ul>
        <p>
          Este es el cuadro que necesitás para la D-104 de Hacienda. Podés filtrar
          por mes con el selector de arriba.
        </p>
      </>
    ),
  },
  {
    id: 'asistente',
    titulo: '8. Usar el Asistente Contable',
    resumen: 'Preguntale en español a tu base de facturas.',
    contenido: (
      <>
        <p>
          La página <Link to="/chat">Asistente</Link> es un chat donde le hacés
          preguntas en español y te responde con datos reales de tu base.
        </p>
        <h4>Ejemplos de preguntas que entiende</h4>
        <ul>
          <li>"¿Cuánto se gastó este mes?"</li>
          <li>"¿Cuál fue la factura más cara?"</li>
          <li>"¿Qué proveedor tuvo más facturas en abril?"</li>
          <li>"Mostrame las facturas con IVA al 13 % de este mes"</li>
          <li>"¿Cuántas facturas tienen revisión humana pendiente?"</li>
          <li>"¿Hay facturas vencidas?"</li>
        </ul>
        <h4>Consejos</h4>
        <ul>
          <li>Hablá natural. No hace falta usar palabras técnicas.</li>
          <li>Si la respuesta no parece correcta, reformulala. El asistente aprende del contexto.</li>
          <li>Apretá <kbd>Enter</kbd> para enviar y <kbd>Shift+Enter</kbd> para hacer un salto de línea.</li>
        </ul>
        <div className="alert alert-info">
          El asistente <strong>solo lee</strong> la base de datos. No puede borrar ni
          modificar nada con sus respuestas. Es seguro experimentar.
        </div>
      </>
    ),
  },
  {
    id: 'glosario',
    titulo: '9. Glosario contable y técnico',
    resumen: 'Los términos que aparecen en el sistema, explicados.',
    contenido: (
      <dl className="help-glossary">
        <dt>IVA</dt>
        <dd>Impuesto al Valor Agregado. En Costa Rica tiene 6 tarifas: 0 %, 1 %, 2 %, 4 %, 13 % y Exento.</dd>

        <dt>Tarifa marcada</dt>
        <dd>La tarifa que el proveedor escribió en la factura. Tiene prioridad sobre cualquier cálculo.</dd>

        <dt>Tarifa inferida</dt>
        <dd>La tarifa que el sistema dedujo cuando el proveedor no la escribió explícitamente (ejemplo: facturas de CSU).</dd>

        <dt>Base gravable / Base imponible</dt>
        <dd>El monto sobre el que se calcula el IVA. Es el subtotal sin impuesto.</dd>

        <dt>Reconciliación</dt>
        <dd>Verificación de que la suma de líneas (base + IVA) coincide con el pie de la factura, con tolerancia de ±₡1.</dd>

        <dt>Revisión humana</dt>
        <dd>La factura se procesó pero el sistema pide que vos la mires antes de aceptarla. No bloquea nada, solo avisa.</dd>

        <dt>FE</dt>
        <dd>Factura Electrónica. El formato oficial de Hacienda CR.</dd>

        <dt>TE</dt>
        <dd>Tiquete Electrónico. Versión simplificada de la FE, típica de supermercados.</dd>

        <dt>NC / ND</dt>
        <dd>Nota de Crédito / Nota de Débito. Documentos que ajustan una factura previa.</dd>

        <dt>Clave numérica</dt>
        <dd>Identificador único de 50 dígitos que Hacienda asigna a cada FE/TE.</dd>

        <dt>Consecutivo</dt>
        <dd>Número interno que el proveedor le pone a sus facturas, 20 dígitos.</dd>

        <dt>Padrón Hacienda</dt>
        <dd>El registro oficial de contribuyentes activos. El sistema valida cédulas contra ese padrón.</dd>

        <dt>Tipo de Cambio (TC)</dt>
        <dd>Conversión a colones cuando la factura viene en otra moneda. Se obtiene de la API oficial de Hacienda.</dd>

        <dt>Caja Chica</dt>
        <dd>Fondo en efectivo para gastos menores, controlado por el contador.</dd>

        <dt>Reintegro de Caja Chica</dt>
        <dd>Reporte que pide reponer el efectivo gastado, presentando las facturas como respaldo.</dd>

        <dt>Adelanto</dt>
        <dd>Efectivo entregado al contador antes de gastar. Saldo = adelanto − suma de facturas.</dd>

        <dt>D-104</dt>
        <dd>Declaración mensual del IVA ante Hacienda. El "Resumen IVA" alimenta este formulario.</dd>

        <dt>OCR</dt>
        <dd>Reconocimiento óptico de caracteres. Tecnología que convierte una imagen en texto leíble.</dd>

        <dt>Multi-tenant</dt>
        <dd>El sistema puede manejar varias empresas en la misma instalación. Cada empresa tiene su propio Sheet.</dd>
      </dl>
    ),
  },
  {
    id: 'errores',
    titulo: '10. Errores comunes y qué hacer',
    resumen: 'Soluciones rápidas a problemas frecuentes.',
    contenido: (
      <>
        <h4>"No se pudo conectar al motor"</h4>
        <p>
          El sistema no encontró el servidor. Pedile al administrador que verifique
          que el motor esté encendido. Mientras tanto podés hacer clic en
          "Reintentar conexión".
        </p>
        <h4>"Tu sesión expiró"</h4>
        <p>Volvé a iniciar sesión con tu correo y contraseña. Es normal cada cierto tiempo por seguridad.</p>
        <h4>"Esta factura es de otra empresa"</h4>
        <p>
          La factura está dirigida a una empresa distinta a la que tenés activa.
          Verificá que estés en el libro correcto, o cambiá de empresa en el menú admin.
        </p>
        <h4>"La API de Hacienda no respondió"</h4>
        <p>
          La página de Hacienda CR está temporalmente caída. Esperá un minuto y
          reintentá. El sistema usa una fuente de respaldo automáticamente para el
          tipo de cambio.
        </p>
        <h4>Una factura no fue reconocida</h4>
        <p>
          Si el PDF está muy borroso, tomá una foto nueva con mejor luz y volvé a subirla.
          Si el problema persiste, ingresá los datos manualmente en el Google Sheet.
        </p>
        <h4>Sumas que no cuadran</h4>
        <p>
          Si el sistema marca <code>RECONCILIACION_FALLIDA</code>, comparalo con el
          PDF original. Suele ser por descuentos o por una línea exenta que el
          proveedor sumó distinto. Si es un caso recurrente del mismo proveedor,
          avisale al admin para mejorar el dialecto.
        </p>
      </>
    ),
  },
  {
    id: 'tips',
    titulo: '11. Tips para sacar el mejor provecho',
    resumen: 'Buenas prácticas que ahorran tiempo.',
    contenido: (
      <ul>
        <li><strong>Procesá facturas todos los días</strong>, no las acumules. Cinco facturas por día son segundos; 200 al fin de mes te hacen esperar.</li>
        <li><strong>Cuando escaneás un tiquete, hacelo con buena luz y plano.</strong> Eso reduce las "revisiones humanas" a la mitad.</li>
        <li><strong>Usá el XML cuando puedas.</strong> Es el formato más limpio y nunca falla.</li>
        <li><strong>Verificá el Google Sheet 1 vez por semana.</strong> El sistema escribe automáticamente, pero una mirada humana detecta cosas que la IA no.</li>
        <li><strong>Usá el Asistente para reportes rápidos.</strong> Es más veloz que abrir el Sheet.</li>
        <li><strong>No borres facturas a mano del Sheet</strong> sin avisarle al admin. El sistema podría volver a escribirlas la próxima vez.</li>
      </ul>
    ),
  },
];

export function AyudaPage() {
  const [abiertas, setAbiertas] = useState<Set<string>>(new Set(['que-es']));

  function toggle(id: string) {
    setAbiertas((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function expandirTodas() {
    setAbiertas(new Set(SECCIONES.map((s) => s.id)));
  }

  function contraerTodas() {
    setAbiertas(new Set());
  }

  return (
    <div className="page help-page">
      <header className="page-header">
        <h1>Ayuda y guía de uso</h1>
        <p className="page-subtitle">
          Todo lo que necesitás saber para usar Contable AI sin tocar una línea de código.
        </p>
      </header>

      <section className="card help-intro">
        <p>
          Bienvenido. Esta página es tu manual de uso. Está pensada para que la leas
          una vez al inicio y la consultes cuando algo no te quede claro. Si tenés
          una pregunta puntual, usá el índice de abajo. Si querés un repaso completo,
          hacé clic en <strong>"Abrir todo"</strong> y leé de corrido.
        </p>
        <div className="help-actions">
          <button type="button" className="btn btn-secondary" onClick={expandirTodas}>
            Abrir todo
          </button>
          <button type="button" className="btn btn-ghost" onClick={contraerTodas}>
            Cerrar todo
          </button>
        </div>
      </section>

      <nav className="card help-toc" aria-label="Índice de la guía">
        <h2>Índice</h2>
        <ol>
          {SECCIONES.map((s) => (
            <li key={s.id}>
              <a href={`#${s.id}`} onClick={() => setAbiertas((p) => new Set(p).add(s.id))}>
                {s.titulo}
              </a>
              <span className="muted small"> — {s.resumen}</span>
            </li>
          ))}
        </ol>
      </nav>

      {SECCIONES.map((s) => (
        <section key={s.id} id={s.id} className="card help-section">
          <button
            type="button"
            className="help-section-header"
            onClick={() => toggle(s.id)}
            aria-expanded={abiertas.has(s.id)}
            aria-controls={`content-${s.id}`}
          >
            <h2>{s.titulo}</h2>
            <span className="help-toggle" aria-hidden="true">
              {abiertas.has(s.id) ? '−' : '+'}
            </span>
          </button>
          {abiertas.has(s.id) && (
            <div id={`content-${s.id}`} className="help-section-body">
              {s.contenido}
            </div>
          )}
        </section>
      ))}

      <footer className="card help-footer">
        <p>
          <strong>¿Algo no aparece acá?</strong> Avisale al administrador para
          agregarlo. Esta guía se actualiza con cada nueva pregunta frecuente.
        </p>
        <p className="muted small">
          Forward Contabilidad · Contable AI · Última actualización: 2026-05-19
        </p>
      </footer>
    </div>
  );
}
