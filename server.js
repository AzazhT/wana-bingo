const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const TelegramBot = require('node-telegram-bot-api');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// 📌 የአካባቢ ተለዋዋጮች
const TOKEN = process.env.BOT_TOKEN || '8957133551:AAGBPCGEzFLtJRXHRU0PfKJ2QXDf1AyvXec';
const ADMIN_ID = process.env.ADMIN_ID || '686733543';
const MONGO_URI = process.env.MONGO_URI || 'mongodb+srv://robel:1252@cluster0.lkrow1p.mongodb.net/wana_bingo?retryWrites=true&w=majority&appName=Cluster0';
const WEB_APP_URL = process.env.WEB_APP_URL || 'https://wana-bingo.onrender.com';

const bot = new TelegramBot(TOKEN, { polling: true });

// 📌 1. የቴሌግራም MENU BUTTON ትዕዛዞች ማዘጋጀት
bot.setMyCommands([
    { command: 'start', description: '🤖 ቦቱን ለመጀመር / Start' },
    { command: 'register', description: '📝 ለመመዝገብ / Register' },
    { command: 'deposit', description: '💳 ብር ገቢ ለማድረግ / Deposit' },
    { command: 'withdraw', description: '💸 ብር ወጪ ለማድረግ / Withdraw' }
]);

bot.on('polling_error', (error) => {
    if (error.code === 'ETELEGRAM' && error.message.includes('409 Conflict')) return;
    console.error('Telegram Polling Error:', error.message);
});

// 📌 2. የዳታቤዝ ስኬማዎች (Database Schemas)
const userSchema = new mongoose.Schema({
    identifier: { type: String, required: true, unique: true },
    username: { type: String, default: '' },
    name: { type: String, default: 'ተጫዋች' },
    phone: { type: String, default: '' },
    balance: { type: Number, default: 50 }, // ጀማሪ ባላንስ 50
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
    .then(() => console.log('MongoDB Connected Successfully!'))
    .catch(err => console.error('MongoDB Connection Error:', err));

// 📌 ተጠቃሚን በቴሌግራም ሲመጣ በራስ-ሰር ዳታቤዝ የመመዝገብ ተግባር
async function ensureUserRegistered(msg) {
    try {
        const chatId = String(msg.chat.id);
        const firstName = msg.from.first_name || 'ተጫዋች';
        const username = msg.from.username || '';

        let user = await User.findOne({ identifier: chatId });
        if (!user) {
            user = new User({
                identifier: chatId,
                username: username,
                name: firstName,
                balance: 50
            });
            await user.save();
            console.log(`አዲስ ተጠቃሚ ተመዝግቧል: ${chatId}`);
        }
        return user;
    } catch (err) {
        console.error('User registration error:', err);
    }
}

// 📌 3. የቴሌግራም COMMAND HANDLERS

// /start ትዕዛዝ
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const firstName = msg.from.first_name || 'ተጫዋች';

    await ensureUserRegistered(msg); // በዳታቤዝ መኖራቸውን ማረጋገጥ/መመዝገብ

    const welcomeMessage = `👋 ሰላም **${firstName}**!\n\nእንኳን ወደ **Wana Bingo** በደህና መጡ! 🎲🎉\n\n📱 **Telebirr:** \`0915503379\`\n\nከታች ያለውን **"🎮 ጨዋታውን ጀምር"** የሚለውን በተን በመጫን ቢንጎ መጫወት እና ማሸነፍ ይችላሉ!`;

    const options = {
        parse_mode: 'Markdown',
        reply_markup: {
            keyboard: [
                [
                    { 
                        text: "🎮 ጨዋታውን ጀምር (Play Bingo)", 
                        web_app: { url: WEB_APP_URL } 
                    }
                ]
            ],
            resize_keyboard: true,
            input_field_placeholder: "ቴሌብር፡ 0915503379"
        }
    };

    bot.sendMessage(chatId, welcomeMessage, options);
});

// /register ትዕዛዝ
bot.onText(/\/register/, async (msg) => {
    await ensureUserRegistered(msg);
    const regMsg = `📝 **ምዝገባዎ ተጠናቋል!**\n\nከታች ያለውን በተን በመጫን ጨዋታውን መጀመር ይችላሉ!`;
    bot.sendMessage(msg.chat.id, regMsg, {
        parse_mode: 'Markdown',
        reply_markup: {
            keyboard: [[{ text: "🎮 ጨዋታውን ጀምር", web_app: { url: WEB_APP_URL } }]],
            resize_keyboard: true,
            input_field_placeholder: "ቴሌብር፡ 0915503379"
        }
    });
});

// /deposit ትዕዛዝ
bot.onText(/\/deposit/, (msg) => {
    const depositMsg = `💳 **ብር ገቢ ለማድረግ (Deposit):**\n\n` +
                       `1. በ Telebirr ወደዚህ ቁጥር ይላኩ፡\n` +
                       `📱 **Telebirr:** \`0915503379\`\n\n` +
                       `2. ብር ከላኩ በኋላ የላኩበትን Transaction ID/SMS በ Mini App ውስጥ ባለው Deposit ገጽ ላይ ያስገቡ!`;
    bot.sendMessage(msg.chat.id, depositMsg, { parse_mode: 'Markdown' });
});

// /withdraw ትዕዛዝ
bot.onText(/\/withdraw/, (msg) => {
    const withdrawMsg = `💸 **ብር ወጪ ለማድረግ (Withdraw):**\n\n` +
                        `በ Mini App ውስጥ ወደ Wallet/Profile ገጽ በመሄድ የትርፍዎን Withdraw ጥያቄ ማቅረብ ይችላሉ።`;
    bot.sendMessage(msg.chat.id, withdrawMsg, { parse_mode: 'Markdown' });
});

// 📌 4. API ENDPOINTS

// ተጠቃሚን በ Mini App መፈለግ/መመዝገብ
app.post('/api/get-user', async (req, res) => {
    try {
        const { identifier, name, username, phone } = req.body;
        if (!identifier) return res.status(400).json({ success: false, error: 'ID ያስፈልጋል' });

        const strId = String(identifier);
        let user = await User.findOne({ identifier: strId });

        if (!user) {
            user = new User({
                identifier: strId,
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

// ውርርድ ማድረግ (Place Bet)
app.post('/api/place-bet', async (req, res) => {
    try {
        const { identifier, amount } = req.body;
        const betAmount = Number(amount);

        // ባላንሱ በቂ ከሆነ ብቻ ከሂሳቡ ላይ ይቀንሳል
        const user = await User.findOneAndUpdate(
            { identifier: String(identifier), balance: { $gte: betAmount } },
            { $inc: { balance: -betAmount } },
            { new: true }
        );

        if (!user) {
            return res.status(400).json({ success: false, message: 'በቂ ባላንስ የለዎትም ወይም ተጠቃሚው አልተገኘም!' });
        }

        res.status(200).json({ success: true, newBalance: user.balance });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// የ Deposit እና Withdraw ጥያቄዎችን መዝግቦ ለአድሚን መላክ
app.post('/api/request-transaction', async (req, res) => {
    try {
        const { identifier, type, amount, details } = req.body;
        const strId = String(identifier);
        const numAmount = Number(amount);

        if (!identifier || !type || !amount || !details) {
            return res.status(400).json({ success: false, message: 'ሁሉንም መረጃዎች ያሟሉ' });
        }

        const user = await User.findOne({ identifier: strId });
        if (!user) {
            return res.status(404).json({ success: false, message: 'ተጠቃሚው በዳታቤዝ ውስጥ አልተገኘም!' });
        }

        // ለ Withdraw ጥያቄ በቂ ባላንስ እንዳለው ማረጋገጥ
        if (type === 'WITHDRAW' && user.balance < numAmount) {
            return res.status(400).json({ success: false, message: 'ያለዎት ባላንስ ለቀረበው የወጪ ጥያቄ በቂ አይደለም!' });
        }

        const trans = new Transaction({
            identifier: strId,
            type,
            amount: numAmount,
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
            `📥 **አዲስ የ${type} ጥያቄ!**\n\n👤 ተጠቃሚ ID: \`${strId}\`\n💰 መጠን: ${numAmount} ETB\n📝 ዝርዝር/SMS: ${details}`,
            { parse_mode: 'Markdown', reply_markup: inlineKeyboard }
        );

        res.status(200).json({ success: true, message: 'ጥያቄዎ ለአድሚን ተልኳል!' });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// 📌 5. TELEGRAM CALLBACK QUERY (አድሚን ሲያጸድቅ ወይም ውድቅ ሲያደርግ)
bot.on('callback_query', async (query) => {
    const data = query.data;
    const chatId = query.message.chat.id;

    if (data === 'help_info') {
        return bot.answerCallbackQuery(query.id, { 
            text: "ለማንኛውም ጥያቄ ወይም እገዛ በአድሚን አድራሻ ያግኙን!", 
            show_alert: true 
        });
    }

    if (data === 'deposit_info') {
        return bot.sendMessage(chatId, `💳 **Telebirr Number:** \`0915503379\`\n\nብር ከላኩ በኋላ Transaction Reference ቁጥሩን በ Mini App ያስገቡ።`, { parse_mode: 'Markdown' });
    }

    if (chatId.toString() !== ADMIN_ID.toString()) {
        return bot.answerCallbackQuery(query.id, { text: "ፈቃድ የለዎትም!" });
    }

    const [action, transId] = data.split('_');
    try {
        const trans = await Transaction.findById(transId);
        if (!trans || trans.status !== 'PENDING') {
            return bot.answerCallbackQuery(query.id, { text: "ጥያቄው አልተገኘም ወይም ቀድሞ ተስተናግዷል!" });
        }

        if (action === 'approve') {
            let updatedUser = null;

            if (trans.type === 'DEPOSIT') {
                // Deposit ሲጸድቅ ባላንስ መጨመር ($inc)
                updatedUser = await User.findOneAndUpdate(
                    { identifier: trans.identifier },
                    { $inc: { balance: trans.amount } },
                    { new: true }
                );
            } else if (trans.type === 'WITHDRAW') {
                // Withdraw ሲጸድቅ በቂ ባላንስ ካለ ብቻ መቀነስ ($inc)
                updatedUser = await User.findOneAndUpdate(
                    { identifier: trans.identifier, balance: { $gte: trans.amount } },
                    { $inc: { balance: -trans.amount } },
                    { new: true }
                );
            }

            if (!updatedUser && trans.type === 'WITHDRAW') {
                return bot.sendMessage(ADMIN_ID, `❌ ተጠቃሚው በቂ ባላንስ ስለሌለው የወጪ ጥያቄውን ማጽደቅ አልተቻለም።`);
            }

            trans.status = 'APPROVED';
            await trans.save();

            bot.editMessageText(`✅ የ${trans.type} ጥያቄ ጸድቋል።\n👤 ተጠቃሚ ID: ${trans.identifier}\n💰 መጠን: ${trans.amount} ETB\n💵 አዲስ ባላንስ: ${updatedUser ? updatedUser.balance : 0} ETB`, {
                chat_id: chatId, message_id: query.message.message_id
            });

            bot.sendMessage(trans.identifier, `🎉 የእርስዎ የ ${trans.amount} ETB ${trans.type} ጥያቄ ጸድቋል! አሁን ያሉት ባላንስ: ${updatedUser ? updatedUser.balance : 0} ETB`);

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

// 📌 6. FRONTEND FALLBACK ROUTE
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 📌 7. SOCKET.IO BINGO LOGIC (የማሸነፊያ ብር በዳታቤዝ መጨመር)
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
                // ያሸነፈውን ብር በቀጥታ ዳታቤዝ ላይ መጨመር
                const updatedUser = await User.findOneAndUpdate(
                    { identifier: String(identifier) },
                    { $inc: { balance: parseFloat(winAmount) } },
                    { new: true }
                );
                console.log(`Bingo Winner: ${identifier}, New Balance: ${updatedUser ? updatedUser.balance : 0}`);
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
