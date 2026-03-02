const { getCollection: getUsers } = require('../models/user')
const { getCollection: getGalleries } = require('../models/gallery')
const { getCollection: getMedia } = require('../models/media')
const storage = require('../services/storage')
const { sendMessageToBot, PROD_BOT_TOKEN, TELEGRAM_API } = require('../utils/telegram')

async function downloadFile(fileId) {
  // Get file path from Telegram
  const res = await fetch(`${TELEGRAM_API}/getFile?file_id=${fileId}`)
  const data = await res.json()
  const filePath = data.result.file_path

  // Download the actual file
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
    const chatId = message.chat.id
    const telegramId = String(message.from.id)

    const users = getUsers(fastify.mongo.db)
    const user = await users.findOne({ telegramId })

    // User not found — not registered via TMA yet
    if (!user) {
      await sendMessageToBot(chatId, 'Будь ласка, спочатку відкрийте додаток через кнопку меню.')
      return
    }

    // User not approved
    if (user.approvalStatus !== 'approved') {
      await sendMessageToBot(chatId, 'Ваш акаунт ще не підтверджено. Зверніться до організаторів.')
      return
    }

    // Handle photo message
    if (message.photo) {
      await handlePhoto(fastify, message, user, chatId)
      return
    }

    // Handle document (uncompressed photo sent as file)
    if (message.document && message.document.mime_type?.startsWith('image/')) {
      await handleDocument(fastify, message, user, chatId)
      return
    }

    // Any other message
    // await sendMessageToBot(chatId, 'Надішліть фото, щоб додати його до галереї 📸')
  })
}

async function handlePhoto(fastify, message, user, chatId) {
  try {
    // Telegram sends multiple sizes — take the largest (last in array)
    const photo = message.photo[message.photo.length - 1]
    const { buffer } = await downloadFile(photo.file_id)

    await savePhoto(fastify, buffer, 'image/jpeg', user, chatId)
    await sendMessageToBot(chatId, '✅ Фото успішно додано до галереї!')
  } catch (e) {
    console.error('Photo upload error:', e)
    await sendMessageToBot(chatId, '❌ Не вдалося завантажити фото. Спробуйте ще раз.')
  }
}

async function handleDocument(fastify, message, user, chatId) {
  try {
    const doc = message.document
    const { buffer, filePath } = await downloadFile(doc.file_id)
    const mimetype = doc.mime_type || 'image/jpeg'

    await savePhoto(fastify, buffer, mimetype, user, chatId)
    await sendMessageToBot(chatId, '✅ Фото успішно додано до галереї!')
  } catch (e) {
    console.error('Document upload error:', e)
    await sendMessageToBot(chatId, '❌ Не вдалося завантажити фото. Спробуйте ще раз.')
  }
}

async function savePhoto(fastify, buffer, mimetype, user, chatId) {
  const { ObjectId } = fastify.mongo
  const galleries = getGalleries(fastify.mongo.db)
  const media = getMedia(fastify.mongo.db)

  const MAX_PHOTOS_PER_GALLERY = 50

  // Check gallery limit
  const existingGallery = await galleries.findOne({ userId: new ObjectId(user._id) })
  if (existingGallery) {
    const photoCount = await media.countDocuments({
      galleryId: existingGallery._id,
      type: 'photo'
    })
    if (photoCount >= MAX_PHOTOS_PER_GALLERY) {
      await sendMessageToBot(chatId, `❌ Ваш ліміт фото у галереї досягнуто. Ліміт: ${MAX_PHOTOS_PER_GALLERY}`)
      return
    }
  }

  // Upload to Cloudinary
  const uploadResult = await storage.upload(buffer, {
    folder: `wedding/${user.telegramId}`,
    mimetype
  })

  const now = new Date()
  let gallery = existingGallery

  // Create gallery if first upload
  if (!gallery) {
    const result = await galleries.insertOne({
      userId: new ObjectId(user._id),
      guestName: `${user.firstName} ${user.lastName}`.trim(),
      coverPhotoUrl: uploadResult.thumbnailUrl,
      photoCount: 0,
      createdAt: now,
      updatedAt: now
    })
    gallery = await galleries.findOne({ _id: result.insertedId })
  }

  // Save media record
  await media.insertOne({
    galleryId: gallery._id,
    userId: new ObjectId(user._id),
    type: 'photo',
    cloudId: uploadResult.cloudId,
    url: uploadResult.url,
    thumbnailUrl: uploadResult.thumbnailUrl,
    width: uploadResult.width,
    height: uploadResult.height,
    uploadedAt: now
  })

  // Update gallery count
  await galleries.updateOne(
    { _id: gallery._id },
    {
      $inc: { photoCount: 1 },
      $set: { updatedAt: now }
    }
  )
}
