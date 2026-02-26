const { getCollection: getRequests } = require('../models/guestRequest')
const { getCollection: getUsers } = require('../models/user')
const adminOnly = require('../middleware/adminOnly')

module.exports = async (fastify) => {
  fastify.addHook('onRequest', fastify.authenticate)

  /**
   * POST /api/guests/request
   * Authenticated user sends a request to become a guest.
   * Can only be called once — subsequent calls return current status.
   */
  fastify.post('/request', async (request, reply) => {
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

  /**
   * GET /api/guests/request/me
   * User checks the status of their own request.
   */
  fastify.get('/request/me', async (request, reply) => {
    const requests = getRequests(fastify.mongo.db)
    const req = await requests.findOne({ userId: request.user.id })
    if (!req) return reply.code(404).send({ message: 'No request found' })
    return { status: req.status }
  })

  /**
   * GET /api/guests/requests  [admin only]
   * Returns all guest requests enriched with Telegram user info.
   */
  fastify.get('/requests', { onRequest: adminOnly }, async () => {
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

  /**
   * PATCH /api/guests/requests/:requestId  [admin only]
   * Admin approves or denies a guest request.
   * On approval, user's role in the users collection is updated to 'guest'.
   */
  fastify.patch('/requests/:requestId', {
    onRequest: adminOnly,
    schema: {
      body: {
        type: 'object',
        required: ['action'],
        properties: {
          action: { type: 'string', enum: ['approve', 'deny'] }
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