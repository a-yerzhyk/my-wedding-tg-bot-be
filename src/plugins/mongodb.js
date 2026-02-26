const fp = require('fastify-plugin')
const fastifyMongo = require('@fastify/mongodb')

module.exports = fp(async (fastify) => {
  fastify.register(fastifyMongo, {
    url: process.env.MONGO_URL
  })
})
