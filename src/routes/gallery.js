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

  fastify.post('/upload', {
    onRequest: confirmedGuest,
    schema: {
      tags: ['Gallery'],
      summary: 'Upload a photo (confirmed guests only)',
      security: [{ bearerAuth: [] }],
      response: {
        201: {
          type: 'object',
          required: ['url', 'thumbnailUrl'],
          properties: {
            url: { type: 'string' },
            thumbnailUrl: { type: 'string' }
          }
        }
      }
    }
  }, async (request, reply) => {
    const { ObjectId } = fastify.mongo
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
    const existingGallery = await galleries.findOne({ userId: new ObjectId(request.user.id) })
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
    const user = await users.findOne({ _id: new ObjectId(request.user.id) })

    // Find or create gallery for this guest
    let gallery = existingGallery

    if (!gallery) {
      const result = await galleries.insertOne({
        userId: new ObjectId(request.user.id),
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
      userId: new ObjectId(request.user.id),
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

  fastify.get('/', {
    schema: {
      tags: ['Gallery'],
      summary: 'List all guest galleries with previews',
      security: [{ bearerAuth: [] }],
      response: {
        200: {
          type: 'array',
          items: {
            type: 'object',
            required: ['id', 'guestName', 'photoCount', 'previews'],
            properties: {
              id: { type: 'string' },
              guestName: { type: 'string' },
              coverPhotoUrl: { type: 'string' },
              photoCount: { type: 'number' },
              previews: {
                type: 'array',
                items: { type: 'string' }
              }
            }
          }
        }
      }
    }
  }, async () => {
    const galleries = getGalleries(fastify.mongo.db)
    const media = getMedia(fastify.mongo.db)

    const allGalleries = await galleries
      .find()
      .sort({ updatedAt: -1 })
      .toArray()

    return Promise.all(allGalleries.map(async (gallery) => {
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
  })

  fastify.get('/:galleryId', {
    schema: {
      tags: ['Gallery'],
      summary: 'Get a specific guest gallery with all photos',
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: {
          galleryId: { type: 'string' }
        }
      },
      response: {
        200: {
          type: 'object',
          required: ['id', 'guestName', 'photoCount', 'photos'],
          properties: {
            id: { type: 'string' },
            guestName: { type: 'string' },
            photoCount: { type: 'number' },
            photos: {
              type: 'array',
              items: {
                type: 'object',
                required: ['id', 'url', 'thumbnailUrl', 'uploadedAt'],
                properties: {
                  id: { type: 'string' },
                  url: { type: 'string' },
                  thumbnailUrl: { type: 'string' },
                  uploadedAt: { type: 'string' }
                }
              }
            }
          }
        }
      }
    }
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

  fastify.delete('/media/:mediaId', {
    schema: {
      tags: ['Gallery'],
      summary: 'Delete a photo (admin or owner)',
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: {
          mediaId: { type: 'string' }
        }
      },
      response: {
        200: {
          type: 'object',
          required: ['message'],
          properties: {
            message: { type: 'string' }
          }
        }
      }
    }
  }, async (request, reply) => {
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
