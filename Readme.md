# Wedding TMA Backend

Fastify + MongoDB + Cloudinary backend for a Wedding Telegram Mini App.

## Stack
- **Runtime:** Node.js 20
- **Framework:** Fastify
- **Database:** MongoDB (shared with existing juice project container)
- **Auth:** Telegram initData validation + JWT (stored in localStorage on client)
- **Storage:** Cloudinary (swappable via STORAGE_PROVIDER env var)
- **Deploy:** Docker + GitHub Actions CI/CD

---

## Environment Variables

| Variable | Description |
|---|---|
| `PORT` | Server port (default: 4000) |
| `MONGO_URL` | MongoDB connection string |
| `JWT_SECRET` | Secret for signing JWTs |
| `BOT_TOKEN` | Telegram bot token from @BotFather |
| `ADMIN_TELEGRAM_IDS` | Comma-separated Telegram IDs of admins |
| `STORAGE_PROVIDER` | `cloudinary` or `s3` |
| `CLOUDINARY_CLOUD_NAME` | From Cloudinary dashboard |
| `CLOUDINARY_API_KEY` | From Cloudinary dashboard |
| `CLOUDINARY_API_SECRET` | From Cloudinary dashboard |

---

## User Approval Flow

Users are created on first login with `approvalStatus: null`. To get access to the gallery they must submit a request via `POST /api/guests/request` which sets `approvalStatus: 'pending'`. An admin then approves or denies via `PATCH /api/guests/requests/:userId`.

| Status | Meaning |
|---|---|
| `null` | Registered but never requested access |
| `pending` | Request submitted, waiting for admin |
| `approved` | Full access to gallery |
| `denied` | Request rejected |

Admins are identified by `ADMIN_TELEGRAM_IDS` and are always approved on first login.

---

## API Reference

### Auth
| Method | Route | Auth | Description |
|---|---|---|---|
| `POST` | `/api/auth/telegram` | None | Validate Telegram initData, returns JWT + user with approvalStatus |

### Guests
| Method | Route | Auth | Description |
|---|---|---|---|
| `POST` | `/api/guests/request` | Any authed user | Submit request to join |
| `GET` | `/api/guests/requests` | Admin | List all users who submitted a request |
| `PATCH` | `/api/guests/requests/:userId` | Admin | Approve or deny by userId |

### Gallery
| Method | Route | Auth | Description |
|---|---|---|---|
| `GET` | `/api/gallery` | Approved guest | List all galleries with up to 3 preview thumbnails |
| `GET` | `/api/gallery/:galleryId` | Approved guest | Open a specific gallery |
| `POST` | `/api/gallery/upload` | Approved guest | Upload a photo (multipart/form-data) |
| `DELETE` | `/api/gallery/media/:mediaId` | Owner | Soft delete a photo (marks as deleted, hidden from responses) |
| `DELETE` | `/api/gallery/media/:mediaId/hard` | Admin | Hard delete a photo from DB and Cloudinary |
| `DELETE` | `/api/gallery/:galleryId` | Owner | Soft delete a gallery and all its photos |
| `DELETE` | `/api/gallery/:galleryId/hard` | Admin | Hard delete a gallery, all its photos from DB and Cloudinary |

### Webhook
| Method | Route | Description |
|---|---|---|
| `POST` | `/api/webhook` | Telegram sends bot updates here. Approved guests can send photos directly to the bot to add them to their gallery |

---

## Swagger UI

Available at `/docs` in production. Raw OpenAPI spec at `/docs/json`.

---

## Soft vs Hard Delete

- **Soft delete** (owner) — sets `deletedAt` on the document. Hidden from all GET responses but remains in DB.
- **Hard delete** (admin) — permanently removes from MongoDB and deletes the file from Cloudinary storage.

---

## Switching Storage Providers

1. Add `src/services/providers/<name>.js` implementing `upload`, `delete`, `getThumbnail`
2. Set `STORAGE_PROVIDER=<name>` in `.env`
3. No other changes needed
