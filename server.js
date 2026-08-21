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

const bot = new TelegramBot(TOKEN, { polling: true });

bot.on('polling_error', (error) => {
    if (error.code === 'ETELEGRAM' && error.message.includes('409 Conflict')) return;
    console.error('Telegram Polling Error:', error.message);
});

// 📌 1. የተሻሻለ የተጠቃሚዎች ዳታቤዝ ስኬማ (Telegram ID + Username)
const userSchema = new mongoose.Schema({
    identifier: { type: String, required: true, unique: true }, // Telegram ID
    username: { type: String, default: '' },                   // Telegram Username (@username)
    name: { type: String, default: 'ተጫዋች' },
    phone: { type: String, default: '' },
    balance: { type: Number, default: 50 },                   // ለመጀመሪያ ጊዜ አዲስ ምዝገባ ብቻ የሚሰጥ ቦነስ
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

// 📌 የሞንጎዲቢ ግንኙነት
mongoose.connect(MONGO_URI)
    .then(() => console.log('MongoDB Database Successfully Connected!'))
    .catch(err => console.error('MongoDB Connection Error:', err));

// 📌 2. API ENDPOINTS

// ሀ) አውቶማቲክ ምዝገባ እና ዳታ ማወጫ (Get User / Auto-Register)
app.post('/api/get-user', async (req, res) => {
    try {
        const { identifier, name, username, phone } = req.body;
        if (!identifier) {
            return res.status(400).json({ success: false, error: 'Telegram ID አልተገኘም' });
        }

        let user = await User.findOne({ identifier: String(identifier) });

        if (!user) {
            // 🆕 አዲስ ተጠቃሚ ከሆነ ብቻ 50 ብር ይሰጠዋል
            user = new User({
                identifier: String(identifier),
                username: username || '',
                name: name || 'ተጫዋች',
                phone: phone || '',
                balance: 50 
            });
            await user.save();
            console.log(`አዲስ ተጠቃሚ ተመዝግቧል: ID=${identifier}, Username=@${username}`);
        } else {
            // 🔄 ነባር ተጠቃሚ ከሆነ Username ወይም ስም ከተቀየረ ያዝምነዋል (ባላንሱን ግን አይነካውም!)
            let updated = false;
            if (username && user.username !== username) { user.username = username; updated = true; }
            if (name && user.name !== name) { user.name = name; updated = true; }
            if (updated) await user.save();
        }

        // የቆየውን ትክክለኛ ባላንስ ይመልሳል
        res.status(200).json({ success: true, user });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// ለ) የጨዋታ ውርርድ መቀነሻ ኤፒአይ (Place Bet)
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

// ሐ) የዲፖዚት እና ዊዝድሮው ጥያቄ መላኪያ
app.post('/api/request-transaction', async (req, res) => {
    try {
        const { identifier, type, amount, details } = req.body;
        if (!identifier || !type || !amount || !details) {
            return res.status(400).json({ success: false, message: 'እባክዎን ሁሉንም መረጃዎች ያሟሉ' });
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

// 📌 3. የአድሚን አፕሩቫል ሎጂክ
bot.on('callback_query', async (query) => {
    const data = query.data;
    const chatId = query.message.chat.id;

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
                    return bot.sendMessage(ADMIN_ID, `❌ ተጠቃሚው በቂ ባላንስ ስለሌለው ዊዝድሮው ማድረግ አይቻልም።`);
                }
            }
            if (user) await user.save();
            await trans.save();

            bot.editMessageText(`✅ የ${trans.type} ጥያቄ ጸድቋል።\nተጠቃሚ ID: ${trans.identifier}\nመጠን: ${trans.amount} ETB`, {
                chat_id: chatId, message_id: query.message.message_id
            });

            bot.sendMessage(trans.identifier, `🎉 የእርስዎ የ ${trans.amount} ETB ${trans.type} ጥያቄ በአድሚን ጸድቋል!`);

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

// 📌 4. REAL-TIME BINGO SOCKET.IO LOGIC (የማሸነፊያ ብር ዳታቤዝ ላይ መደመሪያ የተካተተበት)
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

    // 🌟 አሸናፊ ሲኖር ብሩን በዳታቤዝ ውስጥ ማስቀመጥ
    socket.on('claimBingo', async (data) => {
        clearInterval(gameInterval);
        const { identifier, winAmount } = data;

        if (identifier && winAmount) {
            try {
                const user = await User.findOne({ identifier: String(identifier) });
                if (user) {
                    user.balance += parseFloat(winAmount);
                    await user.save();
                    console.log(`🎉 ተጠቃሚ ${identifier} ${winAmount} ETB አሸንፎ ዳታቤዝ ላይ ተደመረለት። አዲስ ባላንስ: ${user.balance}`);
                }
            } catch (err) {
                console.error("የማሸነፊያ ብር ዳታቤዝ ላይ ሲመዘገብ ስህተት ተፈጠረ:", err);
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
