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

const pool = new Pool({
    connectionString: POSTGRES_URI,
    ssl: { rejectUnauthorized: false }
});

async function initDb() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                identifier VARCHAR(255) PRIMARY KEY,
                username VARCHAR(255) DEFAULT '',
                name VARCHAR(255) DEFAULT 'ተጫዋች',
                phone VARCHAR(255) DEFAULT '',
                is_verified BOOLEAN DEFAULT FALSE,
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
        console.error('❌ DB Error:', err.message);
    }
}
initDb();

const bot = new TelegramBot(TOKEN, { polling: true });

bot.setMyCommands([
    { command: 'start', description: '🤖 ቦቱን ለመጀመር / Start' },
    { command: 'deposit', description: '💳 ብር ገቢ ለማድረግ / Deposit' },
    { command: 'withdraw', description: '💸 ብር ወጪ ለማድረግ / Withdraw' }
]);

// 📌 Auto Register User
async function ensureUserRegistered(msg) {
    try {
        const chatId = String(msg.chat.id);
        const firstName = msg.from.first_name || 'ተጫዋች';
        const username = msg.from.username || '';

        const res = await pool.query('SELECT * FROM users WHERE identifier = $1', [chatId]);
        if (res.rows.length === 0) {
            const insertRes = await pool.query(
                `INSERT INTO users (identifier, username, name, balance) 
                 VALUES ($1, $2, $3, 50) RETURNING *`,
                [chatId, username, firstName]
            );
            return insertRes.rows[0];
        }
        return res.rows[0];
    } catch (err) {
        console.error('User registration error:', err);
    }
}

// 📌 Bot Commands & Handlers
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const firstName = msg.from.first_name || 'ተጫዋች';

    const user = await ensureUserRegistered(msg);

    let keyboard = [
        [{ text: "🎮 ጨዋታውን ጀምር (Play Bingo)", web_app: { url: WEB_APP_URL } }]
    ];

    // ስልካቸውን ካላረጋገጡ የስልክ ቁጥር ማጋሪያ በተን እናሳያቸዋለን
    if (!user || !user.is_verified) {
        keyboard.unshift([{ text: "📱 ስልክ ቁጥር ያጋሩ (Share Phone)", request_contact: true }]);
    }

    bot.sendMessage(chatId, `👋 ሰላም **${firstName}**!\n\nእንኳን ወደ **Wana Bingo** በደህና መጡ! 🎲🎉\n\n📱 **Telebirr:** \`0915503379\`\n\nእባክዎን መጀመሪያ **"📱 ስልክ ቁጥር ያጋሩ"** የሚለውን በመጫን አካውንትዎን ያረጋግጡ!`, {
        parse_mode: 'Markdown',
        reply_markup: { keyboard, resize_keyboard: true }
    });
});

// 📌 Contact Receive Handler (ስልክ ቁጥር ማረጋገጫ)
bot.on('contact', async (msg) => {
    const chatId = String(msg.chat.id);
    const phoneNumber = msg.contact.phone_number;

    try {
        await pool.query(
            `UPDATE users SET phone = $1, is_verified = TRUE WHERE identifier = $2`,
            [phoneNumber, chatId]
        );

        bot.sendMessage(chatId, `✅ **ስልክ ቁጥርዎ በትክክል ተረጋግጧል!** (${phoneNumber})\n\nአሁን ከታች ያለውን በተን ተጭነው መጫወት ይችላሉ!`, {
            parse_mode: 'Markdown',
            reply_markup: {
                keyboard: [[{ text: "🎮 ጨዋታውን ጀምር", web_app: { url: WEB_APP_URL } }]],
                resize_keyboard: true
            }
        });
    } catch (e) {
        console.error('Contact Update Error:', e);
    }
});

// 📌 API Endpoints
app.post('/api/get-user', async (req, res) => {
    try {
        const { identifier, name, username } = req.body;
        if (!identifier) return res.status(400).json({ success: false, error: 'ID ያስፈልጋል' });

        const strId = String(identifier);
        let userQuery = await pool.query('SELECT * FROM users WHERE identifier = $1', [strId]);

        if (userQuery.rows.length === 0) {
            userQuery = await pool.query(
                `INSERT INTO users (identifier, username, name, balance)
                 VALUES ($1, $2, $3, 50) RETURNING *`,
                [strId, username || '', name || 'ተጫዋች']
            );
        }

        res.status(200).json({ success: true, user: userQuery.rows[0] });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// 📌 Request Transaction (Deposit / Withdraw)
app.post('/api/request-transaction', async (req, res) => {
    try {
        const { identifier, type, amount, details } = req.body;
        const strId = String(identifier);
        const numAmount = parseFloat(amount);

        if (!identifier || !type || isNaN(numAmount) || numAmount <= 0 || !details) {
            return res.status(400).json({ success: false, message: 'እባክዎን ትክክለኛ መረጃ ያስገቡ' });
        }

        const userRes = await pool.query('SELECT balance, is_verified FROM users WHERE identifier = $1', [strId]);
        if (userRes.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'ተጠቃሚው አልተገኘም!' });
        }

        const user = userRes.rows[0];

        // ⚠️ የወጪ (Withdraw) ጥያቄ ከሆነ ብሩን ወዲያውኑ ከባላንስ እንቀንሳለን (Hold)
        if (type === 'WITHDRAW') {
            if (parseFloat(user.balance) < numAmount) {
                return res.status(400).json({ success: false, message: 'ያለዎት ባላንስ ለቀረበው የወጪ ጥያቄ በቂ አይደለም!' });
            }

            await pool.query(
                `UPDATE users SET balance = balance - $1 WHERE identifier = $2`,
                [numAmount, strId]
            );
        }

        const transRes = await pool.query(
            `INSERT INTO transactions (identifier, type, amount, details) VALUES ($1, $2, $3, $4) RETURNING id`,
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
            `📥 **አዲስ የ${type} ጥያቄ!**\n\n👤 ID: \`${strId}\`\n💰 መጠን: ${numAmount} ETB\n📝 መረጃ/SMS: ${details}`,
            { parse_mode: 'Markdown', reply_markup: inlineKeyboard }
        );

        res.status(200).json({ success: true, message: 'ጥያቄዎ ለአድሚን ተልኳል!' });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// 📌 Admin Callback Query Handler
bot.on('callback_query', async (query) => {
    const data = query.data;
    const chatId = query.message.chat.id;

    if (chatId.toString() !== ADMIN_ID.toString()) {
        return bot.answerCallbackQuery(query.id, { text: "ፈቃድ የለዎትም!" });
    }

    const [action, transId] = data.split('_');

    try {
        const transRes = await pool.query('SELECT * FROM transactions WHERE id = $1', [transId]);
        const trans = transRes.rows[0];

        if (!trans || trans.status !== 'PENDING') {
            return bot.answerCallbackQuery(query.id, { text: "ጥያቄው ቀድሞ ተስተናግዷል!" });
        }

        const transAmount = parseFloat(trans.amount);

        if (action === 'approve') {
            if (trans.type === 'DEPOSIT') {
                await pool.query(`UPDATE users SET balance = balance + $1 WHERE identifier = $2`, [transAmount, trans.identifier]);
            }

            await pool.query('UPDATE transactions SET status = $1 WHERE id = $2', ['APPROVED', transId]);

            const updatedUser = await pool.query('SELECT balance FROM users WHERE identifier = $1', [trans.identifier]);
            const newBal = updatedUser.rows[0]?.balance || 0;

            bot.editMessageText(`✅ የ${trans.type} ጥያቄ ጸድቋል።\n👤 ID: ${trans.identifier}\n💰 መጠን: ${transAmount} ETB`, {
                chat_id: chatId, message_id: query.message.message_id
            });

            bot.sendMessage(trans.identifier, `🎉 የእርስዎ የ ${transAmount} ETB ${trans.type} ጥያቄ ጸድቋል! አሁን ያሉት ባላንስ: ${newBal} ETB`);

        } else if (action === 'reject') {
            // የወጪ ጥያቄ ውድቅ ከተደረገ የተቀነሰውን ብር ይመልስለታል (Refund)
            if (trans.type === 'WITHDRAW') {
                await pool.query(`UPDATE users SET balance = balance + $1 WHERE identifier = $2`, [transAmount, trans.identifier]);
            }

            await pool.query('UPDATE transactions SET status = $1 WHERE id = $2', ['REJECTED', transId]);

            bot.editMessageText(`❌ የ${trans.type} ጥያቄ ውድቅ ተደርጓል።`, {
                chat_id: chatId, message_id: query.message.message_id
            });

            bot.sendMessage(trans.identifier, `❌ የእርስዎ የ ${transAmount} ETB ${trans.type} ጥያቄ ውድቅ ተደርጓል። የተቀነሰው ብር ወደ ባላንስዎ ተመልሷል።`);
        }
    } catch (e) {
        console.error('Callback Error:', e);
    }
});

// Socket.io Bingo Game Logic
let drawnNumbers = [];
let isGameRunning = false;
let gameInterval = null;

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
            do { rand = Math.floor(Math.random() * 75) + 1; } while (drawnNumbers.includes(rand));
            drawnNumbers.push(rand);
            io.emit('numberDrawn', { number: rand, drawnHistory: drawnNumbers });
        }, 3000);
    });

    socket.on('claimBingo', async (data) => {
        clearInterval(gameInterval);
        isGameRunning = false;
        const { identifier, winAmount } = data;

        if (identifier && winAmount) {
            await pool.query(`UPDATE users SET balance = balance + $1 WHERE identifier = $2`, [parseFloat(winAmount), String(identifier)]);
        }
        io.emit('gameOver', { message: `አሸናፊ ተገኝቷል!` });
    });
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log(`Server runs on port ${PORT}`));
