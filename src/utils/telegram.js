const PROD_BOT_TOKEN = process.env.BOT_TOKEN.split(',')[0]
const TELEGRAM_API = `https://api.telegram.org/bot${PROD_BOT_TOKEN}`

async function sendMessageToBot(chatIds, text) {
  chatIds.split(',').forEach(async chatId => {
    await fetch(`${TELEGRAM_API}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text })
    })
  })
}

module.exports = {
  sendMessageToBot,
  PROD_BOT_TOKEN,
  TELEGRAM_API
}
