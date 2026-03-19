const fp = require('fastify-plugin')
const multipart = require('@fastify/multipart')

module.exports = fp(async (fastify) => {
  fastify.register(multipart, {
    limits: {
      fileSize: 100 * 1024 * 1024, // 100MB max (per-type enforcement in route handler)
      files: 1
    }
  })
})
