# Workflows n8n — FWD Contable AI

> Tres workflows listos para importar en la instancia n8n existente del usuario
> (`onlyautotask-n8n.tuoaro.easypanel.host`). Sirven como interfaz alternativa al
> frontend React para canales que no son browser (formularios públicos, WhatsApp).

---

## Variables de entorno a setear en n8n (Settings → Variables)

| Variable | Para qué | Ejemplo |
|---|---|---|
| `FWD_BACKEND_URL` | URL pública del backend (túnel Cloudflare o IP) | `https://contable-api.tuoaro.tunnels.dev` |
| `FWD_SERVICE_USER` | Email de un user de servicio creado para n8n (rol admin) | `n8n@forwardcr.local` |
| `FWD_SERVICE_PASS` | Password de ese user | `(generar uno largo)` |
| `FWD_EMPRESA_DEFAULT` | Empresa cliente que recibe los chats vía WhatsApp | `3006696489` |
| `WA_PHONE_NUMBER_ID` | (solo workflow 03) ID del número de WhatsApp Business | `123456789012345` |
| `WA_TOKEN` | (solo workflow 03) Token permanente de WhatsApp Cloud API | `EAAxxxx...` |

**Cómo crear el user de servicio**: con un admin logueado en el motor, crear vía
SQL directo en SQLite o (futuro) endpoint `POST /users` cuando exista panel admin.

```sql
INSERT INTO users (email, password_hash, nombre, rol)
VALUES ('n8n@forwardcr.local', '<bcrypt-hash-de-la-password>', 'Servicio n8n', 'admin');
```

Para generar el hash: en el backend `node -e "import('bcrypt').then(b => b.default.hash('TU_PASSWORD', 10).then(console.log))"`.

---

## Workflow 01 — Subir factura vía formulario web

**Archivo**: `n8n-workflows/01-subir-factura-form.json`

**Qué hace**:
1. Trigger: formulario web que pide PDF/XML + cédula de la empresa.
2. Llama a `POST /auth/login` con el service user → obtiene JWT.
3. Llama a `POST /process-document` con el archivo + `empresa_id`.
4. Responde al usuario con texto: *"Factura recibida. Procesando — revisá el Google Sheet en 1 minuto."*

**Uso**: pegale la URL del Form Trigger al contador como bookmark. Es la
alternativa más simple si todavía no querés usar el frontend React.

---

## Workflow 02 — Chat asistente vía formulario web

**Archivo**: `n8n-workflows/02-chat-asistente.json`

**Qué hace**:
1. Trigger: formulario con campo "Tu pregunta" + cédula de empresa.
2. Login + `POST /chat` con la pregunta.
3. Devuelve el texto de respuesta del asistente.

**Uso**: útil para hacer demos rápidas o si el contador prefiere un input simple
en vez del chat completo del frontend.

---

## Workflow 03 — WhatsApp opcional

**Archivo**: `n8n-workflows/03-whatsapp-opcional.json`

**Qué hace**:
1. Webhook que recibe los mensajes entrantes de WhatsApp Business Cloud API.
2. Filtra mensajes de tipo `text` (ignora media por ahora).
3. Login → `POST /chat` con el mensaje y la empresa default.
4. Envía la respuesta al número del usuario vía `POST https://graph.facebook.com/v20.0/{phone_number_id}/messages`.

**Pre-requisitos manuales en Meta Business**:
- Crear cuenta WhatsApp Business.
- Generar `WA_PHONE_NUMBER_ID` y un Token permanente (`WA_TOKEN`).
- Configurar el webhook de mensajes apuntando a:
    `https://onlyautotask-n8n.tuoaro.easypanel.host/webhook/fwd-whatsapp`
- Token de verificación para el handshake inicial (configurable en el nodo Webhook).

**Estado**: marcado como `active: false` por default. Solo activar cuando el
usuario contrate WhatsApp Business y termine el setup.

---

## Cómo importar

1. Entrá a n8n: `https://onlyautotask-n8n.tuoaro.easypanel.host`.
2. Menú → **Workflows** → **Import from File**.
3. Subí el JSON del workflow deseado.
4. Setear las variables de entorno listadas arriba (Settings → Variables).
5. Activar el workflow.
6. Probar disparándolo: para el form, abrir la URL del Form Trigger; para
   WhatsApp, enviar un mensaje al número configurado.

---

## Notas de seguridad

- El `FWD_SERVICE_USER` tiene rol admin → ve y procesa facturas de TODAS las
  empresas. Si en el futuro hay múltiples clientes en producción, considerar
  rotar a un rol contador por cada empresa.
- Los webhooks de n8n NO verifican firma por default. Para WhatsApp, agregar
  un nodo "Crypto" que valide el header `x-hub-signature-256` antes del IF.
- Rotar `FWD_SERVICE_PASS` cada 90 días o si hay sospecha de fuga.
