async function sendMessageToBot (chatId, text) {
  const prodBotToken = process.env.BOT_TOKEN.split(',')[0]
  await fetch(`https://api.telegram.org/bot${prodBotToken}/sendMessage?chat_id=${chatId}&text=${text}`)
}

module.exports = {
  sendMessageToBot
}
