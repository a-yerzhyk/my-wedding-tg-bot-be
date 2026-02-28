module.exports = async function approvedGuest(request, reply) {
  if (request.user.approvalStatus !== 'approved') {
    return reply.code(403).send({ message: 'Your request to join is pending admin approval' })
  }
}