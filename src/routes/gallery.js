const confirmedGuest = require('../middleware/confirmedGuest')
const adminOnly = require('../middleware/adminOnly')
const { getCollection: getGalleries } = require('../models/gallery')
const { getCollection: getMedia } = require('../models/media')
const { getCollection: getUsers } = require('../models/user')
const storage = require('../services/storage')

module.exports = async (fastify) => {
  fastify.addHook('onRequest', fastify.authenticate)

  fastify.get('/', {
    onRequest: confirmedGuest,
    schema: {
      tags: ['Gallery'],
      summary: 'List all guest galleries with previews',
      security: [{ bearerAuth: [] }],
      response: {
        200: {
          type: 'array',
          items: {
            type: 'object',
            required: ['id', 'photoCount', 'previews', 'user'],
            properties: {
              id: { type: 'string' },
              coverPhotoUrl: { type: 'string' },
              photoCount: { type: 'number' },
              previews: {
                type: 'array',
                items: { type: 'string' }
              },
              isOwner: { type: 'boolean' },
              user: {
                type: 'object',
                required: ['firstName', 'role'],
                properties: {
                  firstName: { type: 'string' },
                  lastName: { type: 'string' },
                  username: { type: 'string' },
                  role: { type: 'string', enum: ['admin', 'guest'] },
                  avatarUrl: { type: 'string' }
                }
              }
            }
          }
        }
      }
    }
  }, async (request) => {
    const galleries = getGalleries(fastify.mongo.db)
    const media = getMedia(fastify.mongo.db)
    const users = getUsers(fastify.mongo.db)

    const allGalleries = await galleries
      .find({ deletedAt: { $exists: false } })
      .sort({ updatedAt: -1 })
      .toArray()
      

    return Promise.all(allGalleries.filter(gallery => gallery.photoCount > 0).map(async (gallery) => {
      const previews = await media
        .find({ galleryId: gallery._id, type: 'photo' })
        .sort({ uploadedAt: -1 })
        .limit(3)
        .toArray()

      const user = await users.findOne({ _id: gallery.userId })

      return {
        ...gallery,
        id: gallery._id.toString(),
        previews: previews.map(p => p.thumbnailUrl),
        isOwner: String(gallery.userId) === String(request.user.id),
        user: {
          firstName: user.firstName,
          lastName: user.lastName,
          username: user.username,
          role: user.role,
          avatarUrl: user.avatarUrl
        }
      }
    }))
  })

  fastify.get('/:galleryId', {
    onRequest: confirmedGuest,
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
          required: ['id', 'isOwner', 'photoCount', 'photos'],
          properties: {
            id: { type: 'string' },
            isOwner: { type: 'boolean' },
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
            },
            user: {
              type: 'object',
              required: ['firstName', 'role'],
              properties: {
                firstName: { type: 'string' },
                lastName: { type: 'string' },
                username: { type: 'string' },
                role: { type: 'string', enum: ['admin', 'guest'] },
                avatarUrl: { type: 'string' }
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
    const users = getUsers(fastify.mongo.db)

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
      .find({ 
        galleryId: gallery._id, 
        type: 'photo',
        deletedAt: { $exists: false }
      })
      // When adding video: remove the type filter to return both photos and videos
      .sort({ uploadedAt: -1 })
      .toArray()

    const user = await users.findOne({ _id: gallery.userId })

    return {
      ...gallery,
      id: gallery._id.toString(),
      isOwner: String(gallery.userId) === String(request.user.id),
      photos: photos.map(p => ({
        ...p,
        id: p._id.toString()
      })),
      user: {
        firstName: user.firstName,
        lastName: user.lastName,
        username: user.username,
        role: user.role,
        avatarUrl: user.avatarUrl
      }
    }
  })

  // Soft delete — guest marks photo as deleted
  fastify.delete('/media/:mediaId', {
    onRequest: confirmedGuest,
    schema: {
      tags: ['Gallery'],
      summary: 'Soft delete a photo (owner only)',
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: { mediaId: { type: 'string' } }
      },
      response: {
        200: {
          type: 'object',
          required: ['message'],
          properties: { message: { type: 'string' } }
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
    if (!isOwner) {
      return reply.code(403).send({ message: 'Not allowed' })
    }

    await media.updateOne(
      { _id: new ObjectId(request.params.mediaId) },
      { $set: { deletedAt: new Date() } }
    )

    // Decrement gallery count
    await galleries.updateOne(
      { _id: item.galleryId },
      { $inc: { photoCount: -1 }, $set: { updatedAt: new Date() } }
    )

    return { message: 'Photo deleted' }
  })

  // Hard delete — admin permanently removes photo
  fastify.delete('/media/:mediaId/hard', {
    onRequest: adminOnly,
    schema: {
      tags: ['Gallery'],
      summary: 'Hard delete a photo (admin only)',
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: { mediaId: { type: 'string' } }
      },
      response: {
        200: {
          type: 'object',
          required: ['message'],
          properties: { message: { type: 'string' } }
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

    await storage.delete(item.cloudId, { type: item.type })
    await media.deleteOne({ _id: new ObjectId(request.params.mediaId) })

    await galleries.updateOne(
      { _id: item.galleryId },
      { $inc: { photoCount: -1 }, $set: { updatedAt: new Date() } }
    )

    return { message: 'Photo permanently deleted' }
  })

  // Soft delete gallery — guest marks gallery as deleted
  fastify.delete('/:galleryId', {
    onRequest: confirmedGuest,
    schema: {
      tags: ['Gallery'],
      summary: 'Soft delete a gallery (owner only)',
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: { galleryId: { type: 'string' } }
      },
      response: {
        200: {
          type: 'object',
          required: ['message'],
          properties: { message: { type: 'string' } }
        }
      }
    }
  }, async (request, reply) => {
    const { ObjectId } = fastify.mongo
    const media = getMedia(fastify.mongo.db)
    const galleries = getGalleries(fastify.mongo.db)

    let gallery
    try {
      gallery = await galleries.findOne({ _id: new ObjectId(request.params.galleryId) })
    } catch {
      return reply.code(400).send({ message: 'Invalid gallery ID' })
    }

    if (!gallery) return reply.code(404).send({ message: 'Gallery not found' })

    const isOwner = String(gallery.userId) === String(request.user.id)
    if (!isOwner) {
      return reply.code(403).send({ message: 'Not allowed' })
    }

    // Soft delete gallery and all its photos
    await galleries.updateOne(
      { _id: new ObjectId(request.params.galleryId) },
      { $set: { deletedAt: new Date() } }
    )

    await media.updateMany(
      { galleryId: new ObjectId(request.params.galleryId) },
      { $set: { deletedAt: new Date() } }
    )

    return { message: 'Gallery deleted' }
  })

  // Hard delete gallery — admin permanently removes gallery and all photos
  fastify.delete('/:galleryId/hard', {
    onRequest: adminOnly,
    schema: {
      tags: ['Gallery'],
      summary: 'Hard delete a gallery (admin only)',
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: { galleryId: { type: 'string' } }
      },
      response: {
        200: {
          type: 'object',
          required: ['message'],
          properties: { message: { type: 'string' } }
        }
      }
    }
  }, async (request, reply) => {
    const { ObjectId } = fastify.mongo
    const media = getMedia(fastify.mongo.db)
    const galleries = getGalleries(fastify.mongo.db)

    let gallery
    try {
      gallery = await galleries.findOne({ _id: new ObjectId(request.params.galleryId) })
    } catch {
      return reply.code(400).send({ message: 'Invalid gallery ID' })
    }

    if (!gallery) return reply.code(404).send({ message: 'Gallery not found' })

    // Delete all photos from storage
    const allMedia = await media
      .find({ galleryId: new ObjectId(request.params.galleryId) })
      .toArray()

    await Promise.all(allMedia.map(item => storage.delete(item.cloudId, { type: item.type })))

    // Delete from DB
    await media.deleteMany({ galleryId: new ObjectId(request.params.galleryId) })
    await galleries.deleteOne({ _id: new ObjectId(request.params.galleryId) })

    return { message: 'Gallery permanently deleted' }
  })
}
