const { getCollection: getUsers } = require('../models/user')
const adminOnly = require('../middleware/adminOnly')
const { sendMessageToBot } = require('../utils/telegram')

module.exports = async (fastify) => {
  fastify.addHook('onRequest', fastify.authenticate)

  /**
   * POST /api/guests/request
   * Authenticated user requests access.
   * Sets approvalStatus to 'pending' on the user document.
   */
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
    const { ObjectId } = fastify.mongo
    const users = getUsers(fastify.mongo.db)

    const user = await users.findOne({ _id: new ObjectId(request.user.id) })

    if (!user) {
      return reply.code(404).send({ message: 'User not found' })
    }
    
    if (user.approvalStatus) {
      const responses = {
        pending: 'Request already submitted',
        approved: 'Already approved',
        denied: 'Already denied'
      }
      return reply.code(200).send({ message: responses[user.approvalStatus] })
    }

    await users.updateOne(
      { _id: new ObjectId(request.user.id) },
      { $set: { approvalStatus: 'pending' } }
    )

    const text = `@${user.username} відправив запит на участь у святкуванні!`
    await sendMessageToBot(process.env.ADMIN_TELEGRAM_IDS, text)

    return reply.code(201).send({ message: 'Request submitted, waiting for admin approval' })
  })

  /**
   * GET /api/guests/requests  [admin only]
   * Returns all users who have submitted a request (approvalStatus is not null).
   */
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
            required: ['id', 'approvalStatus', 'createdAt'],
            properties: {
              id: { type: 'string' },
              firstName: { type: 'string' },
              lastName: { type: 'string' },
              username: { type: 'string' },
              approvalStatus: { type: 'string', enum: ['pending', 'approved', 'denied'] },
              createdAt: { type: 'string' }
            }
          }
        }
      }
    }
  }, async () => {
    const users = getUsers(fastify.mongo.db)

    const result = await users
      .find({ approvalStatus: { $exists: true, $ne: null }, role: 'guest' })
      .sort({ createdAt: -1 })
      .toArray()

    return result.map(user => ({
      id: user._id.toString(),
      firstName: user.firstName,
      lastName: user.lastName,
      username: user.username,
      approvalStatus: user.approvalStatus,
      createdAt: user.createdAt.toISOString()
    }))
  })

  /**
   * PATCH /api/guests/requests/:userId  [admin only]
   * Approve or deny a guest by their userId.
   */
  fastify.patch('/requests/:userId', {
    onRequest: adminOnly,
    schema: {
      tags: ['Guests'],
      summary: 'Approve or deny a guest request (admin only)',
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: {
          userId: { type: 'string' }
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
    const users = getUsers(fastify.mongo.db)

    let user
    try {
      user = await users.findOne({ _id: new ObjectId(request.params.userId) })
    } catch {
      return reply.code(400).send({ message: 'Invalid user ID' })
    }

    if (!user) return reply.code(404).send({ message: 'User not found' })

    if (user.approvalStatus !== 'pending') {
      return reply.code(400).send({ message: `User already ${user.approvalStatus}` })
    }

    const newStatus = request.body.action === 'approve' ? 'approved' : 'denied'

    await users.updateOne(
      { _id: new ObjectId(request.params.userId) },
      { $set: { approvalStatus: newStatus, resolvedAt: new Date() } }
    )

    const textForUser = newStatus === 'approved'
      ? 'Ваш запит на участь у святкуванні успішно підтверджений!🥳'
      : 'Запит на участь у святкуванні було відхилено.'
    await sendMessageToBot(user.telegramId, textForUser)

    return { message: `User ${newStatus}` }
  })
}
