const { getCollection } = require('../models/rsvp')
const { getCollection: getUsers } = require('../models/user')
const adminOnly = require('../middleware/adminOnly')

module.exports = async (fastify) => {
  fastify.addHook('onRequest', fastify.authenticate)

  /**
   * POST /api/rsvp
   * Guest submits or updates their RSVP.
   */
  fastify.post('/', {
    schema: {
      tags: ['RSVP'],
      summary: 'Submit or update RSVP',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['status'],
        properties: {
          status: { type: 'string', enum: ['attending', 'not_attending', 'maybe'] },
          guestCount: { type: 'number', minimum: 1, maximum: 10 },
          dietaryNotes: { type: 'string' }
        }
      },
      response: {
        200: {
          type: 'object',
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
          guestCount: request.body.guestCount || 1,
          dietaryNotes: request.body.dietaryNotes || '',
          updatedAt: new Date()
        },
        $setOnInsert: { createdAt: new Date() }
      },
      { upsert: true }
    )

    return { message: 'RSVP saved' }
  })

  /**
   * GET /api/rsvp/me
   * Guest views their own RSVP.
   */
  fastify.get('/me', {
    schema: {
      tags: ['RSVP'],
      summary: 'Get own RSVP',
      security: [{ bearerAuth: [] }],
      response: {
        200: {
          type: 'object',
          properties: {
            userId: { type: 'string' },
            status: { type: 'string' },
            guestCount: { type: 'number' },
            dietaryNotes: { type: 'string' },
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

  /**
   * GET /api/rsvp/all  [admin only]
   * Returns all RSVPs enriched with guest names.
   */
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
            properties: {
              userId: { type: 'string' },
              status: { type: 'string' },
              guestCount: { type: 'number' },
              dietaryNotes: { type: 'string' },
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

    const enriched = await Promise.all(allRsvps.map(async (rsvp) => {
      const user = await users.findOne({ _id: rsvp.userId })
      return {
        ...rsvp,
        guest: user ? `${user.firstName} ${user.lastName}`.trim() : 'Unknown'
      }
    }))

    return enriched
  })

  /**
   * GET /api/rsvp/stats  [admin only]
   * Returns attendance summary counts.
   */
  fastify.get('/stats', {
    onRequest: adminOnly,
    schema: {
      tags: ['RSVP'],
      summary: 'Get attendance stats (admin only)',
      security: [{ bearerAuth: [] }],
      response: {
        200: {
          type: 'object',
          properties: {
            attending: { type: 'number' },
            notAttending: { type: 'number' },
            maybe: { type: 'number' },
            totalGuests: { type: 'number' }
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

    const attendingRsvps = await rsvps.find({ status: 'attending' }).toArray()
    const totalGuests = attendingRsvps.reduce((sum, r) => sum + (r.guestCount || 1), 0)

    return { attending, notAttending, maybe, totalGuests }
  })
}
