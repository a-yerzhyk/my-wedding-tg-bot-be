const { getCollection: getUsers } = require('../models/user')

// Only approved guests who confirmed attendance can upload photos
module.exports = async function confirmedGuest(request, reply) {
  const { ObjectId } = request.server.mongo
  const users = getUsers(request.server.mongo.db)
  const user = await users.findOne({ _id: new ObjectId(request.user.id) })

  if (!user || user.approvalStatus !== 'approved') {
    return reply.code(403).send({ message: 'Only approved guests can upload photos' })
  }
}
