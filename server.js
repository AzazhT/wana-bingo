const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

// የቦት ቶከን
const TOKEN = '8957133551:AAGBPCGEzFLtJRXHRU0PfKJ2QXDf1AyvXec';
const bot = new TelegramBot(TOKEN, { polling: true });

// ቀላል የተጠቃሚዎች መረጃ (በዳታቤዝ ምትክ)
const users = {}; 

bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, "🎮 ወደ ዋና ቢንጎ (Wana Bingo) እንኳን በደህና መጡ! ለመጫወት መጀመሪያ መመዝገብ አለብዎት።", {
        reply_markup: {
            inline_keyboard: [
                [{ text: '👤 Register', callback_data: 'register' }]
            ]
        }
    });
});

bot.on('callback_query', (query) => {
    const chatId = query.message.chat.id;
    if (query.data === 'register') {
        bot.sendMessage(chatId, "እባክዎ መመዝገብዎን ለመጨረስ 'Share Phone Number' የሚለውን በተን ይጫኑ።", {
            reply_markup: {
                keyboard: [[{ text: '📞 Share Phone Number', request_contact: true }]],
                one_time_keyboard: true,
                resize_keyboard: true
            }
        });
    }
});

bot.on('contact', (msg) => {
    const chatId = msg.chat.id;
    const phoneNumber = msg.contact.phone_number;
    users[chatId] = { phone: phoneNumber, registered: true };
    
    bot.sendMessage(chatId, "✅ እንኳን ደስ አለዎት! በተሳካ ሁኔታ ተመዝግበዋል። አሁን ከታች ያሉትን አማራጮች መጠቀም ይችላሉ።", {
        reply_markup: {
            inline_keyboard: [
                [{ text: '🎮 Play now', web_app: { url: 'https://wana-bingo.onrender.com' } }],
                [{ text: '💰 Check Balance', callback_data: 'balance' }, { text: '📋 Game Instruction', callback_data: 'instr' }],
                [{ text: '📥 Deposit', callback_data: 'deposit' }, { text: '📞 Contact Us', callback_data: 'support' }]
            ]
        }
    });
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
