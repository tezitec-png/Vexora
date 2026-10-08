# Despliegue en Cloudflare Pages (guía original, en español)

Esta es la guía tal y como la usaba el autor para desplegar `vexorium.pages.dev`.

## 1. Requisitos

- Cuenta de Cloudflare (plan gratuito basta: D1, R2 y Pages tienen capas free).
- Node 20+ y npm.
- Este repositorio.

## 2. Preparar el build

```bash
npm install
node build-protect.js
```

Esto genera `protected/` — el despliegue real (frontend ofuscado + `_worker.js` en la raíz).

## 3. Crear los recursos

En el dashboard de Cloudflare:

1. **D1** → Create database → nombre `vexora-stats` (o el que quieras). No hace falta crear tablas: el worker las crea solas.
2. **R2** → Create bucket → nombre `vexorium-comm` (fotos de la comunidad y media de DMs).
3. (Opcional) **Resend** → API key para emails de verificación. Con `test-key` el envío real se desactiva y los códigos se ven por el panel admin (modo stub).
4. (Opcional) **Groq** → API key para traducción automática y triaje de reportes. Sin key, esas funciones caen a fallback silencioso.

## 4. Subir a Pages

**Opción A (dashboard, la que usaba el autor):** Pages → Create project → Direct upload → sube el **CONTENIDO de `protected/`** (el zip `vexorium-pages-upload.zip` contiene exactamente eso, con `_worker.js` en la raíz).

**Opción B (CLI):**

```bash
npx wrangler pages deploy protected --project-name=vexorium
```

## 5. Bindings (Settings → Functions/Variables del proyecto)

| Binding | Tipo | Valor |
|---|---|---|
| `DB` | D1 | tu base de datos |
| `BUCKET` | R2 | `vexorium-comm` |
| `ADMIN_PASSWORD` | Variable | contraseña del panel `/admin` |
| `BOT_SECRET` | Variable | secreto compartido del puente con el bot de Discord |
| `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` | Variables | OAuth de Discord (consola de soporte) |
| `SUPPORT_GUILD_ID` / `SUPPORT_ROLE_ID` / `FOUNDER_ROLE_ID` | Variables | guild/roles de Discord para el acceso |
| `RESEND_API_KEY` | Variable | clave de Resend (o `test-key` para modo stub) |
| `GROQ_API_KEY` | Variable | clave de Groq (opcional) |

## 6. Primer arranque

Abre `https://<proyecto>.pages.dev`. En la primera petición, `ensureSchema` crea todas las tablas e índices en D1 (migración automática). Comprueba `/api/health` → `{"ok":true,...}`.

## 7. Dominio y verificación en vivo

- Custom domain (opcional): Pages → Custom domains.
- Para verificar qué versión está viva: `curl -s https://<dominio>/sw.js | grep -o vexora-1[0-9]*` (cada release sube la versión del service worker).

## 8. Actualizar

Repite el paso 2 y sube el zip nuevo. El schema de D1 migra solo. El service worker viejo se sustituye en la siguiente visita del usuario.
