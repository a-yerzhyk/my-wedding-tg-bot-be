const fastify = require('fastify')({ logger: true })

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
