const fp = require('fastify-plugin')
const fastifyJwt = require('@fastify/jwt')

module.exports = fp(async (fastify) => {
  fastify.register(fastifyJwt, {
    secret: process.env.JWT_SECRET,
    cookie: {
      cookieName: 'jwt',
      signed: false
    }
  })

  // Reusable auth guard — attach to any route with onRequest: fastify.authenticate
  fastify.decorate('authenticate', async (request, reply) => {
    try {
      await request.jwtVerify({ onlyCookie: true })
    } catch (err) {
      reply.send(err)
    }
  })
})
