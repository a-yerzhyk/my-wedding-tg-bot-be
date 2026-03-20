const confirmedGuest = require('../middleware/confirmedGuest')
const adminOnly = require('../middleware/adminOnly')
const { getCollection: getGalleries } = require('../models/gallery')
const { getCollection: getMedia } = require('../models/media')
const { getCollection: getUsers } = require('../models/user')
const storage = require('../services/storage')

const PHOTO_QUOTA_BYTES = 150 * 1024 * 1024 // 150 MB
const VIDEO_QUOTA_BYTES = 200 * 1024 * 1024 // 200 MB
const PHOTO_MAX_BYTES = 10 * 1024 * 1024    // 10 MB
const VIDEO_MAX_BYTES = 100 * 1024 * 1024   // 100 MB

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
              videoCount: { type: 'number' },
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

    const isAdmin = request.user.role === 'admin'
    let galleriesWithSoftDeleted = new Set()
    if (isAdmin) {
      const softDeleted = await media.aggregate([
        { $match: { deletedAt: { $exists: true } } },
        { $group: { _id: '$galleryId' } }
      ]).toArray()
      galleriesWithSoftDeleted = new Set(softDeleted.map(r => r._id.toString()))
    }

    return Promise.all(allGalleries.filter(gallery =>
      gallery.photoCount > 0 || gallery.videoCount > 0 ||
      galleriesWithSoftDeleted.has(gallery._id.toString())
    ).map(async (gallery) => {
      const previews = await media
        .find({ galleryId: gallery._id, type: 'photo', deletedAt: { $exists: false } })
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
      summary: 'Get a specific guest gallery with all photos and videos',
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
          required: ['id', 'isOwner', 'photoCount', 'photos', 'videos'],
          properties: {
            id: { type: 'string' },
            isOwner: { type: 'boolean' },
            photoCount: { type: 'number' },
            videoCount: { type: 'number' },
            photos: {
              type: 'array',
              items: {
                type: 'object',
                required: ['id', 'url', 'thumbnailUrl', 'uploadedAt'],
                properties: {
                  id: { type: 'string' },
                  url: { type: 'string' },
                  thumbnailUrl: { type: 'string' },
                  uploadedAt: { type: 'string' },
                  duration: { type: 'number', nullable: true },
                  deletedAt: { type: 'string' }
                }
              }
            },
            videos: {
              type: 'array',
              items: {
                type: 'object',
                required: ['id', 'url', 'thumbnailUrl', 'uploadedAt'],
                properties: {
                  id: { type: 'string' },
                  url: { type: 'string' },
                  thumbnailUrl: { type: 'string' },
                  uploadedAt: { type: 'string' },
                  duration: { type: 'number', nullable: true },
                  deletedAt: { type: 'string' }
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

    const isAdmin = request.user.role === 'admin'
    const mediaFilter = { galleryId: gallery._id }
    if (!isAdmin) mediaFilter.deletedAt = { $exists: false }

    const allMedia = await media
      .find(mediaFilter)
      .sort({ uploadedAt: -1 })
      .toArray()

    const photos = allMedia.filter(m => m.type === 'photo')
    const videos = allMedia.filter(m => m.type === 'video')

    const user = await users.findOne({ _id: gallery.userId })

    return {
      ...gallery,
      id: gallery._id.toString(),
      isOwner: String(gallery.userId) === String(request.user.id),
      photos: photos.map(p => ({ ...p, id: p._id.toString() })),
      videos: videos.map(v => ({ ...v, id: v._id.toString() })),
      user: {
        firstName: user.firstName,
        lastName: user.lastName,
        username: user.username,
        role: user.role,
        avatarUrl: user.avatarUrl
      }
    }
  })

  // Upload photo or video
  fastify.post('/upload', {
    onRequest: confirmedGuest,
    schema: {
      tags: ['Gallery'],
      summary: 'Upload a photo or video to the gallery',
      security: [{ bearerAuth: [] }],
      consumes: ['multipart/form-data'],
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
    const galleries = getGalleries(fastify.mongo.db)
    const media = getMedia(fastify.mongo.db)

    // Collect and validate all files before any uploads
    const files = []
    for await (const file of request.files()) {
      const { mimetype } = file
      let type
      if (mimetype.startsWith('video/')) {
        type = 'video'
      } else if (mimetype.startsWith('image/')) {
        type = 'photo'
      } else {
        return reply.code(400).send({ message: `Unsupported file type: ${mimetype}` })
      }

      const buffer = await file.toBuffer()

      if (type === 'photo' && buffer.length > PHOTO_MAX_BYTES) {
        return reply.code(400).send({ message: `Photo "${file.filename}" exceeds 10 MB limit` })
      }
      if (type === 'video' && buffer.length > VIDEO_MAX_BYTES) {
        return reply.code(400).send({ message: `Video "${file.filename}" exceeds 100 MB limit` })
      }

      files.push({ buffer, mimetype, type })
    }

    if (files.length === 0) {
      return reply.code(400).send({ message: 'No files uploaded' })
    }

    const userId = new ObjectId(request.user.id)

    // Quota check: compare existing usage + all new bytes per type in one pass
    const newPhotoBytes = files.filter(f => f.type === 'photo').reduce((sum, f) => sum + f.buffer.length, 0)
    const newVideoBytes = files.filter(f => f.type === 'video').reduce((sum, f) => sum + f.buffer.length, 0)

    const [photoAgg, videoAgg] = await Promise.all([
      newPhotoBytes > 0 ? media.aggregate([
        { $match: { userId, type: 'photo', deletedAt: { $exists: false } } },
        { $group: { _id: null, totalSize: { $sum: '$fileSize' } } }
      ]).toArray() : [],
      newVideoBytes > 0 ? media.aggregate([
        { $match: { userId, type: 'video', deletedAt: { $exists: false } } },
        { $group: { _id: null, totalSize: { $sum: '$fileSize' } } }
      ]).toArray() : []
    ])

    if (newPhotoBytes > 0 && ((photoAgg[0]?.totalSize ?? 0) + newPhotoBytes > PHOTO_QUOTA_BYTES)) {
      return reply.code(400).send({ message: 'Photo storage quota exceeded' })
    }
    if (newVideoBytes > 0 && ((videoAgg[0]?.totalSize ?? 0) + newVideoBytes > VIDEO_QUOTA_BYTES)) {
      return reply.code(400).send({ message: 'Video storage quota exceeded' })
    }

    // Upload all files in parallel
    const uploadResults = await Promise.all(
      files.map(f => storage.upload(f.buffer, {
        folder: `wedding/${request.user.telegramId}`,
        mimetype: f.mimetype
      }))
    )

    const now = new Date()
    let gallery = await galleries.findOne({ userId, deletedAt: { $exists: false } })

    if (!gallery) {
      const firstPhoto = uploadResults.find((_, i) => files[i].type === 'photo')
      const result = await galleries.insertOne({
        userId,
        coverPhotoUrl: firstPhoto?.thumbnailUrl ?? uploadResults[0].thumbnailUrl,
        photoCount: 0,
        videoCount: 0,
        createdAt: now,
        updatedAt: now
      })
      gallery = await galleries.findOne({ _id: result.insertedId })
    }

    // Insert all media records
    await media.insertMany(
      files.map((f, i) => ({
        galleryId: gallery._id,
        userId,
        type: f.type,
        cloudId: uploadResults[i].cloudId,
        url: uploadResults[i].url,
        thumbnailUrl: uploadResults[i].thumbnailUrl,
        width: uploadResults[i].width,
        height: uploadResults[i].height,
        duration: uploadResults[i].duration,
        fileSize: f.buffer.length,
        uploadedAt: now
      }))
    )

    // Increment counters
    const addedPhotos = files.filter(f => f.type === 'photo').length
    const addedVideos = files.filter(f => f.type === 'video').length
    const inc = {}
    if (addedPhotos > 0) inc.photoCount = addedPhotos
    if (addedVideos > 0) inc.videoCount = addedVideos
    await galleries.updateOne({ _id: gallery._id }, { $inc: inc, $set: { updatedAt: now } })

    return { message: `Uploaded ${files.length} file${files.length > 1 ? 's' : ''} successfully` }
  })

  // Soft delete — guest marks media as deleted
  fastify.delete('/media/:mediaId', {
    onRequest: confirmedGuest,
    schema: {
      tags: ['Gallery'],
      summary: 'Soft delete a photo or video (owner only)',
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

    if (!item) return reply.code(404).send({ message: 'Media not found' })

    const isOwner = String(item.userId) === String(request.user.id)
    if (!isOwner) {
      return reply.code(403).send({ message: 'Not allowed' })
    }

    await media.updateOne(
      { _id: new ObjectId(request.params.mediaId) },
      { $set: { deletedAt: new Date() } }
    )

    const countField = item.type === 'video' ? 'videoCount' : 'photoCount'
    await galleries.updateOne(
      { _id: item.galleryId },
      { $inc: { [countField]: -1 }, $set: { updatedAt: new Date() } }
    )

    return { message: 'Media deleted' }
  })

  // Hard delete — admin permanently removes media
  fastify.delete('/media/:mediaId/hard', {
    onRequest: adminOnly,
    schema: {
      tags: ['Gallery'],
      summary: 'Hard delete a photo or video (admin only)',
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

    if (!item) return reply.code(404).send({ message: 'Media not found' })

    await storage.delete(item.cloudId, { type: item.type })
    await media.deleteOne({ _id: new ObjectId(request.params.mediaId) })

    // Only decrement if not already soft-deleted (soft delete already decremented)
    if (!item.deletedAt) {
      const countField = item.type === 'video' ? 'videoCount' : 'photoCount'
      await galleries.updateOne(
        { _id: item.galleryId },
        { $inc: { [countField]: -1 }, $set: { updatedAt: new Date() } }
      )
    }

    return { message: 'Media permanently deleted' }
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

  // Hard delete gallery — admin permanently removes gallery and all media
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

    const allMedia = await media
      .find({ galleryId: new ObjectId(request.params.galleryId) })
      .toArray()

    await Promise.all(allMedia.map(item => storage.delete(item.cloudId, { type: item.type })))

    await media.deleteMany({ galleryId: new ObjectId(request.params.galleryId) })
    await galleries.deleteOne({ _id: new ObjectId(request.params.galleryId) })

    return { message: 'Gallery permanently deleted' }
  })
}
