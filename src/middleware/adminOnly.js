module.exports = async function adminOnly(request, reply) {
  if (request.user.role !== 'admin') {
    return reply.code(403).send({ message: 'Admins only' })
  }
}
