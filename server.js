const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const TelegramBot = require('node-telegram-bot-api');
const pool = require('./database');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static('public'));

// ቋሚ መረጃዎች
const TOKEN = '8957133551:AAGBPCGEzFLtJRXHRU0PfKJ2QXDf1AyvXec';
const ADMIN_CHAT_ID = '686733543';
const WEB_APP_URL = 'https://wana-bingo.onrender.com';

let bot = null;
if (TOKEN) {
    try {
        bot = new TelegramBot(TOKEN, { 
            polling: {
                interval: 300,
                autoStart: true,
                params: {
                    timeout: 10
                }
            } 
        });
        console.log('Telegram Bot started successfully!');

        bot.on('polling_error', (error) => {
            console.log(`Telegram Polling Error: ${error.code} - ${error.message}`);
        });

    } catch (err) {
        console.error('Telegram Bot initialization error:', err);
    }
} else {
    console.error('ERROR: Telegram Bot Token not provided!');
}

// REST APIs for User & Wallet
app.post('/api/get-user', async (req, res) => {
    const { identifier, name, username } = req.body;
    try {
        let userRes = await pool.query('SELECT * FROM users WHERE identifier = $1', [identifier]);
        let user;
        if (userRes.rows.length === 0) {
            const insertRes = await pool.query(
                'INSERT INTO users (identifier, name, username, balance) VALUES ($1, $2, $3, $4) RETURNING *',
                [identifier, name || 'Player', username || '', 0.00]
            );
            user = insertRes.rows[0];
        } else {
            user = userRes.rows[0];
        }
        res.json({ success: true, user });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.post('/api/update-phone', async (req, res) => {
    const { identifier, phone } = req.body;
    try {
        await pool.query('UPDATE users SET phone = $1 WHERE identifier = $2', [phone, identifier]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false });
    }
});

app.post('/api/place-bet', async (req, res) => {
    const { identifier, amount } = req.body;
    try {
        const userRes = await pool.query('SELECT balance FROM users WHERE identifier = $1', [identifier]);
        if (userRes.rows.length === 0) return res.json({ success: false, message: 'User not found' });
        
        let balance = parseFloat(userRes.rows[0].balance);
        if (balance < amount) return res.json({ success: false, message: 'በቂ ባላንስ የለዎትም!' });

        let newBalance = balance - amount;
        await pool.query('UPDATE users SET balance = $1 WHERE identifier = $2', [newBalance, identifier]);
        res.json({ success: true, newBalance });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.post('/api/request-transaction', async (req, res) => {
    const { identifier, type, amount, details } = req.body;
    const tx_id = 'TX' + Math.floor(100000 + Math.random() * 900000);
    try {
        await pool.query(
            'INSERT INTO transactions (tx_id, identifier, type, amount, handled) VALUES ($1, $2, $3, $4, FALSE)',
            [tx_id, identifier, type, amount]
        );
        res.json({ success: true, tx_id });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false });
    }
});

// --- TELEGRAM BOT COMMANDS & ADMIN PANEL ---
if (bot) {
    bot.setMyCommands([
        { command: 'start', description: 'ቦቱን ለመጀመር' },
        { command: 'play', description: '🎮 Play Bingo (ጨዋታውን ክፈት)' },
        { command: 'balance', description: '💰 ቀሪ ሂሳብዎን ለማየት' },
        { command: 'deposit', description: '💳 የዲፖዚት መመሪያ' },
        { command: 'withdraw', description: '💸 ገንዘብ ወጪ ለማድረግ' }
    ]);

    bot.onText(/\/start/, (msg) => {
        const chatId = msg.chat.id;
        const name = msg.from.first_name;
        
        let welcomeMessage = `✨ **እንኳን ደህና መጡ!** ✨\n\n` +
                             `ሰላም **${name}**! ወደ 🏆 **ዋና ቢንጎ (Wana Bingo)** በሰላም መጡ。\n\n` +
                             `─────────────────────\n` +
                             `📌 **የቦቱ አገልግሎቶች እና ትዕዛዞች፡**\n\n` +
                             `🎮 /play - 🎲 ቢንጎን በቀጥታ ለመጫወት (Web App)\n` +
                             `💰 /balance - 💵 ቀሪ ሂሳብዎን ለማየት\n` +
                             `💳 /deposit - 📥 የዲፖዚት መመሪያዎችን ለማግኘት\n` +
                             `💸 /withdraw - 📤 ያሸነፉትን ገንዘብ ወጪ ለማድረግ\n` +
                             `─────────────────────`;

        if (chatId.toString() === ADMIN_CHAT_ID) {
            welcomeMessage += `\n\n👑 **የአድሚን መቆጣጠሪያ ፓነል፡**\n` +
                              `📊 /admin - አጠቃላይ ድምር መረጃዎችን ለማየት\n` +
                              `📋 /pending - የሚጠብቁ የገንዘብ ጥያቄዎችን ለማጽደቅ`;
        }

        bot.sendMessage(chatId, welcomeMessage, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🚀  ዋናውን ቢንጎ ጨዋታ ጀምር (Play Bingo)  🎮', web_app: { url: WEB_APP_URL } }]
                ]
            }
        });
    });

    bot.onText(/\/play/, (msg) => {
        const chatId = msg.chat.id;
        bot.sendMessage(chatId, `🎮 የቢንጎ ጨዋታውን ለመጀመር ከታች ያለውን ቁልፍ ይጫኑ：`, {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🚀  Play Bingo Web App  🎮', web_app: { url: WEB_APP_URL } }]
                ]
            }
        });
    });

    bot.onText(/\/deposit/, (msg) => {
        const chatId = msg.chat.id;
        bot.sendMessage(chatId, `💳 **የዲፖዚት መመሪያ**\n\nበቴሌብር ወይም በባንክ ገንዘብ ገቢ በማድረግ በዌብሳይቱ (App) በኩል የዲፖዚት ጥያቄ ይላኩ。`, { parse_mode: 'Markdown' });
    });

    bot.onText(/\/withdraw/, (msg) => {
        const chatId = msg.chat.id;
        bot.sendMessage(chatId, `💸 **ገንዘብ ወጪ (Withdraw)**\n\nያሸነፉትን ገንዘብ ወጪ ለማድረግ እባክዎ ወደ ዌብሳይቱ በመግባት የ "Withdraw" ቅጹን ይሙሉ::`, { parse_mode: 'Markdown' });
    });

    bot.onText(/\/balance/, async (msg) => {
        const chatId = msg.chat.id;
        const username = msg.from.username || '';
        
        try {
            const userRes = await pool.query('SELECT balance, name FROM users WHERE username = $1 OR identifier = $2', [username, chatId.toString()]);
            if (userRes.rows.length > 0) {
                let user = userRes.rows[0];
                bot.sendMessage(chatId, `👤 ስም: ${user.name}\n💰 ቀሪ ባላንስዎ: ${user.balance} ብር`);
            } else {
                bot.sendMessage(chatId, `እባክዎ መጀመሪያ ዌብሳይቱ ላይ በመግባት አካውንት ይክፈቱ！`);
            }
        } catch (err) {
            console.error(err);
            bot.sendMessage(chatId, 'የሰርቨር ስህተት አጋጥሟል።');
        }
    });

    bot.onText(/\/admin/, async (msg) => {
        const chatId = msg.chat.id;
        if (chatId.toString() !== ADMIN_CHAT_ID) return bot.sendMessage(chatId, 'ይህንን ትዕዛዝ መጠቀም የሚችሉት አድሚኖች ብቻ ናቸው！');

        try {
            const usersRes = await pool.query('SELECT COUNT(*) FROM users');
            const totalUsers = usersRes.rows[0].count;

            const balanceRes = await pool.query('SELECT SUM(balance) FROM users');
            const totalBalance = balanceRes.rows[0].sum || 0;

            bot.sendMessage(chatId, `👑 **የአድሚን ዳሽቦርድ**\n\n👥 ጠቅላላ ተጫዋቾች: ${totalUsers}\n💰 ጠቅላላ ባላንስ: ${totalBalance} ብር\n\nያልተረጋገጡ ጥያቄዎችን ለማየት /pending ይጠቀሙ。`, { parse_mode: 'Markdown' });
        } catch (err) {
            console.error(err);
        }
    });

    bot.onText(/\/pending/, async (msg) => {
        const chatId = msg.chat.id;
        if (chatId.toString() !== ADMIN_CHAT_ID) return;

        try {
            const pendingRes = await pool.query(`
                SELECT t.*, u.name, u.username, u.phone 
                FROM transactions t 
                LEFT JOIN users u ON t.identifier = u.identifier 
                WHERE t.handled = FALSE 
                ORDER BY t.id DESC LIMIT 10
            `);

            if (pendingRes.rows.length === 0) {
                return bot.sendMessage(chatId, '✅ ምንም ያልተረጋገጠ (Pending) የዲፖዚት ወይም ዊዝድሮው ጥያቄ የለም！');
            }

            bot.sendMessage(chatId, `📋 **የሚጠብቁ ጥያቄዎች (${pendingRes.rows.length}):**`, { parse_mode: 'Markdown' });

            for (let tx of pendingRes.rows) {
                let msgText = `🔔 የ ${tx.type} ጥያቄ\n` +
                              `🆔 TxID: ${tx.tx_id}\n` +
                              `👤 ስም: ${tx.name || 'Unknown'} (@${tx.username || 'none'})\n` +
                              `📱 ስልክ: ${tx.phone || 'N/A'}\n` +
                              `💰 መጠን: ${tx.amount} ብር`;

                bot.sendMessage(chatId, msgText, {
                    reply_markup: {
                        inline_keyboard: [
                            [
                                { text: '✅ አረጋግጥ (Approve)', callback_data: `approve_${tx.tx_id}_${tx.identifier}_${tx.amount}` },
                                { text: '❌ ሰርዝ (Reject)', callback_data: `reject_${tx.tx_id}` }
                            ]
                        ]
                    }
                });
            }
        } catch (err) {
            console.error(err);
            bot.sendMessage(chatId, 'መረጃዎችን ማምጣት አልተቻለም。');
        }
    });

    bot.on('callback_query', async (query) => {
        const data = query.data;
        const parts = data.split('_');
        const action = parts[0];
        const tx_id = parts[1];

        try {
            if (action === 'approve') {
                const identifier = parts[2];
                const amount = parseFloat(parts[3]);

                const txRes = await pool.query('SELECT handled, type FROM transactions WHERE tx_id = $1', [tx_id]);
                if (txRes.rows.length > 0 && txRes.rows[0].handled) {
                    bot.answerCallbackQuery(query.id, { text: 'ይህ ጥያቄ ቀድሞ ተረጋግጧል！' });
                    return;
                }

                let txType = txRes.rows[0]?.type;

                if (txType === 'DEPOSIT') {
                    const userRes = await pool.query('SELECT balance FROM users WHERE identifier = $1', [identifier]);
                    if (userRes.rows.length > 0) {
                        let newBal = parseFloat(userRes.rows[0].balance) + amount;
                        await pool.query('UPDATE users SET balance = $1 WHERE identifier = $2', [newBal, identifier]);
                    }
                } else if (txType === 'WITHDRAW') {
                    const userRes = await pool.query('SELECT balance FROM users WHERE identifier = $1', [identifier]);
                    if (userRes.rows.length > 0) {
                        let newBal = parseFloat(userRes.rows[0].balance) - amount;
                        await pool.query('UPDATE users SET balance = $1 WHERE identifier = $2', [newBal >= 0 ? newBal : 0, identifier]);
                    }
                }

                await pool.query('UPDATE transactions SET handled = TRUE WHERE tx_id = $1', [tx_id]);

                bot.editMessageText(`✅ ጥያቄው ተረጋግጧል (Approved)!\n🆔 TxID: ${tx_id}`, {
                    chat_id: query.message.chat.id,
                    message_id: query.message.message_id
                });
                bot.answerCallbackQuery(query.id, { text: 'በအောင်မြင်ነት ተረጋግጧል！' });

            } else if (action === 'reject') {
                await pool.query('UPDATE transactions SET handled = TRUE WHERE tx_id = $1', [tx_id]);
                bot.editMessageText(`❌ ጥያቄው ውድቅ ተደርጓል (Rejected)\n🆔 TxID: ${tx_id}`, {
                    chat_id: query.message.chat.id,
                    message_id: query.message.message_id
