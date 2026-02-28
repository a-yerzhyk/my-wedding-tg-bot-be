const fastify = require('fastify')({ logger: true })

// Swagger — must be registered before routes
fastify.register(require('@fastify/swagger'), {
  openapi: {
    info: {
      title: 'Wedding TMA API',
      description: 'Backend API for Wedding Telegram Mini App',
      version: '1.0.0'
    },
    servers: [
      { url: 'https://yz-wedding.vn.ua', description: 'Production' },
      { url: 'http://localhost:4000', description: 'Local' }
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT'
        }
      }
    }
  }
})

fastify.register(require('@fastify/swagger-ui'), {
  routePrefix: '/docs',
  uiConfig: {
    persistAuthorization: true  // keeps JWT filled in between page refreshes
  }
})

// Plugins
fastify.register(require('./plugins/mongodb'))
fastify.register(require('./plugins/jwt'))
fastify.register(require('./plugins/multipart'))

// Routes
fastify.register(require('./routes/auth'),    { prefix: '/api/auth' })
fastify.register(require('./routes/guests'), { prefix: '/api/guests' })
fastify.register(require('./routes/rsvp'),    { prefix: '/api/rsvp' })
fastify.register(require('./routes/gallery'), { prefix: '/api/gallery' })

module.exports = fastify
