# Wedding TMA Backend

Fastify + MongoDB + Cloudinary backend for a Wedding Telegram Mini App.

## Stack
- **Runtime:** Node.js 20
- **Framework:** Fastify
- **Database:** MongoDB (shared with existing juice project container)
- **Auth:** Telegram initData validation + JWT
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

## API Reference

### Auth
| Method | Route | Auth | Description |
|---|---|---|---|
| `POST` | `/api/auth/telegram` | None | Validate Telegram initData, get JWT |

### Guests
| Method | Route | Auth | Description |
|---|---|---|---|
| `POST` | `/api/guests/request` | Any authed user | Submit request to join |
| `GET` | `/api/guests/requests` | Admin | List all requests |
| `PATCH` | `/api/guests/requests/:id` | Admin | Approve or deny |

### Gallery
| Method | Route | Auth | Description |
|---|---|---|---|
| `POST` | `/api/gallery/upload` | Confirmed guest | Upload photo |
| `GET` | `/api/gallery` | Any guest | List all galleries with previews |
| `GET` | `/api/gallery/:galleryId` | Any guest | Open a specific gallery |
| `DELETE` | `/api/gallery/media/:mediaId` | Admin or owner | Delete a photo |

---

## Switching Storage Providers

1. Add `src/services/providers/<name>.js` implementing `upload`, `delete`, `getThumbnail`
2. Set `STORAGE_PROVIDER=<name>` in `.env`
3. No other changes needed
