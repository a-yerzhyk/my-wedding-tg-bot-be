const { getCollection } = require('../models/rsvp')
const { getCollection: getUsers } = require('../models/user')
const adminOnly = require('../middleware/adminOnly')

module.exports = async (fastify) => {
  fastify.addHook('onRequest', fastify.authenticate)

  fastify.post('/', {
    schema: {
      tags: ['RSVP'],
      summary: 'Submit or update RSVP',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['status'],
        properties: {
          status: { type: 'string', enum: ['attending', 'not_attending', 'maybe'] }
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
    const rsvps = getCollection(fastify.mongo.db)

    await rsvps.updateOne(
      { userId: request.user.id },
      {
        $set: {
          userId: request.user.id,
          status: request.body.status,
          updatedAt: new Date()
        },
        $setOnInsert: { createdAt: new Date() }
      },
      { upsert: true }
    )

    return { message: 'RSVP saved' }
  })

  fastify.get('/me', {
    schema: {
      tags: ['RSVP'],
      summary: 'Get own RSVP',
      security: [{ bearerAuth: [] }],
      response: {
        200: {
          type: 'object',
          required: ['userId', 'status', 'createdAt'],
          properties: {
            userId: { type: 'string' },
            status: { type: 'string' },
            createdAt: { type: 'string' },
            updatedAt: { type: 'string' }
          }
        }
      }
    }
  }, async (request, reply) => {
    const rsvps = getCollection(fastify.mongo.db)
    const rsvp = await rsvps.findOne({ userId: request.user.id })
    if (!rsvp) return reply.code(404).send({ message: 'No RSVP found yet' })
    return rsvp
  })

  fastify.get('/all', {
    onRequest: adminOnly,
    schema: {
      tags: ['RSVP'],
      summary: 'Get all RSVPs (admin only)',
      security: [{ bearerAuth: [] }],
      response: {
        200: {
          type: 'array',
          items: {
            type: 'object',
            required: ['userId', 'status', 'guest'],
            properties: {
              userId: { type: 'string' },
              status: { type: 'string' },
              guest: { type: 'string' }
            }
          }
        }
      }
    }
  }, async () => {
    const rsvps = getCollection(fastify.mongo.db)
    const users = getUsers(fastify.mongo.db)

    const allRsvps = await rsvps.find().toArray()

    return Promise.all(allRsvps.map(async (rsvp) => {
      const user = await users.findOne({ _id: rsvp.userId })
      return {
        ...rsvp,
        guest: user ? `${user.firstName} ${user.lastName}`.trim() : 'Unknown'
      }
    }))
  })

  fastify.get('/stats', {
    onRequest: adminOnly,
    schema: {
      tags: ['RSVP'],
      summary: 'Get attendance stats (admin only)',
      security: [{ bearerAuth: [] }],
      response: {
        200: {
          type: 'object',
          required: ['attending', 'notAttending', 'maybe'],
          properties: {
            attending: { type: 'number' },
            notAttending: { type: 'number' },
            maybe: { type: 'number' }
          }
        }
      }
    }
  }, async () => {
    const rsvps = getCollection(fastify.mongo.db)

    const [attending, notAttending, maybe] = await Promise.all([
      rsvps.countDocuments({ status: 'attending' }),
      rsvps.countDocuments({ status: 'not_attending' }),
      rsvps.countDocuments({ status: 'maybe' })
    ])

    return { attending, notAttending, maybe }
  })
}
