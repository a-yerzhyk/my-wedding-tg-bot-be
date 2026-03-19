const { getCollection: getUsers } = require('../models/user')
const { getCollection: getGalleries } = require('../models/gallery')
const { getCollection: getMedia } = require('../models/media')
const storage = require('../services/storage')
const { sendMessageToBot, PROD_BOT_TOKEN, TELEGRAM_API } = require('../utils/telegram')

const PHOTO_QUOTA_BYTES = 150 * 1024 * 1024 // 150 MB
const VIDEO_QUOTA_BYTES = 200 * 1024 * 1024 // 200 MB
const PHOTO_MAX_BYTES = 10 * 1024 * 1024    // 10 MB
const VIDEO_MAX_BYTES = 100 * 1024 * 1024   // 100 MB
const TELEGRAM_MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024 // 20 MB (Telegram getFile API limit)

// Tracks in-flight media groups to batch success/error messages into one reply
const mediaGroupBuffer = new Map()

async function downloadFile(fileId) {
  const res = await fetch(`${TELEGRAM_API}/getFile?file_id=${fileId}`)
  const data = await res.json()
  const filePath = data.result.file_path

  const fileRes = await fetch(
    `https://api.telegram.org/file/bot${PROD_BOT_TOKEN}/${filePath}`
  )
  const buffer = Buffer.from(await fileRes.arrayBuffer())
  return { buffer, filePath }
}

module.exports = async (fastify) => {
  /**
   * POST /api/webhook
   * Telegram sends all bot updates here.
   * Register with: https://api.telegram.org/bot<token>/setWebhook?url=https://yz-wedding.vn.ua/api/webhook
   */
  fastify.post('/', async (request, reply) => {
    // Always respond 200 immediately — Telegram will retry if you don't
    reply.code(200).send({ ok: true })

    const update = request.body
    if (!update?.message) return

    const message = update.message
    const chatId = message.chat.id.toString()
    const telegramId = String(message.from.id)
    const mediaGroupId = message.media_group_id

    const users = getUsers(fastify.mongo.db)
    const user = await users.findOne({ telegramId })

    if (!user) {
      await sendMessageToBot(chatId, 'Будь ласка, спочатку відкрийте додаток через кнопку меню.')
      return
    }

    if (user.approvalStatus !== 'approved') {
      await sendMessageToBot(chatId, 'Ваш акаунт ще не підтверджено. Зверніться до організаторів.')
      return
    }

    if (message.text?.startsWith('/message_for_guests')) {
      await handleMessageForGuests(fastify, message, user, telegramId)
      return
    }

    let result = null

    if (message.photo) {
      result = await handlePhoto(fastify, message, user, chatId)
    } else if (message.document && message.document.mime_type?.startsWith('image/')) {
      result = await handleDocument(fastify, message, user, chatId)
    } else if (message.video) {
      result = await handleVideo(fastify, message, user, chatId)
    }

    if (result === null) return // no supported media in this message

    if (mediaGroupId) {
      // Accumulate results and send a single summary after the group settles
      const group = mediaGroupBuffer.get(mediaGroupId) || { chatId, successes: 0, errors: [] }
      if (result.success) {
        group.successes++
      } else if (result.error) {
        group.errors.push(result.error)
      }
      clearTimeout(group.timer)
      group.timer = setTimeout(async () => {
        mediaGroupBuffer.delete(mediaGroupId)
        if (group.successes > 0 && group.errors.length === 0) {
          await sendMessageToBot(group.chatId, `✅ ${group.successes} файл(ів) успішно додано до галереї!`)
        } else if (group.successes > 0) {
          await sendMessageToBot(group.chatId, `✅ ${group.successes} завантажено, ❌ ${group.errors.length} не вдалося.`)
        } else {
          await sendMessageToBot(group.chatId, `❌ Не вдалося завантажити файли. Спробуйте ще раз.`)
        }
      }, 2000)
      mediaGroupBuffer.set(mediaGroupId, group)
    } else {
      // Single item — respond immediately
      if (result.success) {
        const label = result.type === 'video' ? 'Відео' : 'Фото'
        await sendMessageToBot(chatId, `✅ ${label} успішно додано до галереї!`)
      } else if (result.error) {
        await sendMessageToBot(chatId, result.error)
      }
    }
  })
}

async function handleMessageForGuests(fastify, message, user, senderTelegramId) {
  if (user.role !== 'admin') return
  const text = message.text.replace('/message_for_guests', '').trim()
  if (!text) return

  const users = getUsers(fastify.mongo.db)
  const guests = await users
    .find({ approvalStatus: 'approved', role: 'guest', telegramId: { $ne: senderTelegramId } })
    .project({ telegramId: 1 })
    .toArray()

  for (const guest of guests) {
    await sendMessageToBot(guest.telegramId, text)
  }

  await sendMessageToBot(user.telegramId, `✅ Повідомлення надіслано ${guests.length} гостям.`)
}

async function handlePhoto(fastify, message, user, chatId) {
  try {
    const photo = message.photo[message.photo.length - 1]
    const { buffer } = await downloadFile(photo.file_id)
    return await saveMedia(fastify, buffer, 'image/jpeg', 'photo', user, chatId)
  } catch (e) {
    console.error('Photo upload error:', e)
    return { success: false, error: '❌ Не вдалося завантажити фото. Спробуйте ще раз.' }
  }
}

async function handleDocument(fastify, message, user, chatId) {
  try {
    const doc = message.document
    const { buffer } = await downloadFile(doc.file_id)
    const mimetype = doc.mime_type || 'image/jpeg'
    return await saveMedia(fastify, buffer, mimetype, 'photo', user, chatId)
  } catch (e) {
    console.error('Document upload error:', e)
    return { success: false, error: '❌ Не вдалося завантажити фото. Спробуйте ще раз.' }
  }
}

async function handleVideo(fastify, message, user, chatId) {
  try {
    const video = message.video

    if (video.file_size > TELEGRAM_MAX_DOWNLOAD_BYTES) {
      return {
        success: false,
        error:
          '❌ Відео занадто велике для завантаження через бот (максимум 20 МБ). ' +
          'Будь ласка, завантажте відео через веб-додаток.'
      }
    }

    const { buffer } = await downloadFile(video.file_id)
    return await saveMedia(fastify, buffer, 'video/mp4', 'video', user, chatId)
  } catch (e) {
    console.error('Video upload error:', e)
    return { success: false, error: '❌ Не вдалося завантажити відео. Спробуйте ще раз.' }
  }
}

async function saveMedia(fastify, buffer, mimetype, type, user, chatId) {
  const { ObjectId } = fastify.mongo
  const galleries = getGalleries(fastify.mongo.db)
  const media = getMedia(fastify.mongo.db)

  const quota = type === 'video' ? VIDEO_QUOTA_BYTES : PHOTO_QUOTA_BYTES
  const maxFileSize = type === 'video' ? VIDEO_MAX_BYTES : PHOTO_MAX_BYTES
  const userId = new ObjectId(user._id)

  // Per-file size check
  if (buffer.length > maxFileSize) {
    const limitMB = Math.round(maxFileSize / 1024 / 1024)
    return {
      success: false,
      error: `❌ Файл перевищує ліміт ${limitMB} МБ для ${type === 'video' ? 'відео' : 'фото'}.`
    }
  }

  // Check per-user storage quota
  const existingGallery = await galleries.findOne({ userId, deletedAt: { $exists: false } })
  if (existingGallery) {
    const [agg] = await media.aggregate([
      { $match: { userId, type, deletedAt: { $exists: false } } },
      { $group: { _id: null, totalSize: { $sum: '$fileSize' } } }
    ]).toArray()
    const usedBytes = agg?.totalSize ?? 0
    if (usedBytes + buffer.length > quota) {
      const quotaMB = Math.round(quota / 1024 / 1024)
      return {
        success: false,
        error: `❌ Ваш ліміт сховища для ${type === 'video' ? 'відео' : 'фото'} вичерпано (${quotaMB} МБ).`
      }
    }
  }

  const uploadResult = await storage.upload(buffer, {
    folder: `wedding/${user.telegramId}`,
    mimetype
  })

  const now = new Date()
  let gallery = existingGallery

  if (!gallery) {
    const result = await galleries.insertOne({
      userId,
      coverPhotoUrl: uploadResult.thumbnailUrl,
      photoCount: 0,
      videoCount: 0,
      createdAt: now,
      updatedAt: now
    })
    gallery = await galleries.findOne({ _id: result.insertedId })
  }

  await media.insertOne({
    galleryId: gallery._id,
    userId,
    type,
    cloudId: uploadResult.cloudId,
    url: uploadResult.url,
    thumbnailUrl: uploadResult.thumbnailUrl,
    width: uploadResult.width,
    height: uploadResult.height,
    duration: uploadResult.duration,
    fileSize: buffer.length,
    uploadedAt: now
  })

  const countField = type === 'video' ? 'videoCount' : 'photoCount'
  await galleries.updateOne(
    { _id: gallery._id },
    { $inc: { [countField]: 1 }, $set: { updatedAt: now } }
  )

  return { success: true, type }
}
