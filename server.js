const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const TelegramBot = require('node-telegram-bot-api');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ⚙️ የቴሌግራም ቦት እና የአድሚን መረጃዎች ተሞልተዋል
const TELEGRAM_BOT_TOKEN = '8957133551:AAGBPCGEzFLtJRXHRU0PfKJ2QXDf1AyvXec'; 
const ADMIN_CHAT_ID = '686733543'; // የአድሚን ቴሌግራም ID

const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });

// የሁሉም ተጠቃሚዎች የባንክ ሂሳብ (Database)
let usersDatabase = {};
// የტრንዛክሽን ጥያቄዎች ማከማቻ
let pendingTransactions = {};

// 1. የተጠቃሚውን መረጃ እና ባላንስ ማምጫ API
app.post('/api/get-user', (req, res) => {
    const { identifier, name, username } = req.body;
    if (!identifier) return res.status(400).json({ success: false, message: 'Invalid ID' });

    if (!usersDatabase[identifier]) {
        usersDatabase[identifier] = {
            identifier,
            name: name || 'Bingo Player',
            username: username || '',
            balance: 0.00,
            phone: 'አልተጋራም'
        };
    } else {
        if (name && name !== 'Bingo Player') {
            usersDatabase[identifier].name = name;
        }
    }
    res.json({ success: true, user: usersDatabase[identifier] });
});

// ስልክ ቁጥር ማሻሻያ API
app.post('/api/update-phone', (req, res) => {
    const { identifier, phone } = req.body;
    if (usersDatabase[identifier]) {
        usersDatabase[identifier].phone = phone;
        return res.json({ success: true, message: 'ስልክ ቁጥር ተመዝግቧል' });
    }
    res.status(404).json({ success: false, message: 'ተጠቃሚው አልተገኘም' });
});

// 2. ጨዋታ ሲጀመር ብር መቀነሻ API
app.post('/api/place-bet', (req, res) => {
    const { identifier, amount } = req.body;
    const user = usersDatabase[identifier];

    if (!user) return res.status(404).json({ success: false, message: 'ተጠቃሚው አልተገኘም' });
    if (user.balance < amount) {
        return res.json({ success: false, message: 'በቂ ባላንስ የለዎትም! እባክዎን አስቀድመው ዲፖዚት ያድርጉ።' });
    }

    user.balance -= amount;
    res.json({ success: true, newBalance: user.balance });
});

// 3. የዲፖዚት እና ዊዝድሮው ጥያቄ በቀጥታ ወደ አድሚን ቴሌግራም መላኪያ API
app.post('/api/request-transaction', async (req, res) => {
    const { identifier, type, amount, details } = req.body;
    const user = usersDatabase[identifier];

    if (!user) return res.status(404).json({ success: false, message: 'ተጠቃሚው አልተገኘም' });

    if (type === 'WITHDRAW' && user.balance < amount) {
        return res.json({ success: false, message: 'ያለዎት ባላንስ ከጠየቁት የብር መጠን ያንሳል!' });
    }

    const txId = 'TX_' + Date.now();
    pendingTransactions[txId] = { identifier, type, amount: parseFloat(amount), handled: false };

    const message = `🚨 <b>አዲስ የ${type === 'DEPOSIT' ? 'ገቢ (Deposit)' : 'ወጪ (Withdraw)'} ጥያቄ!</b>\n\n` +
                    `👤 ስም: ${user.name}\n` +
                    `🆔 ID: <code>${identifier}</code>\n` +
                    `📞 ስልክ: ${user.phone}\n` +
                    `💵 የብር መጠን: <b>${amount} ETB</b>\n` +
                    `📝 መረጃ/SMS: ${details}`;

    const inlineKeyboard = {
        reply_markup: {
            inline_keyboard: [
                [
                    { text: '✅ Approve (አረጋግጥ)', callback_data: `approve_${txId}` },
                    { text: '❌ Reject (ሰርዝ)', callback_data: `reject_${txId}` }
                ]
            ]
        }
    };

    try {
        await bot.sendMessage(ADMIN_CHAT_ID, message, { parse_mode: 'HTML', ...inlineKeyboard });
        res.json({ success: true, message: 'ጥያቄዎ ለአድሚን በቴሌግራም ተልኳል! እባክዎ ትንሽ ይጠብቁ።' });
    } catch (error) {
        console.error('Telegram Send Error:', error);
        res.status(500).json({ success: false, message: 'አድሚኑን ማግኘት አልተቻለም።' });
    }
});

// 4. አድሚኑ በቴሌግራም አዝራሮቹን ሲጫጫን የሚሰራ logic
bot.on('callback_query', async (query) => {
    const action = query.data;
    const msg = query.message;
    const [status, txId] = action.split('_');

    const tx = pendingTransactions[txId];

    if (!tx) {
        await bot.answerCallbackQuery(query.id, { text: '⚠️ ይህ ጥያቄ ሰርቨሩ ስለተቀየረ ወይም ቀደም ብሎ ስለተሰራበት ማግኘት አልተቻለም!' });
        return;
    }

    if (tx.handled) {
        await bot.answerCallbackQuery(query.id, { text: '⚠️ ይህ ጥያቄ ቀድሞውኑ ተጠናቋል!' });
        return;
    }

    const user = usersDatabase[tx.identifier];

    if (status === 'approve') {
        if (tx.type === 'DEPOSIT') {
            if (user) user.balance += tx.amount;
            await bot.sendMessage(ADMIN_CHAT_ID, `✅ ዲፖዚቱ <b>ተረጋግጧል (Approved)</b>!\nለተጠቃሚው ${tx.amount} ETB ተጨምሯል።`, { parse_mode: 'HTML' });
        } else if (tx.type === 'WITHDRAW') {
            if (user) {
                if (user.balance >= tx.amount) {
                    user.balance -= tx.amount;
                    await bot.sendMessage(ADMIN_CHAT_ID, `✅ የውጪ ጥያቄው <b>ተረጋግጧል (Approved)</b>!\nከባላንሱ ${tx.amount} ETB ተቀንሷል።`, { parse_mode: 'HTML' });
                } else {
                    await bot.sendMessage(ADMIN_CHAT_ID, `⚠️ ተጠቃሚው በቂ ባላንስ ስለሌለው ዊዝድሮውን ማስተናገድ አልተቻለም።`);
                }
            }
        }
    } else {
        await bot.sendMessage(ADMIN_CHAT_ID, `❌ የ${tx.type} ጥያቄው <b>ተሰርዟል (Rejected)</b>።`, { parse_mode: 'HTML' });
    }

    tx.handled = true;
    try {
        await bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: msg.chat.id, message_id: msg.message_id });
    } catch (e) {}
    
    await bot.answerCallbackQuery(query.id, { text: 'ተከናውኗል!' });
});

// Real-time Socket.io Game Logic
io.on('connection', (socket) => {
    socket.on('startGame', () => {
        let drawnNumbers = [];
        let interval = setInterval(() => {
            if (drawnNumbers.length >= 75) {
                clearInterval(interval);
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

    socket.on('claimBingo', (data) => {
        const { identifier, winAmount } = data;
        if (usersDatabase[identifier]) {
            usersDatabase[identifier].balance += parseFloat(winAmount);
            io.emit('gameOver', { message: `ተጫዋች ${usersDatabase[identifier].name} አሸንፏል!` });
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
