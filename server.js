const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const TelegramBot = require('node-telegram-bot-api');

const TOKEN = '8957133551:AAGBPCGEzFLtJRXHRU0PfKJ2QXDf1AyvXec';
const ADMIN_ID = '686733543';
const WEBAPP_URL = 'https://wana-bingo.onrender.com'; // የ Render ሊንክዎ

const bot = new TelegramBot(TOKEN, { polling: true });

// ከቻት ሳጥኑ ግርጌ ቋሚ የሜኑ ቁልፍ ማስተካከል
bot.setChatMenuButton({
    menu_button: {
        type: 'web_app',
        text: '🎮 ፕሌይ ቢንጎ (Play Bingo)',
        web_app: { url: WEBAPP_URL }
    }
}).catch(err => console.error('Menu button error:', err));

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static('public'));

// 1. የሞንጎዲቢ ግንኙነት
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/addis_bingo';
mongoose.connect(MONGO_URI)
    .then(() => console.log('MongoDB ከሰርቨር ጋር በအောင်ኬት ተገናኝቷል!'))
    .catch(err => console.error('MongoDB Connection Error:', err));

// 2. የተጠቃሚ ስኬማ (50 ብር ቦነስ አለው)
const userSchema = new mongoose.Schema({
    identifier: { type: String, required: true, unique: true },
    name: { type: String },
    balance: { type: Number, default: 50 },
    createdAt: { type: Date, default: Date.now }
});
const User = mongoose.model('User', userSchema);

// 3. የዲፖዚት ስኬማ
const depositSchema = new mongoose.Schema({
    identifier: String,
    amount: Number,
    smsText: String,
    status: { type: String, default: 'pending' },
    createdAt: { type: Date, default: Date.now }
});
const Deposit = mongoose.model('Deposit', depositSchema);

// 4. የዊዝድሮ ስኬማ
const withdrawSchema = new mongoose.Schema({
    identifier: String,
    amount: Number,
    phone: String,
    status: { type: String, default: 'pending' },
    createdAt: { type: Date, default: Date.now }
});
const Withdraw = mongoose.model('Withdraw', withdrawSchema);

// --- 5. ቴሌግራም /start ትዕዛዝ ---
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, "እንኳን ወደ Wana Bingo መጡ! ጨዋታውን ለመጀመር እና አካውንትዎን ለማስተዳደር ከታች ያለውን ቁልፍ ይጫኑ፡", {
        reply_markup: {
            inline_keyboard: [
                [
                    {
                        text: "🎮 ፕሌይ ቢንጎ (Play Bingo)",
                        web_app: { url: WEBAPP_URL }
                    }
                ]
            ]
        }
    });
});

// --- 6. ኤፒአይዎች (APIs) ---

// ምዝገባ እና 50 ብር ቦነስ
app.post('/api/register', async (req, res) => {
    try {
        const { identifier, name } = req.body;
        if (!identifier) return res.status(400).json({ success: false, error: 'ስልክ ቁጥር ወይም ቴሌግራም ID ያስፈልጋል' });

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

// ዲፖዚት (ብር ማስገባት) - ለአድሚን ቴክስት ይልካል
app.post('/api/deposit', async (req, res) => {
    try {
        const { identifier, amount, smsText } = req.body;
        if (!identifier || !amount || !smsText) {
            return res.status(400).json({ success: false, error: 'መረጃዎች ሙሉ አይደሉም' });
        }

        const newDep = new Deposit({ identifier, amount, smsText, status: 'pending' });
        await newDep.save();

        // ለአድሚን በቴሌግራም ማሳወቂያ መላክ
        bot.sendMessage(ADMIN_ID, `📥 **አዲስ የዲፖዚት ጥያቄ!**\n\nተጠቃሚ: ${identifier}\nመጠን: ${amount} ብር\nመልእክት: ${smsText}\n\nአይዲ: ${newDep._id}`);

        res.status(200).json({ success: true, message: 'የዲፖዚት ጥያቄዎ ለአድሚን ተልኳል!' });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// ዊዝድሮ (ብር ማውጣት) - ከባላንስ ቀንሶ ለአድሚን ቴክስት ይልካል
app.post('/api/withdraw', async (req, res) => {
    try {
        const { identifier, amount, phone } = req.body;
        if (!identifier || !amount || !phone) {
            return res.status(400).json({ success: false, error: 'መረጃዎች ሙሉ አይደሉም' });
        }

        let user = await User.findOne({ identifier });
        if (!user || user.balance < amount) {
            return res.status(400).json({ success: false, error: 'በቂ የሂሳብ መጠን (Balance) የለዎትም!' });
        }

        user.balance -= Number(amount);
        await user.save();

        const newWith = new Withdraw({ identifier, amount, phone, status: 'pending' });
        await newWith.save();

        // ለአድሚን በቴሌግራም ማሳወቂያ መላክ
        bot.sendMessage(ADMIN_ID, `📤 **አዲስ የዊዝድሮ ጥያቄ!**\n\nተጠቃሚ: ${identifier}\nስልክ: ${phone}\nመጠን: ${amount} ብር`);

        res.status(200).json({ success: true, message: 'የዊዝድሮ ጥያቄዎ ተልኳል!', balance: user.balance });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// አድሚን ዲፖዚት አፕሩቭ ሲያደርግ ብሩ ተጠቃሚው አካውንት ላይ ይገባል
app.post('/api/admin/approve-deposit', async (req, res) => {
    try {
        const { depositId } = req.body;
        const dep = await Deposit.findById(depositId);
        if (!dep || dep.status !== 'pending') {
            return res.status(400).json({ success: false, error: 'ጥያቄው አልተገኘም ወይም ተይዟል' });
        }

        dep.status = 'approved';
        await dep.save();

        let user = await User.findOne({ identifier: dep.identifier });
        if (user) {
            user.balance += dep.amount;
            await user.save();
        }

        res.json({ success: true, message: 'ብር ተጠቃሚው አካውንት ላይ በအောင်ኬት ገብቷል!' });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// --- 7. ሶኬት.አይኦ ---
io.on('connection', (socket) => {
    console.log('ተጠቃሚ ተገናኝቷል:', socket.id);
    socket.on('disconnect', () => {
        console.log('ተጠቃሚ ወጥቷል:', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`ሰርቨሩ በፖርት ${PORT} እየሰራ ነው...`);
});
