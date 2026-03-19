# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Run locally
node server.js

# Install dependencies
npm install

# Build & run with Docker
docker build -t wedding-api .
docker compose up -d
```

No build step required (plain Node.js, no TypeScript). No linter or test framework configured.

API docs available at `/api/docs` (Swagger UI) and `/api/docs/json` when running.

## Architecture

Fastify 5 backend for a Telegram Mini App (TMA) wedding photo gallery. Stack: Node.js + MongoDB + Cloudinary (or S3).

### Entry Points

- `server.js` — loads `.env`, starts app on `PORT` (default 4000)
- `src/app.js` — registers plugins, routes, global hooks

### Key Patterns

**Plugin registration order** (in `src/app.js`): MongoDB → JWT → multipart → CORS → Swagger → routes. Fastify's plugin system means plugins must be registered before routes that depend on them.

**Authentication flow**:
1. Client sends Telegram `initData` to `POST /api/auth/telegram`
2. Server validates via HMAC-SHA256 against `BOT_TOKEN`
3. JWT issued and stored in httpOnly cookie (10-min expiry)
4. Protected routes use `fastify.authenticate` decorator (`onRequest` hook)

**Authorization middleware** (applied via `onRequest`):
- `adminOnly` — checks `request.user.role === 'admin'`
- `confirmedGuest` — checks `request.user.approvalStatus === 'approved'`

**Global `preSerialization` hook** in `src/app.js` recursively converts MongoDB `_id` → `id` in all responses.

**Models** (`src/models/`) are thin collection-reference wrappers — no ORM. Direct MongoDB driver calls everywhere.

**Storage abstraction** (`src/services/storage.js`): dynamically loads provider based on `STORAGE_PROVIDER` env var (`cloudinary` or `s3`). Uniform interface: `upload()`, `delete()`, `getThumbnail()`.

### Database Collections

**users**: `telegramId`, `role` (`admin`|`guest`), `approvalStatus` (`null`|`pending`|`approved`|`denied`)

**galleries**: `userId`, `photoCount`, `coverPhotoUrl`, `updatedAt`, `deletedAt` (soft delete)

**media**: `galleryId`, `userId`, `type`, `url`, `thumbnailUrl`, `cloudId`, `uploadedAt`, `deletedAt` (soft delete)

### Delete Strategy

- **Soft delete**: sets `deletedAt` timestamp; records hidden from GET responses but kept in DB
- **Hard delete** (`/hard` routes, admin only): removes from MongoDB + cloud storage

### Guest Approval Workflow

1. User authenticates → gets `approvalStatus: null` (admins auto-approved)
2. `POST /api/guests/request` → sets `pending`, notifies admins via Telegram bot
3. `PATCH /api/guests/requests/:userId` (admin) → sets `approved`/`denied`, notifies user via bot

### Telegram Bot Webhook

`POST /api/webhook` handles direct photo uploads sent to the bot. Downloads from Telegram, validates user approval, uploads to the user's gallery in Cloudinary.

### Environment Variables

Required: `MONGO_URL`, `JWT_SECRET`, `BOT_TOKEN`, `ADMIN_TELEGRAM_IDS`, `STORAGE_PROVIDER`, Cloudinary credentials (`CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`).
