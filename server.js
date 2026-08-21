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

// 2. የዲፖዚት ጥያቄ መቀበያ ኤፒአይ (ለአድሚን አፕሩቭ ማድረጊያ ቁልፍ ጋር)
app.post('/api/deposit', async (req, res) => {
    try {
        const { identifier, amount, smsText } = req.body;
        if (!identifier || !amount || !smsText) {
            return res.status(400).json({ success: false, error: 'መረጃዎች ሙሉ አይደሉም' });
        }

        const newDep = new Deposit({ identifier, amount, smsText, status: 'pending' });
        await newDep.save();

        // ለአድሚን አፕሩቭ ማድረጊያ Inline Button መላክ
        const inlineKeyboard = {
            inline_keyboard: [
                [
                    { text: "✅ አፕሩቭ አድርግ (Approve)", callback_data: `approve_${newDep._id}` },
                    { text: "❌ ውድቅ አድርግ (Reject)", callback_data: `reject_${newDep._id}` }
                ]
            ]
        };

        bot.sendMessage(ADMIN_ID, `📥 **አዲስ የዲፖዚት ጥያቄ!**\n\nተጠቃሚ ID: ${identifier}\nመጠን: ${amount} ብር\nSMS: ${smsText}`, {
            reply_markup: inlineKeyboard
        });

        res.status(200).json({ success: true, message: 'የዲፖዚት ጥያቄዎ ለአድሚን ተልኳል!' });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// 3. አድሚኑ ቁልፉን ሲጫን (Callback Query) ብሩን ወደ ተጠቃሚው አካውንት የሚጨምርበት ሎጂክ
bot.on('callback_query', async (query) => {
    const data = query.data;
    const chatId = query.message.chat.id;

    if (chatId.toString() !== ADMIN_ID) {
        return bot.answerCallbackQuery(query.id, { text: "ይህንን ትዕዛዝ ለመፈጸም ፈቃድ የለዎትም!" });
    }

    if (data.startsWith('approve_')) {
        const depId = data.split('_')[1];
        try {
            const dep = await Deposit.findById(depId);
            if (!dep || dep.status === 'approved') {
                return bot.answerCallbackQuery(query.id, { text: "ጥያቄው አልተገኘም ወይም უკვე ተረጋግጧል!" });
            }

            // የዲፖዚት ሁኔታን መቀየር
            dep.status = 'approved';
            await dep.save();

            // ተጠቃሚው ላይ ብሩን መጨመር
            let user = await User.findOne({ identifier: dep.identifier });
            if (user) {
                user.balance += dep.amount;
                await user.save();
            }

            bot.editMessageText(`✅ **ዲፖዚቱ ተረጋግጧል!**\nለተጠቃሚ ID: ${dep.identifier} ${dep.amount} ብር ተጨምሯል።`, {
                chat_id: chatId,
                message_id: query.message.message_id
            });

            // ለተጠቃሚው ማሳወቂያ መላክ
            bot.sendMessage(dep.identifier, `🎉 የእርስዎ የ ${dep.amount} ብር የዲፖዚት ጥያቄ በአድሚን ጸድቋል! አሁን መጫወት ይችላሉ።`);

        } catch (e) {
            console.error(e);
        }
    } else if (data.startsWith('reject_')) {
        const depId = data.split('_')[1];
        await Deposit.findByIdAndUpdate(depId, { status: 'rejected' });
        bot.editMessageText(`❌ **የዲፖዚት ጥያቄው ውድቅ ተደርጓል።**`, {
            chat_id: chatId,
            message_id: query.message.message_id
        });
    }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`ሰርቨሩ በፖርት ${PORT} እየሰራ ነው...`);
});
