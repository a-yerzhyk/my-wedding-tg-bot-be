const fp = require('fastify-plugin')
const multipart = require('@fastify/multipart')

module.exports = fp(async (fastify) => {
  fastify.register(multipart, {
    limits: {
      fileSize: 10 * 1024 * 1024, // 10MB max per photo
      // When adding video support, increase this limit:
      // fileSize: 200 * 1024 * 1024, // 200MB for video
      files: 1
    }
  })
})
