const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const TelegramBot = require('node-telegram-bot-api');
const pool = require('./database');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const TELEGRAM_BOT_TOKEN = '8957133551:AAGBPCGEzFLtJRXHRU0PfKJ2QXDf1AyvXec'; 
const ADMIN_CHAT_ID = '686733543'; 

const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });

bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id.toString();
    const name = msg.from.first_name || 'Bingo Player';
    const username = msg.from.username || '';

    try {
        await pool.query(
            `INSERT INTO users (identifier, name, username, balance, phone) 
             VALUES ($1, $2, $3, 0.00, 'አልተጋራም') 
             ON CONFLICT (identifier) DO UPDATE SET name = EXCLUDED.name, username = EXCLUDED.username`,
            [chatId, name, username]
        );
    } catch (err) {
        console.error("Start user db error:", err);
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

app.post('/api/get-user', async (req, res) => {
    const identifier = String(req.body.identifier);
    const { name, username } = req.body;
    if (!identifier) return res.status(400).json({ success: false, message: 'Invalid ID' });

    try {
        let result = await pool.query('SELECT * FROM users WHERE identifier = $1', [identifier]);
        let user;
        if (result.rows.length === 0) {
            const insertRes = await pool.query(
                `INSERT INTO users (identifier, name, username, balance, phone) VALUES ($1, $2, $3, 0.00, 'አልተጋራም') RETURNING *`,
                [identifier, name || 'Bingo Player', username || '']
            );
            user = insertRes.rows[0];
        } else {
            user = result.rows[0];
            if (name && name !== 'Bingo Player' && user.name !== name) {
                await pool.query('UPDATE users SET name = $1 WHERE identifier = $2', [name, identifier]);
                user.name = name;
            }
        }
        res.json({ success: true, user });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Database error' });
    }
});

app.post('/api/update-phone', async (req, res) => {
    const identifier = String(req.body.identifier);
    const { phone } = req.body;
    try {
        const updateRes = await pool.query('UPDATE users SET phone = $1 WHERE identifier = $2 RETURNING *', [phone, identifier]);
        if (updateRes.rows.length > 0) {
            return res.json({ success: true, message: 'ስልክ ቁጥር ተመዝግቧል' });
        }
        res.status(404).json({ success: false, message: 'ተጠቃሚው አልተገኘም' });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Database error' });
    }
});

app.post('/api/request-transaction', async (req, res) => {
    const identifier = String(req.body.identifier);
    const { type, amount, details } = req.body;
    
    try {
        let userRes = await pool.query('SELECT * FROM users WHERE identifier = $1', [identifier]);
        let user;
        if (userRes.rows.length === 0) {
            const ins = await pool.query(
                `INSERT INTO users (identifier, name, balance, phone) VALUES ($1, 'Bingo Player', 0.00, 'አልተጋራም') RETURNING *`,
                [identifier]
            );
            user = ins.rows[0];
        } else {
            user = userRes.rows[0];
        }

        if (type === 'WITHDRAW' && parseFloat(user.balance) < parseFloat(amount)) {
            return res.json({ success: false, message: 'ያለዎት ባላንስ ከጠየቁት የብር መጠን ያንሳል!' });
        }

        const txId = Math.floor(100000 + Math.random() * 900000).toString();
        await pool.query(
            `INSERT INTO transactions (tx_id, identifier, type, amount, handled) VALUES ($1, $2, $3, $4, false)`,
            [txId, identifier, type, amount]
        );

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
                        { text: '✅ Approve (አረጋግጥ)', callback_data: `app_${txId}` },
                        { text: '❌ Reject (ሰርዝ)', callback_data: `rej_${txId}` }
                    ]
                ]
            }
        };

        await bot.sendMessage(ADMIN_CHAT_ID, message, { parse_mode: 'HTML', ...inlineKeyboard });
        res.json({ success: true, message: 'ጥያቄዎ ለአድሚን በቴሌግራም ተልኳል!' });
    } catch (error) {
        console.error('Transaction Error:', error);
        res.status(500).json({ success: false, message: 'ሰርቨር ላይ ስህተት ተፈጥሯል።' });
    }
});

bot.onText(/\/users/, async (msg) => {
    const chatId = msg.chat.id.toString();
    if (chatId !== ADMIN_CHAT_ID.toString()) {
        return bot.sendMessage(chatId, "⚠️ ፈቃድ የለዎትም!");
    }

    try {
        const result = await pool.query('SELECT * FROM users');
        const users = result.rows;

        if (users.length === 0) {
            return bot.sendMessage(chatId, "📭 እስካሁን የተመዘገበ ተጠቃሚ የለም።");
        }

        let message = `📋 <b>የተመዘገቡ ተጠቃሚዎች (${users.length}):</b>\n\n`;
        users.forEach((u, index) => {
            message += `${index + 1}. <b>ስም:</b> ${u.name}\n` +
                       `   <b>ID:</b> <code>${u.identifier}</code>\n` +
                       `   <b>ስልክ:</b> ${u.phone}\n` +
                       `   <b>ባላንስ:</b> ${parseFloat(u.balance).toFixed(2)} ETB\n\n`;
        });

        await bot.sendMessage(ADMIN_CHAT_ID, message, { parse_mode: 'HTML' });
    } catch (err) {
        console.error(err);
    }
});

bot.on('callback_query', async (query) => {
    const action = query.data;
    const msg = query.message;
    const [actionType, txId] = action.split('_');

    try {
        const txRes = await pool.query('SELECT * FROM transactions WHERE tx_id = $1', [txId]);
        if (txRes.rows.length === 0) {
            await bot.answerCallbackQuery(query.id, { text: '⚠️ ይህ ጥያቄ አልተገኘም!' });
            return;
        }

        const tx = txRes.rows[0];
        if (tx.handled) {
            await bot.answerCallbackQuery(query.id, { text: '⚠️ ይህ ጥያቄ ቀድሞውኑ ተጠናቋል!' });
            return;
        }

        const userRes = await pool.query('SELECT * FROM users WHERE identifier = $1', [tx.identifier]);
        const user = userRes.rows[0];

        if (actionType === 'app') {
            if (tx.type === 'DEPOSIT') {
                const newBalance = parseFloat(user.balance) + parseFloat(tx.amount);
                await pool.query('UPDATE users SET balance = $1 WHERE identifier = $2', [newBalance, tx.identifier]);
                await bot.sendMessage(ADMIN_CHAT_ID, `✅ ዲፖዚቱ ተረጋግጧል! ለተጠቃሚው ${tx.amount} ETB ተጨምሯል።\nአሁን ያለው ባላንስ: ${newBalance} ETB`, { parse_mode: 'HTML' });
            } else if (tx.type === 'WITHDRAW') {
                if (parseFloat(user.balance) >= parseFloat(tx.amount)) {
                    const newBalance = parseFloat(user.balance) - parseFloat(tx.amount);
                    await pool.query('UPDATE users SET balance = $1 WHERE identifier = $2', [newBalance, tx.identifier]);
                    await bot.sendMessage(ADMIN_CHAT_ID, `✅ ዊዝድሮው ተረጋግጧል! ከባላንሱ ${tx.amount} ETB ተቀንሷል።`, { parse_mode: 'HTML' });
                } else {
                    await bot.sendMessage(ADMIN_CHAT_ID, `⚠️ ተጠቃሚው በቂ ባላንስ የለውም!`);
                }
            }
        } else {
            await bot.sendMessage(ADMIN_CHAT_ID, `❌ የ${tx.type} ጥያቄ ተሰርዟል (Rejected)።`, { parse_mode: 'HTML' });
        }

        await pool.query('UPDATE transactions SET handled = true WHERE tx_id = $1', [txId]);
        try {
            await bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: msg.chat.id, message_id: msg.message_id });
        } catch (e) {}

        await bot.answerCallbackQuery(query.id, { text: 'ተከናውኗል!' });
    } catch (err) {
        console.error(err);
    }
});

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

    socket.on('claimBingo', async (data) => {
        const { identifier, winAmount } = data;
        try {
            let userRes = await pool.query('SELECT * FROM users WHERE identifier = $1', [identifier]);
            if (userRes.rows.length > 0) {
                let newBal = parseFloat(userRes.rows[0].balance) + parseFloat(winAmount);
                await pool.query('UPDATE users SET balance = $1 WHERE identifier = $2', [newBal, identifier]);
                io.emit('gameOver', { message: `ተጫዋች ${userRes.rows[0].name} አሸንፏል!` });
            }
        } catch (e) {
            console.error(e);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));