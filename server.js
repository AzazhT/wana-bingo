const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const TelegramBot = require('node-telegram-bot-api');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.json());
app.use(express.static('public'));

// 📌 የአካባቢ ተለዋዋጮች
const TOKEN = process.env.BOT_TOKEN || '8957133551:AAGBPCGEzFLtJRXHRU0PfKJ2QXDf1AyvXec';
const ADMIN_ID = process.env.ADMIN_ID || '686733543';
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/addis_bingo';
// ⚠️ እዚህ ጋር የ Render አፕሊኬሽንህን ትክክለኛ URL ተካ!
const WEB_APP_URL = process.env.WEB_APP_URL || 'https://YOUR-APP-NAME.onrender.com';

const bot = new TelegramBot(TOKEN, { polling: true });

bot.on('polling_error', (error) => {
    if (error.code === 'ETELEGRAM' && error.message.includes('409 Conflict')) return;
    console.error('Telegram Polling Error:', error.message);
});

// 📌 1. የ /start ትዕዛዝ ሲላክ የሚሰራ ሎጂክ (ይህ ነው ጎድሎ የነበረው!)
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const firstName = msg.from.first_name || 'ተጫዋች';

    const welcomeMessage = `👋 ሰላም **${firstName}**!\n\nእንኳን ወደ **Wana Bingo** በደህና መጡ! 🎲🎉\n\nከታች ያለውን **"🎮 ጨዋታውን ጀምር"** የሚለውን በተን በመጫን ቢንጎ መጫወት እና ማሸነፍ ይችላሉ!`;

    const options = {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [
                [
                    { 
                        text: "🎮 ጨዋታውን ጀምር (Play Bingo)", 
                        web_app: { url: WEB_APP_URL } 
                    }
                ],
                [
                    { text: "📞 እገዛ (Support)", callback_data: "help_info" }
                ]
            ]
        }
    };

    bot.sendMessage(chatId, welcomeMessage, options);
});

// 📌 2. የዳታቤዝ ስኬማዎች (Database Schemas)
const userSchema = new mongoose.Schema({
    identifier: { type: String, required: true, unique: true },
    username: { type: String, default: '' },
    name: { type: String, default: 'ተጫዋች' },
    phone: { type: String, default: '' },
    balance: { type: Number, default: 50 },
    registeredAt: { type: Date, default: Date.now }
});
const User = mongoose.model('User', userSchema);

const transactionSchema = new mongoose.Schema({
    identifier: { type: String, required: true },
    type: { type: String, enum: ['DEPOSIT', 'WITHDRAW'], required: true },
    amount: { type: Number, required: true },
    details: { type: String, required: true },
    status: { type: String, enum: ['PENDING', 'APPROVED', 'REJECTED'], default: 'PENDING' },
    createdAt: { type: Date, default: Date.now }
});
const Transaction = mongoose.model('Transaction', transactionSchema);

// MongoDB Connection
mongoose.connect(MONGO_URI)
    .then(() => console.log('MongoDB Connected!'))
    .catch(err => console.error('MongoDB Error:', err));

// 📌 3. API ENDPOINTS
app.post('/api/get-user', async (req, res) => {
    try {
        const { identifier, name, username, phone } = req.body;
        if (!identifier) return res.status(400).json({ success: false, error: 'ID ያስፈልጋል' });

        let user = await User.findOne({ identifier: String(identifier) });

        if (!user) {
            user = new User({
                identifier: String(identifier),
                username: username || '',
                name: name || 'ተጫዋች',
                phone: phone || '',
                balance: 50 
            });
            await user.save();
        } else {
            let updated = false;
            if (username && user.username !== username) { user.username = username; updated = true; }
            if (name && user.name !== name) { user.name = name; updated = true; }
            if (updated) await user.save();
        }

        res.status(200).json({ success: true, user });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

app.post('/api/place-bet', async (req, res) => {
    try {
        const { identifier, amount } = req.body;
        const user = await User.findOne({ identifier: String(identifier) });

        if (!user) return res.status(404).json({ success: false, message: 'ተጠቃሚው አልተገኘም' });
        if (user.balance < amount) return res.status(400).json({ success: false, message: 'በቂ ባላንስ የለዎትም!' });

        user.balance -= amount;
        await user.save();

        res.status(200).json({ success: true, newBalance: user.balance });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

app.post('/api/request-transaction', async (req, res) => {
    try {
        const { identifier, type, amount, details } = req.body;
        if (!identifier || !type || !amount || !details) {
            return res.status(400).json({ success: false, message: 'ሁሉንም መረጃዎች ያሟሉ' });
        }

        const trans = new Transaction({
            identifier: String(identifier),
            type,
            amount: Number(amount),
            details
        });
        await trans.save();

        const inlineKeyboard = {
            inline_keyboard: [
                [
                    { text: "✅ አጽድቅ (Approve)", callback_data: `approve_${trans._id}` },
                    { text: "❌ ውድቅ አድርግ (Reject)", callback_data: `reject_${trans._id}` }
                ]
            ]
        };

        bot.sendMessage(
            ADMIN_ID,
            `📥 **አዲስ የ${type} ጥያቄ!**\n\n👤 ተጠቃሚ ID: \`${identifier}\`\n💰 መጠን: ${amount} ETB\n📝 ዝርዝር/SMS: ${details}`,
            { parse_mode: 'Markdown', reply_markup: inlineKeyboard }
        );

        res.status(200).json({ success: true, message: 'ጥያቄዎ ለአድሚን ተልኳል!' });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// 📌 4. TELEGRAM CALLBACK QUERY (አድሚን አፕሩቭ ሲያደርግ እና የእገዛ በተን)
bot.on('callback_query', async (query) => {
    const data = query.data;
    const chatId = query.message.chat.id;

    if (data === 'help_info') {
        return bot.answerCallbackQuery(query.id, { 
            text: "ለማንኛውም ጥያቄ ወይም እገዛ በአድሚን አድራሻ ያግኙን!", 
            show_alert: true 
        });
    }

    if (chatId.toString() !== ADMIN_ID) {
        return bot.answerCallbackQuery(query.id, { text: "ፈቃድ የለዎትም!" });
    }

    const [action, transId] = data.split('_');
    try {
        const trans = await Transaction.findById(transId);
        if (!trans || trans.status !== 'PENDING') {
            return bot.answerCallbackQuery(query.id, { text: "ጥያቄው አልተገኘም ወይም ቀድሞ ተስተናግዷል!" });
        }

        const user = await User.findOne({ identifier: trans.identifier });

        if (action === 'approve') {
            trans.status = 'APPROVED';
            if (trans.type === 'DEPOSIT') {
                if (user) user.balance += trans.amount;
            } else if (trans.type === 'WITHDRAW') {
                if (user && user.balance >= trans.amount) {
                    user.balance -= trans.amount;
                } else {
                    return bot.sendMessage(ADMIN_ID, `❌ ተጠቃሚው በቂ ባላንስ የለውም።`);
                }
            }
            if (user) await user.save();
            await trans.save();

            bot.editMessageText(`✅ የ${trans.type} ጥያቄ ጸድቋል።\nተጠቃሚ ID: ${trans.identifier}\nመጠን: ${trans.amount} ETB`, {
                chat_id: chatId, message_id: query.message.message_id
            });

            bot.sendMessage(trans.identifier, `🎉 የእርስዎ የ ${trans.amount} ETB ${trans.type} ጥያቄ ጸድቋል!`);

        } else if (action === 'reject') {
            trans.status = 'REJECTED';
            await trans.save();

            bot.editMessageText(`❌ የ${trans.type} ጥያቄ ውድቅ ተደርጓል።`, {
                chat_id: chatId, message_id: query.message.message_id
            });

            bot.sendMessage(trans.identifier, `❌ የእርስዎ የ ${trans.amount} ETB ${trans.type} ጥያቄ ውድቅ ተደርጓል።`);
        }
    } catch (e) {
        console.error('Callback Error:', e);
    }
});

// 📌 5. SOCKET.IO BINGO LOGIC
io.on('connection', (socket) => {
    let gameInterval = null;

    socket.on('startGame', () => {
        let drawnNumbers = [];
        clearInterval(gameInterval);

        gameInterval = setInterval(() => {
            if (drawnNumbers.length >= 75) {
                clearInterval(gameInterval);
                io.emit('gameOver', { message: 'ጨዋታው ተጠናቋል!' });
                return;
            }

            let rand;
            do {
                rand = Math.floor(Math.random() * 75) + 1;
            } while (drawnNumbers.includes(rand));

            drawnNumbers.push(rand);
            io.emit('numberDrawn', { number: rand, drawnHistory: drawnNumbers });
        }, 3000);
    });

    socket.on('claimBingo', async (data) => {
        clearInterval(gameInterval);
        const { identifier, winAmount } = data;

        if (identifier && winAmount) {
            try {
                const user = await User.findOne({ identifier: String(identifier) });
                if (user) {
                    user.balance += parseFloat(winAmount);
                    await user.save();
                }
            } catch (err) {
                console.error("የማሸነፊያ ብር ዳታቤዝ ማስገባት አልተቻለም:", err);
            }
        }

        io.emit('gameOver', { message: `አሸናፊ ተገኝቷል!` });
    });

    socket.on('disconnect', () => {
        clearInterval(gameInterval);
    });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
    console.log(`Bingo Backend Server runs on port ${PORT}`);
});
