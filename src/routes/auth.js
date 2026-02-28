const crypto = require('crypto')
const { getCollection } = require('../models/user')

function validateTelegramData(initData, botToken) {
  const params = new URLSearchParams(initData)
  const hash = params.get('hash')
  if (!hash) return false
  params.delete('hash')

  const dataCheckString = Array.from(params.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n')

  const tokens = botToken.split(',')
  let isValid = false
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    const secretKey = crypto
      .createHmac('sha256', 'WebAppData')
      .update(token)
      .digest()
  
    const expectedHash = crypto
      .createHmac('sha256', secretKey)
      .update(dataCheckString)
      .digest('hex')
    
    if (expectedHash === hash) {
      isValid = true
      break
    }
  }

  return isValid
}

module.exports = async (fastify) => {
  fastify.post('/telegram', {
    schema: {
      tags: ['Auth'],
      summary: 'Authenticate via Telegram initData',
      body: {
        type: 'object',
        required: ['initData'],
        properties: {
          initData: { type: 'string' }
        }
      },
      response: {
        200: {
          type: 'object',
          required: ['user'],
          properties: {
            user: {
              type: 'object',
              required: ['firstName', 'role'],
              properties: {
                firstName: { type: 'string' },
                lastName: { type: 'string' },
                role: { type: 'string', enum: ['admin', 'guest'] },
                approvalStatus: { type: 'string', enum: ['pending', 'approved', 'denied'] }
              }
            }
          }
        }
      }
    }
  }, async (request, reply) => {
    const { initData } = request.body

    const isValid = validateTelegramData(initData, process.env.BOT_TOKEN)
    if (!isValid) {
      return reply.code(401).send({ message: 'Invalid Telegram data' })
    }

    const params = new URLSearchParams(initData)
    const telegramUser = JSON.parse(params.get('user'))

    if (!telegramUser?.id) {
      return reply.code(400).send({ message: 'No user data in initData' })
    }

    const users = getCollection(fastify.mongo.db)

    const adminIds = process.env.ADMIN_TELEGRAM_IDS.split(',').map(id => id.trim())
    const role = adminIds.includes(String(telegramUser.id)) ? 'admin' : 'guest'

    await users.updateOne(
      { telegramId: String(telegramUser.id) },
      {
        $set: {
          telegramId: String(telegramUser.id),
          firstName: telegramUser.first_name,
          lastName: telegramUser.last_name || '',
          username: telegramUser.username || '',
          role
        },
        $setOnInsert: {
          // admins are pre-approved, guests start with null (not yet requested)
          approvalStatus: adminIds.includes(String(telegramUser.id)) ? 'approved' : null,
          createdAt: new Date()
        }
      },
      { upsert: true }
    )

    const user = await users.findOne({ telegramId: String(telegramUser.id) })

    const token = fastify.jwt.sign(
      { id: user._id, telegramId: user.telegramId, role: user.role },
      { expiresIn: '30d' }
    )

    return reply
      .setCookie('jwt', token, {
        httpOnly: true,
        secure: true,
        sameSite: 'none',
        path: '/',
        maxAge: 3600 * 24 * 30
      })
      .send({
        user: {
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
          approvalStatus: user.approvalStatus ?? null
        }
      })
  })
}
