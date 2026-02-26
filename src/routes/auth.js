const crypto = require('crypto')
const { getCollection } = require('../models/user')

/**
 * Validates that initData genuinely came from Telegram.
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
function validateTelegramData(initData, botToken) {
  const params = new URLSearchParams(initData)
  const hash = params.get('hash')
  if (!hash) return false
  params.delete('hash')

  const dataCheckString = Array.from(params.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n')

  const secretKey = crypto
    .createHmac('sha256', 'WebAppData')
    .update(botToken)
    .digest()

  const expectedHash = crypto
    .createHmac('sha256', secretKey)
    .update(dataCheckString)
    .digest('hex')

  return expectedHash === hash
}

module.exports = async (fastify) => {
  /**
   * POST /api/auth/telegram
   * Called on TMA startup — validates Telegram identity, returns JWT.
   * Vue sends: { initData: window.Telegram.WebApp.initData }
   */
  fastify.post('/telegram', {
    schema: {
      body: {
        type: 'object',
        required: ['initData'],
        properties: {
          initData: { type: 'string' }
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

    // Admins are identified by their Telegram ID set in .env
    const adminIds = process.env.ADMIN_TELEGRAM_IDS.split(',').map(id => id.trim())
    const role = adminIds.includes(String(telegramUser.id)) ? 'admin' : 'guest'

    // Upsert — creates user on first visit, updates name if changed
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
          status: adminIds.includes(String(telegramUser.id)) ? 'approved' : 'pending',
          createdAt: new Date()
        }
      },
      { upsert: true }
    )

    const user = await users.findOne({ telegramId: String(telegramUser.id) })

    const token = fastify.jwt.sign(
      { id: user._id, telegramId: user.telegramId, role: user.role, status: user.status },
      { expiresIn: '30d' }
    )

    return {
      token,
      user: {
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role
      }
    }
  })
}
