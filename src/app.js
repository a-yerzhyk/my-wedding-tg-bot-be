const fastify = require('fastify')({
  logger: true,
  ajv: {
    customOptions: {
      coerceTypes: 'array'
    }
  }
})

// Transform _id to id in all responses
fastify.addHook('preSerialization', async (request, reply, payload) => {
  const transform = (obj) => {
    if (Array.isArray(obj)) return obj.map(transform)
    if (obj && typeof obj === 'object') {
      const result = {}
      for (const [key, value] of Object.entries(obj)) {
        const newKey = key === '_id' ? 'id' : key
        result[newKey] = transform(value)
      }
      return result
    }
    return obj
  }

  return transform(payload)
})

fastify.register(require('@fastify/cors'), {
  origin: [
    'https://yz-wedding.vn.ua',
    'http://dev-wedding.vn.ua:3000'
  ],
  credentials: true
})

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
  routePrefix: '/api/docs',
  uiConfig: {
    persistAuthorization: true
  }
})

// Plugins
fastify.register(require('./plugins/mongodb'))
fastify.register(require('./plugins/jwt'))
fastify.register(require('./plugins/multipart'))

// Routes
fastify.register(require('./routes/auth'),    { prefix: '/api/auth' })
fastify.register(require('./routes/rsvp'),    { prefix: '/api/rsvp' })
fastify.register(require('./routes/gallery'), { prefix: '/api/gallery' })
fastify.register(require('./routes/guests'),  { prefix: '/api/guests' })

module.exports = fastify
