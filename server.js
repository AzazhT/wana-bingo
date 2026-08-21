const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Pool } = require('pg');
const TelegramBot = require('node-telegram-bot-api');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// 📌 Environment Variables
const TOKEN = process.env.BOT_TOKEN || '8957133551:AAGBPCGEzFLtJRXHRU0PfKJ2QXDf1AyvXec';
const ADMIN_ID = process.env.ADMIN_ID || '686733543';
const POSTGRES_URI = process.env.DATABASE_URL || 'postgresql://wana_bingo_user:IHX1VB02IXnf3T5WJolucG0DIQFJq4fx@dpg-da4da5gu01pc739kvhjg-a/wana_bingo';
const WEB_APP_URL = process.env.WEB_APP_URL || 'https://wana-bingo.onrender.com';

// 📌 PostgreSQL Connection Setup
const pool = new Pool({
    connectionString: POSTGRES_URI,
    ssl: { rejectUnauthorized: false }
});

// 📌 Database Tables Initialization
async function initDb() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                identifier VARCHAR(255) PRIMARY KEY,
                username VARCHAR(255) DEFAULT '',
                name VARCHAR(255) DEFAULT 'ተጫዋች',
                phone VARCHAR(255) DEFAULT '',
                balance NUMERIC(12, 2) DEFAULT 50.00,
                registered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS transactions (
                id SERIAL PRIMARY KEY,
                identifier VARCHAR(255) NOT NULL,
                type VARCHAR(50) NOT NULL,
                amount NUMERIC(12, 2) NOT NULL,
                details TEXT NOT NULL,
                status VARCHAR(50) DEFAULT 'PENDING',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log('✅ PostgreSQL Database Connected & Tables Created!');
    } catch (err) {
        console.error('❌ PostgreSQL Initialization Error:', err.message);
    }
}
initDb();

const bot = new TelegramBot(TOKEN, { polling: true });

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

// 📌 Telegram Auto-Register Log
async function ensureUserRegistered(msg) {
    try {
        const chatId = String(msg.chat.id);
        const firstName = msg.from.first_name || 'ተጫዋች';
        const username = msg.from.username || '';

        const res = await pool.query('SELECT * FROM users WHERE identifier = $1', [chatId]);
        if (res.rows.length === 0) {
            const insertRes = await pool.query(
                `INSERT INTO users (identifier, username, name, balance) 
                 VALUES ($1, $2, $3, 50) 
                 RETURNING *`,
                [chatId, username, firstName]
            );
            console.log(`👤 አዲስ ተጠቃሚ በ Telegram ተመዝግቧል: ID ${chatId} (${firstName})`);
            return insertRes.rows[0];
        }
        return res.rows[0];
    } catch (err) {
        console.error('User registration error:', err);
    }
}

// 📌 Bot Command Handlers
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const firstName = msg.from.first_name || 'ተጫዋች';

    await ensureUserRegistered(msg);

    const welcomeMessage = `👋 ሰላም **${firstName}**!\n\nእንኳን ወደ **Wana Bingo** በደህና መጡ! 🎲🎉\n\n📱 **Telebirr:** \`0915503379\`\n\nከታች ያለውን **"🎮 ጨዋታውን ጀምር"** የሚለውን በተን በመጫን ቢንጎ መጫወት እና ማሸነፍ ይችላሉ!`;

    const options = {
        parse_mode: 'Markdown',
        reply_markup: {
            keyboard: [
                [{ text: "🎮 ጨዋታውን ጀምር (Play Bingo)", web_app: { url: WEB_APP_URL } }]
            ],
            resize_keyboard: true,
            input_field_placeholder: "ቴሌብር፡ 0915503379"
        }
    };

    bot.sendMessage(chatId, welcomeMessage, options);
});

bot.onText(/\/register/, async (msg) => {
    await ensureUserRegistered(msg);
    bot.sendMessage(msg.chat.id, `📝 **ምዝገባዎ ተጠናቋል!**\n\nከታች ያለውን በተን በመጫን ጨዋታውን መጀመር ይችላሉ!`, {
        parse_mode: 'Markdown',
        reply_markup: {
            keyboard: [[{ text: "🎮 ጨዋታውን ጀምር", web_app: { url: WEB_APP_URL } }]],
            resize_keyboard: true
        }
    });
});

bot.onText(/\/deposit/, (msg) => {
    bot.sendMessage(msg.chat.id, `💳 **ብር ገቢ ለማድረግ (Deposit):**\n\n1. በ Telebirr ወደዚህ ቁጥር ይላኩ፡\n📱 **Telebirr:** \`0915503379\`\n\n2. የላኩበትን Transaction ID በ Mini App Deposit ገጽ ላይ ያስገቡ!`, { parse_mode: 'Markdown' });
});

bot.onText(/\/withdraw/, (msg) => {
    bot.sendMessage(msg.chat.id, `💸 **ብር ወጪ ለማድረግ (Withdraw):**\n\nበ Mini App ውስጥ ወደ Wallet ገጽ በመሄድ የትርፍዎን Withdraw ጥያቄ ማቅረብ ይችላሉ።`, { parse_mode: 'Markdown' });
});

// 📌 API Endpoints
app.post('/api/get-user', async (req, res) => {
    try {
        const { identifier, name, username, phone } = req.body;
        if (!identifier) return res.status(400).json({ success: false, error: 'ID ያስፈልጋል' });

        const strId = String(identifier);
        const userQuery = await pool.query('SELECT * FROM users WHERE identifier = $1', [strId]);

        let user;
        if (userQuery.rows.length === 0) {
            const insertQuery = await pool.query(
                `INSERT INTO users (identifier, username, name, phone, balance)
                 VALUES ($1, $2, $3, $4, 50)
                 RETURNING *`,
                [strId, username || '', name || 'ተጫዋች', phone || '']
            );
            user = insertQuery.rows[0];
            console.log(`👤 አዲስ ተጠቃሚ በ API ተመዝግቧል: ID ${strId}`);
        } else {
            user = userQuery.rows[0];
            let newUsername = username && user.username !== username ? username : user.username;
            let newName = name && user.name !== name ? name : user.name;

            if (newUsername !== user.username || newName !== user.name) {
                const updateQuery = await pool.query(
                    `UPDATE users SET username = $1, name = $2 WHERE identifier = $3 RETURNING *`,
                    [newUsername, newName, strId]
                );
                user = updateQuery.rows[0];
            }
        }

        res.status(200).json({ success: true, user });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

app.post('/api/place-bet', async (req, res) => {
    try {
        const { identifier, amount } = req.body;
        const betAmount = Number(amount);

        const updateRes = await pool.query(
            `UPDATE users 
             SET balance = balance - $1 
             WHERE identifier = $2 AND balance >= $1 
             RETURNING balance`,
            [betAmount, String(identifier)]
        );

        if (updateRes.rows.length === 0) {
            return res.status(400).json({ success: false, message: 'በቂ ባላንስ የለዎትም ወይም ተጠቃሚው አልተገኘም!' });
        }

        res.status(200).json({ success: true, newBalance: parseFloat(updateRes.rows[0].balance) });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

app.post('/api/request-transaction', async (req, res) => {
    try {
        const { identifier, type, amount, details } = req.body;
        const strId = String(identifier);
        const numAmount = Number(amount);

        if (!identifier || !type || !amount || !details) {
            return res.status(400).json({ success: false, message: 'ሁሉንም መረጃዎች ያሟሉ' });
        }

        const userRes = await pool.query('SELECT balance FROM users WHERE identifier = $1', [strId]);
        if (userRes.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'ተጠቃሚው በዳታቤዝ ውስጥ አልተገኘም!' });
        }

        const user = userRes.rows[0];
        if (type === 'WITHDRAW' && parseFloat(user.balance) < numAmount) {
            return res.status(400).json({ success: false, message: 'ያለዎት ባላንስ ለቀረበው የወጪ ጥያቄ በቂ አይደለም!' });
        }

        const transRes = await pool.query(
            `INSERT INTO transactions (identifier, type, amount, details)
             VALUES ($1, $2, $3, $4)
             RETURNING id`,
            [strId, type, numAmount, details]
        );
        const transId = transRes.rows[0].id;

        const inlineKeyboard = {
            inline_keyboard: [[
                { text: "✅ አጽድቅ (Approve)", callback_data: `approve_${transId}` },
                { text: "❌ ውድቅ አድርግ (Reject)", callback_data: `reject_${transId}` }
            ]]
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

bot.on('callback_query', async (query) => {
    const data = query.data;
    const chatId = query.message.chat.id;

    if (data === 'help_info') {
        return bot.answerCallbackQuery(query.id, { text: "ለማንኛውም ጥያቄ ወይም እገዛ በአድሚን አድራሻ ያግኙን!", show_alert: true });
    }

    if (data === 'deposit_info') {
        return bot.sendMessage(chatId, `💳 **Telebirr Number:** \`0915503379\`\n\nብር ከላኩ በኋላ Transaction Reference ቁጥሩን በ Mini App ያስገቡ።`, { parse_mode: 'Markdown' });
    }

    if (chatId.toString() !== ADMIN_ID.toString()) {
        return bot.answerCallbackQuery(query.id, { text: "ፈቃድ የለዎትም!" });
    }

    const [action, transId] = data.split('_');
    try {
        const transRes = await pool.query('SELECT * FROM transactions WHERE id = $1', [transId]);
        const trans = transRes.rows[0];

        if (!trans || trans.status !== 'PENDING') {
            return bot.answerCallbackQuery(query.id, { text: "ጥያቄው አልተገኘም ወይም ቀድሞ ተስተናግዷል!" });
        }

        if (action === 'approve') {
            let updatedUser = null;

            if (trans.type === 'DEPOSIT') {
                const userRes = await pool.query(
                    `UPDATE users 
                     SET balance = balance + $1 
                     WHERE identifier = $2 
                     RETURNING balance`,
                    [parseFloat(trans.amount), trans.identifier]
                );
                if (userRes.rows.length > 0) updatedUser = userRes.rows[0];

            } else if (trans.type === 'WITHDRAW') {
                const userRes = await pool.query(
                    `UPDATE users 
                     SET balance = balance - $1 
                     WHERE identifier = $2 AND balance >= $1 
                     RETURNING balance`,
                    [parseFloat(trans.amount), trans.identifier]
                );
                if (userRes.rows.length > 0) updatedUser = userRes.rows[0];
            }

            if (!updatedUser && trans.type === 'WITHDRAW') {
                return bot.sendMessage(ADMIN_ID, `❌ ተጠቃሚው በቂ ባላንስ ስለሌለው የወጪ ጥያቄውን ማጽደቅ አልተቻለም።`);
            }

            await pool.query('UPDATE transactions SET status = $1 WHERE id = $2', ['APPROVED', transId]);

            const finalBalance = updatedUser ? parseFloat(updatedUser.balance) : 0;

            bot.editMessageText(`✅ የ${trans.type} ጥያቄ ጸድቋል።\n👤 ተጠቃሚ ID: ${trans.identifier}\n💰 መጠን: ${trans.amount} ETB\n💵 አዲስ ባላንስ: ${finalBalance} ETB`, {
                chat_id: chatId, message_id: query.message.message_id
            });

            bot.sendMessage(trans.identifier, `🎉 የእርስዎ የ ${trans.amount} ETB ${trans.type} ጥያቄ ጸድቋል! አሁን ያሉት ባላንስ: ${finalBalance} ETB`);

        } else if (action === 'reject') {
            await pool.query('UPDATE transactions SET status = $1 WHERE id = $2', ['REJECTED', transId]);

            bot.editMessageText(`❌ የ${trans.type} ጥያቄ ውድቅ ተደርጓል።`, {
                chat_id: chatId, message_id: query.message.message_id
            });

            bot.sendMessage(trans.identifier, `❌ የእርስዎ የ ${trans.amount} ETB ${trans.type} ጥያቄ ውድቅ ተደርጓል።`);
        }
    } catch (e) {
        console.error('Callback Error:', e);
    }
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 📌 GLOBAL SOCKET.IO BINGO STATE
let gameInterval = null;
let drawnNumbers = [];
let isGameRunning = false;

io.on('connection', (socket) => {
    socket.emit('gameInit', { drawnHistory: drawnNumbers, isGameRunning });

    socket.on('startGame', () => {
        if (isGameRunning) return;

        isGameRunning = true;
        drawnNumbers = [];
        clearInterval(gameInterval);

        gameInterval = setInterval(() => {
            if (drawnNumbers.length >= 75) {
                clearInterval(gameInterval);
                isGameRunning = false;
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
        isGameRunning = false;
        const { identifier, winAmount } = data;

        if (identifier && winAmount) {
            try {
                const userRes = await pool.query(
                    `UPDATE users 
                     SET balance = balance + $1 
                     WHERE identifier = $2 
                     RETURNING balance`,
                    [parseFloat(winAmount), String(identifier)]
                );
                const newBalance = userRes.rows.length > 0 ? userRes.rows[0].balance : 0;
                console.log(`Bingo Winner: ${identifier}, New Balance: ${newBalance}`);
            } catch (err) {
                console.error("የማሸነፊያ ብር ማስገባት አልተቻለም:", err);
            }
        }

        io.emit('gameOver', { message: `አሸናፊ ተገኝቷል!` });
    });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
    console.log(`Bingo Backend Server runs on port ${PORT}`);
});
