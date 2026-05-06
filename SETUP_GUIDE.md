# 🚀 PR Review Bot — Guía de Setup y Testing

Guía paso a paso para configurar y probar el bot en local.

---

## Paso 1: Crear un Workspace de Slack (5 min)

1. Ve a **[slack.com/create](https://slack.com/create)**
2. Crea un workspace llamado algo como `PR Bot Dev`
3. Crea un canal `#pr-reviews` para los digests

---

## Paso 2: Crear la Slack App (10 min)

1. Ve a **[api.slack.com/apps](https://api.slack.com/apps)** → **Create New App** → **From Scratch**
2. Nombre: `PR Review Bot`, selecciona tu workspace de prueba

### 2.1 Configurar Bot Token Scopes

Ve a **OAuth & Permissions** → **Scopes** → **Bot Token Scopes** y añade:

| Scope | Para qué |
|---|---|
| `chat:write` | Enviar mensajes y DMs |
| `commands` | Slash commands (`/prbot`) |
| `users:read` | Leer info de usuarios |

### 2.2 Activar Socket Mode (para desarrollo local)

Socket Mode permite recibir eventos sin necesitar una URL pública.

1. Ve a **Settings** → **Socket Mode** → **Enable Socket Mode**
2. Crea un App-Level Token con scope `connections:write`
3. Copia el token `xapp-...` → lo usarás como `SLACK_APP_TOKEN`

### 2.3 Crear el Slash Command

1. Ve a **Slash Commands** → **Create New Command**
2. Command: `/prbot`
3. Request URL: `https://placeholder.com` (Socket Mode lo ignora, pero es obligatorio)
4. Description: `PR Review Bot commands`
5. Usage Hint: `status | digest | link <github-user> | config | help`

### 2.4 Instalar la App

1. Ve a **Install App** → **Install to Workspace**
2. Copia el **Bot User OAuth Token** (`xoxb-...`) → será tu `SLACK_BOT_TOKEN`
3. Ve a **Basic Information** → copia el **Signing Secret** → será tu `SLACK_SIGNING_SECRET`

---

## Paso 3: Crear la GitHub App (10 min)

1. Ve a **[github.com/settings/apps](https://github.com/settings/apps)** → **New GitHub App**

### 3.1 Configuración básica

| Campo | Valor |
|---|---|
| App name | `PR Review Bot Dev` |
| Homepage URL | `http://localhost:3000` |
| Webhook URL | La URL de ngrok (Paso 5) — déjalo vacío por ahora |
| Webhook secret | Genera uno: `openssl rand -hex 20` |

### 3.2 Permisos

En **Permissions** → **Repository permissions**:

| Permiso | Nivel |
|---|---|
| Pull requests | **Read-only** |
| Metadata | **Read-only** |

### 3.3 Suscripción a eventos

En **Subscribe to events**, marca:

- [x] `Pull request`
- [x] `Pull request review`

### 3.4 Crear y configurar

1. Haz clic en **Create GitHub App**
2. Apunta el **App ID** → será tu `GITHUB_APP_ID`
3. Genera una **Private Key** (botón abajo) → descarga el `.pem`
4. El **Webhook Secret** que pusiste → será tu `GITHUB_WEBHOOK_SECRET`

### 3.5 Instalar en tu repo

1. Ve a **Install App** (menú izquierdo)
2. Selecciona tu cuenta → **Only select repositories** → elige `pr-review-bot`
3. Instalar

---

## Paso 4: Configurar variables de entorno (2 min)

```bash
cp .env.example .env
```

Edita `.env` con los valores reales:

```env
NODE_ENV=development
PORT=3000

# Docker Compose defaults
DATABASE_URL=postgresql://prbot:prbot_secret@localhost:5432/pr_review_bot
REDIS_URL=redis://localhost:6379

# GitHub App (del Paso 3)
GITHUB_APP_ID=123456
GITHUB_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----"
GITHUB_WEBHOOK_SECRET=tu_webhook_secret

# Slack App (del Paso 2)
SLACK_BOT_TOKEN=xoxb-tu-token
SLACK_SIGNING_SECRET=tu_signing_secret
SLACK_APP_TOKEN=xapp-tu-app-token
```

> **Tip**: Para la private key de GitHub, puedes copiar el contenido del `.pem` y reemplazar los saltos de línea por `\n`, o cargarla desde archivo modificando `config.ts`.

---

## Paso 5: Levantar y arrancar (5 min)

```bash
# 1. Levantar PostgreSQL y Redis
docker compose up -d

# 2. Verificar que están corriendo
docker compose ps

# 3. Crear las tablas en la base de datos
npm run db:push

# 4. Insertar datos de prueba (seed)
npx tsx scripts/seed.ts

# 5. Arrancar la app
npm run dev
```

---

## Paso 6: Exponer webhooks con ngrok (2 min)

En otra terminal:

```bash
# Instalar ngrok si no lo tienes
brew install ngrok

# Exponer el puerto 3000
ngrok http 3000
```

Copia la URL `https://xxxx.ngrok-free.app` y:

1. Ve a tu GitHub App → **Edit** → **Webhook URL** → pega `https://xxxx.ngrok-free.app/webhooks/github`
2. Guarda

---

## Paso 7: Probar 🎉

### Test 1: Webhook simulado (sin GitHub real)

```bash
# Simular una PR abierta
bash scripts/test-webhook.sh opened

# Simular un reviewer asignado
bash scripts/test-webhook.sh review_requested

# Simular una review aprobada
bash scripts/test-webhook.sh reviewed
```

### Test 2: PR real en GitHub

```bash
# Crear una rama y una PR real
git checkout -b test/pr-bot-demo
echo "testing the bot" > test-file.txt
git add . && git commit -m "test: PR for bot testing"
git push origin test/pr-bot-demo
# Abre la PR en GitHub y asígnate como reviewer
```

### Test 3: Comandos de Slack

En tu workspace de pruebas de Slack:

```
/prbot help                    → Ver comandos disponibles
/prbot link tu-github-user     → Vincular tu cuenta
/prbot status                  → Ver tus reviews pendientes
/prbot digest                  → Generar un digest ahora
/prbot config threshold 1      → Poner threshold a 1h (para probar rápido)
/prbot config channel #pr-reviews → Configurar canal de digest
```

### Test 4: Health check

```bash
curl http://localhost:3000/health
# → {"status":"ok","timestamp":"2026-03-14T..."}
```

---

## Troubleshooting

| Problema | Solución |
|---|---|
| `ECONNREFUSED` PostgreSQL | ¿Está corriendo Docker? → `docker compose ps` |
| Webhook 401 | Verifica que `GITHUB_WEBHOOK_SECRET` coincide con el de la GitHub App |
| Slack no responde a `/prbot` | Verifica Socket Mode activado y `SLACK_APP_TOKEN` correcto |
| No llegan DMs | ¿Hiciste `/prbot link tu-github-user`? |
