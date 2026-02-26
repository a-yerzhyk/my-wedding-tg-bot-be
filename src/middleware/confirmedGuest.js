const { getCollection } = require('../models/rsvp')

// Only guests who confirmed attendance (status: attending) can upload media
module.exports = async function confirmedGuest(request, reply) {
  if (request.user.status !== 'approved') {
    return reply.code(403).send({ message: 'Your request to join is pending admin approval' })
  }
  
  const rsvps = getCollection(request.server.mongo.db)
  const rsvp = await rsvps.findOne({ userId: request.user.id })

  if (!rsvp || rsvp.status !== 'attending') {
    return reply.code(403).send({ message: 'Only confirmed guests can see gallery' })
  }
}
