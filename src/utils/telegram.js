async function sendMessageToBot (chatIds, text) {
  const prodBotToken = process.env.BOT_TOKEN.split(',')[0]
  chatIds.split(',').forEach(async chatId => {
    await fetch(`https://api.telegram.org/bot${prodBotToken}/sendMessage?chat_id=${chatId}&text=${text}`)
  })
}

module.exports = {
  sendMessageToBot
}
