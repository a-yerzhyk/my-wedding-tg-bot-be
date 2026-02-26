const { getCollection: getGalleries } = require('../models/gallery')
const { getCollection: getMedia } = require('../models/media')
const { getCollection: getUsers } = require('../models/user')
const confirmedGuest = require('../middleware/confirmedGuest')
const adminOnly = require('../middleware/adminOnly')
const storage = require('../services/storage')

// Max photos per gallery — not a Cloudinary limit, just keeps things tidy
const MAX_PHOTOS_PER_GALLERY = 50

module.exports = async (fastify) => {
  fastify.addHook('onRequest', fastify.authenticate)

  /**
   * POST /api/gallery/upload
   * Confirmed guest uploads a photo.
   * Auto-creates a gallery on first upload.
   */
  fastify.post('/upload', {
    onRequest: confirmedGuest
  }, async (request, reply) => {
    const data = await request.file()

    if (!data) {
      return reply.code(400).send({ message: 'No file provided' })
    }

    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp']
    // When adding video support, extend this array:
    // const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime']
    if (!allowedTypes.includes(data.mimetype)) {
      return reply.code(400).send({ message: 'Only JPEG, PNG and WebP are allowed' })
    }

    const galleries = getGalleries(fastify.mongo.db)
    const media = getMedia(fastify.mongo.db)
    const users = getUsers(fastify.mongo.db)

    // Check upload limit
    const existingGallery = await galleries.findOne({ userId: request.user.id })
    if (existingGallery) {
      const photoCount = await media.countDocuments({
        galleryId: existingGallery._id,
        type: 'photo'
      })
      if (photoCount >= MAX_PHOTOS_PER_GALLERY) {
        return reply.code(400).send({
          message: `Gallery limit reached (${MAX_PHOTOS_PER_GALLERY} photos max)`
        })
      }
    }

    // Upload to cloud storage via abstraction layer
    const buffer = await data.toBuffer()
    const uploadResult = await storage.upload(buffer, {
      folder: `wedding/${request.user.telegramId}`,
      mimetype: data.mimetype
    })

    const now = new Date()
    const user = await users.findOne({ _id: request.user.id })

    // Find or create gallery for this guest
    let gallery = existingGallery

    if (!gallery) {
      const result = await galleries.insertOne({
        userId: request.user.id,
        guestName: `${user.firstName} ${user.lastName}`.trim(),
        coverPhotoUrl: uploadResult.thumbnailUrl, // first photo becomes the cover
        photoCount: 0,
        createdAt: now,
        updatedAt: now
      })
      gallery = await galleries.findOne({ _id: result.insertedId })
    }

    // Save media record
    await media.insertOne({
      galleryId: gallery._id,
      userId: request.user.id,
      type: 'photo',
      // When adding video: type: data.mimetype.startsWith('video') ? 'video' : 'photo'
      cloudId: uploadResult.cloudId,
      url: uploadResult.url,
      thumbnailUrl: uploadResult.thumbnailUrl,
      width: uploadResult.width,
      height: uploadResult.height,
      uploadedAt: now
    })

    // Increment gallery photo count
    await galleries.updateOne(
      { _id: gallery._id },
      {
        $inc: { photoCount: 1 },
        $set: { updatedAt: now }
      }
    )

    return reply.code(201).send({
      url: uploadResult.url,
      thumbnailUrl: uploadResult.thumbnailUrl
    })
  })

  /**
   * GET /api/gallery
   * Returns all guest galleries with 3 preview thumbnails each.
   * Visible to guests.
   */
  fastify.get('/', {
    onRequest: confirmedGuest
  }, async () => {
    const galleries = getGalleries(fastify.mongo.db)
    const media = getMedia(fastify.mongo.db)

    const allGalleries = await galleries
      .find()
      .sort({ updatedAt: -1 })
      .toArray()

    const enriched = await Promise.all(allGalleries.map(async (gallery) => {
      const previews = await media
        .find({ galleryId: gallery._id, type: 'photo' })
        .sort({ uploadedAt: -1 })
        .limit(3)
        .toArray()

      return {
        ...gallery,
        previews: previews.map(p => p.thumbnailUrl)
      }
    }))

    return enriched
  })

  /**
   * GET /api/gallery/:galleryId
   * Returns a specific guest's full gallery with all photos.
   * Visible to guests.
   */
  fastify.get('/:galleryId', {
    onRequest: confirmedGuest
  }, async (request, reply) => {
    const { ObjectId } = fastify.mongo
    const galleries = getGalleries(fastify.mongo.db)
    const media = getMedia(fastify.mongo.db)

    let gallery
    try {
      gallery = await galleries.findOne({ _id: new ObjectId(request.params.galleryId) })
    } catch {
      return reply.code(400).send({ message: 'Invalid gallery ID' })
    }

    if (!gallery) {
      return reply.code(404).send({ message: 'Gallery not found' })
    }

    const photos = await media
      .find({ galleryId: gallery._id, type: 'photo' })
      // When adding video: remove the type filter to return both photos and videos
      .sort({ uploadedAt: -1 })
      .toArray()

    return { ...gallery, photos }
  })

  /**
   * DELETE /api/gallery/media/:mediaId
   * Deletes a single photo. Allowed for: admin or the photo owner.
   */
  fastify.delete('/media/:mediaId', async (request, reply) => {
    const { ObjectId } = fastify.mongo
    const media = getMedia(fastify.mongo.db)
    const galleries = getGalleries(fastify.mongo.db)

    let item
    try {
      item = await media.findOne({ _id: new ObjectId(request.params.mediaId) })
    } catch {
      return reply.code(400).send({ message: 'Invalid media ID' })
    }

    if (!item) return reply.code(404).send({ message: 'Photo not found' })

    const isOwner = String(item.userId) === String(request.user.id)
    const isAdmin = request.user.role === 'admin'
    if (!isOwner && !isAdmin) {
      return reply.code(403).send({ message: 'Not allowed' })
    }

    // Delete from cloud storage
    await storage.delete(item.cloudId, { type: item.type })

    await media.deleteOne({ _id: new ObjectId(request.params.mediaId) })

    // Keep gallery count accurate
    await galleries.updateOne(
      { _id: item.galleryId },
      {
        $inc: { photoCount: -1 },
        $set: { updatedAt: new Date() }
      }
    )

    return { message: 'Photo deleted' }
  })
}
