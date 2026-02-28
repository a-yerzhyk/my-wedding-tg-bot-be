const { getCollection: getRequests } = require('../models/guestRequest')
const { getCollection: getUsers } = require('../models/user')
const adminOnly = require('../middleware/adminOnly')

module.exports = async (fastify) => {
  fastify.addHook('onRequest', fastify.authenticate)

  fastify.post('/request', {
    schema: {
      tags: ['Guests'],
      summary: 'Submit request to become a guest',
      security: [{ bearerAuth: [] }],
      response: {
        201: {
          type: 'object',
          required: ['message'],
          properties: {
            message: { type: 'string' }
          }
        }
      }
    }
  }, async (request, reply) => {
    const requests = getRequests(fastify.mongo.db)

    const existing = await requests.findOne({ userId: request.user.id })
    if (existing) {
      return reply.code(200).send({
        message: 'Request already submitted',
        status: existing.status
      })
    }

    await requests.insertOne({
      userId: request.user.id,
      telegramId: request.user.telegramId,
      status: 'pending',
      createdAt: new Date()
    })

    return reply.code(201).send({ message: 'Request submitted, waiting for admin approval' })
  })

  fastify.get('/request/me', {
    schema: {
      tags: ['Guests'],
      summary: 'Check own request status',
      security: [{ bearerAuth: [] }],
      response: {
        200: {
          type: 'object',
          required: ['status'],
          properties: {
            status: { type: 'string', enum: ['pending', 'approved', 'denied'] }
          }
        }
      }
    }
  }, async (request, reply) => {
    const requests = getRequests(fastify.mongo.db)
    const req = await requests.findOne({ userId: request.user.id })
    if (!req) return reply.code(404).send({ message: 'No request found' })
    return { status: req.status }
  })

  fastify.get('/requests', {
    onRequest: adminOnly,
    schema: {
      tags: ['Guests'],
      summary: 'List all guest requests (admin only)',
      security: [{ bearerAuth: [] }],
      response: {
        200: {
          type: 'array',
          items: {
            type: 'object',
            required: ['id', 'userId', 'status', 'createdAt'],
            properties: {
              id: { type: 'string' },
              userId: { type: 'string' },
              status: { type: 'string' },
              createdAt: { type: 'string' },
              user: {
                type: 'object',
                properties: {
                  firstName: { type: 'string' },
                  lastName: { type: 'string' },
                  username: { type: 'string' }
                }
              }
            }
          }
        }
      }
    }
  }, async () => {
    const requests = getRequests(fastify.mongo.db)
    const users = getUsers(fastify.mongo.db)

    const all = await requests.find().sort({ createdAt: -1 }).toArray()

    return Promise.all(all.map(async (req) => {
      const user = await users.findOne({ _id: req.userId })
      return {
        ...req,
        user: user ? {
          firstName: user.firstName,
          lastName: user.lastName,
          username: user.username
        } : null
      }
    }))
  })

  fastify.patch('/requests/:requestId', {
    onRequest: adminOnly,
    schema: {
      tags: ['Guests'],
      summary: 'Approve or deny a guest request (admin only)',
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: {
          requestId: { type: 'string' }
        }
      },
      body: {
        type: 'object',
        required: ['action'],
        properties: {
          action: { type: 'string', enum: ['approve', 'deny'] }
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
    const { ObjectId } = fastify.mongo
    const requests = getRequests(fastify.mongo.db)
    const users = getUsers(fastify.mongo.db)

    let guestRequest
    try {
      guestRequest = await requests.findOne({ _id: new ObjectId(request.params.requestId) })
    } catch {
      return reply.code(400).send({ message: 'Invalid request ID' })
    }

    if (!guestRequest) return reply.code(404).send({ message: 'Request not found' })
    if (guestRequest.status !== 'pending') {
      return reply.code(400).send({ message: `Request already ${guestRequest.status}` })
    }

    const newStatus = request.body.action === 'approve' ? 'approved' : 'denied'

    await requests.updateOne(
      { _id: new ObjectId(request.params.requestId) },
      { $set: { status: newStatus, resolvedAt: new Date() } }
    )

    // On approval — update the user's status so JWT refresh picks it up
    if (newStatus === 'approved') {
      await users.updateOne(
        { _id: guestRequest.userId },
        { $set: { status: 'approved' } }
      )
    }

    return { message: `Request ${newStatus}` }
  })
}
