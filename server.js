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

// ⚙️ የቴሌግራም ቦት እና የአድሚን መረጃዎች
const TELEGRAM_BOT_TOKEN = '8957133551:AAGBPCGEzFLtJRXHRU0PfKJ2QXDf1AyvXec'; 
const ADMIN_CHAT_ID = '686733543'; // የአድሚን ቴሌግራም ID

const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });

// የሁሉም ተጠቃሚዎች የባንክ ሂሳብ እና መረጃ ማከማቻ (Database)
let usersDatabase = {};
// የტრንዛክሽን ጥያቄዎች ማከማቻ
let pendingTransactions = {};

// 1. ተጠቃሚው ቦቱ ላይ /start ሲል የሚሰራ
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id.toString();
    const name = msg.from.first_name || 'Bingo Player';
    const username = msg.from.username || '';

    if (!usersDatabase[chatId]) {
        usersDatabase[chatId] = {
            identifier: chatId,
            name: name,
            username: username,
            balance: 0.00,
            phone: 'አልተጋራም'
        };
    }

    const welcomeMessage = `👋 ሰላም <b>${name}</b>!\n\nወደ <b>ቢንጎ ጨዋታ</b> እንኳን ደህና መጡ። ጨዋታውን ለመጀመር ከታች ያለውን ቁልፍ ይጫኑ!`;
    const webAppUrl = process.env.RENDER_EXTERNAL_URL || 'https://your-app.onrender.com';

    await bot.sendMessage(chatId, welcomeMessage, {
        parse_mode: 'HTML',
        reply_markup: {
            inline_keyboard: [
                [{ text: '🎮 ቢንጎ ጨዋታውን ክፈት', web_app: { url: webAppUrl } }]
            ]
        }
    });
});

// 2. የተጠቃሚውን መረጃ ማምጫ API
app.post('/api/get-user', (req, res) => {
    const identifier = String(req.body.identifier);
    const { name, username } = req.body;
    if (!identifier) return res.status(400).json({ success: false, message: 'Invalid ID' });

    if (!usersDatabase[identifier]) {
        usersDatabase[identifier] = {
            identifier: identifier,
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
    const identifier = String(req.body.identifier);
    const { phone } = req.body;
    if (usersDatabase[identifier]) {
        usersDatabase[identifier].phone = phone;
        return res.json({ success: true, message: 'ስልክ ቁጥር ተመዝግቧል' });
    }
    res.status(404).json({ success: false, message: 'ተጠቃሚው አልተገኘም' });
});

// 3. የዲፖዚት እና ዊዝድሮው ጥያቄ API
app.post('/api/request-transaction', async (req, res) => {
    const identifier = String(req.body.identifier);
    const { type, amount, details } = req.body;
    
    // ተጠቃሚው ከሌለ በአስቸኳይ መፍጠር (እንዳይጠፋ)
    if (!usersDatabase[identifier]) {
        usersDatabase[identifier] = {
            identifier: identifier,
            name: 'Bingo Player',
            balance: 0.00,
            phone: 'አልተጋራም'
        };
    }

    const user = usersDatabase[identifier];

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
        res.json({ success: true, message: 'ጥያቄዎ ለአድሚን በቴሌግራም ተልኳል!' });
    } catch (error) {
        console.error('Telegram Send Error:', error);
        res.status(500).json({ success: false, message: 'አድሚኑን ማግኘት አልተቻለም።' });
    }
});

// 4. /users ትእዛዝ
bot.onText(/\/users/, async (msg) => {
    const chatId = msg.chat.id.toString();
    if (chatId !== ADMIN_CHAT_ID.toString()) {
        return bot.sendMessage(chatId, "⚠️ ፈቃድ የለዎትም!");
    }

    const userKeys = Object.keys(usersDatabase);
    if (userKeys.length === 0) {
        return bot.sendMessage(chatId, "📭 እስካሁን የተመዘገበ ተጠቃሚ የለም።");
    }

    let message = `📋 <b>የተመዘገቡ ተጠቃሚዎች (${userKeys.length}):</b>\n\n`;
    let index = 1;

    for (let key of userKeys) {
        const u = usersDatabase[key];
        message += `${index}. <b>ስም:</b> ${u.name}\n` +
                   `   <b>ID:</b> <code>${u.identifier}</code>\n` +
                   `   <b>ስልክ:</b> ${u.phone}\n` +
                   `   <b>ባላንስ:</b> ${u.balance.toFixed(2)} ETB\n\n`;
        index++;
    }

    await bot.sendMessage(ADMIN_CHAT_ID, message, { parse_mode: 'HTML' });
});

// 5. አድሚኑ Approve ሲል የሚሰራ ትክክለኛ ሎጂክ
bot.on('callback_query', async (query) => {
    const action = query.data;
    const msg = query.message;
    const [status, txId] = action.split('_');

    const tx = pendingTransactions[txId];

    if (!tx) {
        await bot.answerCallbackQuery(query.id, { text: '⚠️ ይህ ጥያቄ ሰርቨሩ ስለተቀየረ አልተገኘም! አዲስ ጥያቄ ይላኩ።' });
        return;
    }

    if (tx.handled) {
        await bot.answerCallbackQuery(query.id, { text: '⚠️ ይህ ጥያቄ ቀድሞውኑ ተጠናቋል!' });
        return;
    }

    // ተጠቃሚው ከሌለ መፍጠር
    if (!usersDatabase[tx.identifier]) {
        usersDatabase[tx.identifier] = {
            identifier: tx.identifier,
            name: 'Bingo Player',
            balance: 0.00,
            phone: 'አልተጋራም'
        };
    }

    const user = usersDatabase[tx.identifier];

    if (status === 'approve') {
        if (tx.type === 'DEPOSIT') {
            user.balance += tx.amount;
            await bot.sendMessage(ADMIN_CHAT_ID, `✅ ዲፖዚቱ ተረጋግጧል! ለተጠቃሚው ${tx.amount} ETB ተጨምሯል።\nአሁን ያለው ባላንስ: ${user.balance} ETB`, { parse_mode: 'HTML' });
        } else if (tx.type === 'WITHDRAW') {
            if (user.balance >= tx.amount) {
                user.balance -= tx.amount;
                await bot.sendMessage(ADMIN_CHAT_ID, `✅ ዊዝድሮው ተረጋግጧል! ከባላንሱ ${tx.amount} ETB ተቀንሷል።`, { parse_mode: 'HTML' });
            } else {
                await bot.sendMessage(ADMIN_CHAT_ID, `⚠️ ተጠቃሚው በቂ ባላንስ የለውም!`);
            }
        }
    } else {
        await bot.sendMessage(ADMIN_CHAT_ID, `❌ የ${tx.type} ጥያቄ ተሰርዟል (Rejected)።`, { parse_mode: 'HTML' });
    }

    tx.handled = true;
    try {
        await bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: msg.chat.id, message_id: msg.message_id });
    } catch (e) {}
    
    await bot.answerCallbackQuery(query.id, { text: 'ተከናውኗል!' });
});

// Socket.io Game Logic
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
