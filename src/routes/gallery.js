const { getCollection: getGalleries } = require('../models/gallery')
const { getCollection: getMedia } = require('../models/media')
const storage = require('../services/storage')

module.exports = async (fastify) => {
  fastify.addHook('onRequest', fastify.authenticate)

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
        id: gallery._id.toString(),
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
