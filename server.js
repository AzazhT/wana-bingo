const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const TelegramBot = require('node-telegram-bot-api');

// 📌 የቦት ቶከን እና የአድሚን አይዲ
const TOKEN = '8957133551:AAGBPCGEzFLtJRXHRU0PfKJ2QXDf1AyvXec';
const ADMIN_ID = '686733543';
const WEBAPP_URL = 'https://wana-bingo.onrender.com'; // የ Render ሊንክዎ

const bot = new TelegramBot(TOKEN, { polling: true });

// ቋሚ የሜኑ ቁልፍ ከቻት ሳጥኑ ጎን እንዲኖር ማድረግ
bot.setChatMenuButton({
    menu_button: {
        type: 'web_app',
        text: '🎮 ፕሌይ ቢንጎ (Play Bingo)',
        web_app: { url: WEBAPP_URL }
    }
}).then(() => {
    console.log('የሜኑ ቁልፍ (Menu Button) በትክክል ተስተካክሏል!');
}).catch(err => {
    console.error('Menu button error:', err);
});

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.json());
app.use(express.static('public'));

// የሞንጎዲቢ ግንኙነት
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/addis_bingo';
mongoose.connect(MONGO_URI)
    .then(() => console.log('MongoDB ከሰርቨር ጋር በအောင်ኬት ተገናኝቷል!'))
    .catch(err => console.error('MongoDB Connection Error:', err));

// የተጠቃሚ ስኬማ (50 ብር ቦነስ አለው)
const userSchema = new mongoose.Schema({
    identifier: { type: String, required: true, unique: true },
    name: { type: String },
    balance: { type: Number, default: 50 },
    createdAt: { type: Date, default: Date.now }
});
const User = mongoose.model('User', userSchema);

// የዲፖዚት ስኬማ
const depositSchema = new mongoose.Schema({
    identifier: String,
    amount: Number,
    smsText: String,
    status: { type: String, default: 'pending' },
    createdAt: { type: Date, default: Date.now }
});
const Deposit = mongoose.model('Deposit', depositSchema);

// ቴሌግራም /start ትዕዛዝ
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, "እንኳን ወደ Wana Bingo መጡ! ጨዋታውን ለመጀመር እና አካውንትዎን ለማስተዳደር ከታች ያለውን ቁልፍ ይጫኑ፡", {
        reply_markup: {
            inline_keyboard: [
                [{ text: "🎮 ፕሌይ ቢንጎ (Play Bingo)", web_app: { url: WEBAPP_URL } }]
            ]
        }
    });
});

// 1. የተጠቃሚ ምዝገባ (Register / Auto-login) ኤፒአይ
app.post('/api/register', async (req, res) => {
    try {
        const { identifier, name } = req.body;
        if (!identifier) return res.status(400).json({ success: false, error: 'Telegram ID ያስፈልጋል' });

        let user = await User.findOne({ identifier });
        if (!user) {
            user = new User({ identifier, name: name || 'ተጫዋች', balance: 50 });
            await user.save();
        }
        res.status(200).json({ success: true, user });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// 2. የዲፖዚት ጥያቄ መቀበያ ኤፒአይ (ለአድሚን ማሳወቂያ ይልካል)
app.post('/api/deposit', async (req, res) => {
    try {
        const { identifier, amount, smsText } = req.body;
        if (!identifier || !amount || !smsText) {
            return res.status(400).json({ success: false, error: 'መረጃዎች ሙሉ አይደሉም' });
        }

        const newDep = new Deposit({ identifier, amount, smsText, status: 'pending' });
        await newDep.save();

        // ለአድሚን በቀጥታ ቴክስት መላክ
        bot.sendMessage(ADMIN_ID, `📥 **አዲስ የዲፖዚት ጥያቄ!**\n\nተጠቃሚ ID: ${identifier}\nመጠን: ${amount} ብር\nSMS: ${smsText}\n\nአይዲ: ${newDep._id}`);

        res.status(200).json({ success: true, message: 'የዲፖዚት ጥያቄዎ ለአድሚን ተልኳል!' });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`ሰርቨሩ በፖርት ${PORT} እየሰራ ነው...`);
});
