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

// --- Game Rooms Management ---
let currentRoundId = 1;
let rooms = {
    [currentRoundId]: {
        status: 'WAITING', // WAITING, PLAYING, FINISHED
        timeLeft: 30,
        players: [],
        drawnNumbers: [],
        timer: null
    }
};

// Start the global countdown for the active waiting room
function startLobbyTimer(roundId) {
    if (rooms[roundId].timer) return;

    rooms[roundId].timer = setInterval(() => {
        if (rooms[roundId].timeLeft > 0) {
            rooms[roundId].timeLeft--;
            io.to(`room_${roundId}`).emit('timerUpdate', { timeLeft: rooms[roundId].timeLeft, roundId });
        } else {
            // Time's up! Lock the room and start the game
            clearInterval(rooms[roundId].timer);
            rooms[roundId].status = 'PLAYING';
            io.to(`room_${roundId}`).emit('gameStarted', { roundId, message: `Round ${roundId} ጀምሯል! በሮች ተዘግተዋል (Locked)።` });

            // Start drawing numbers for this specific room
            startRoomGame(roundId);

            // Create a new room for upcoming players immediately
            currentRoundId++;
            rooms[currentRoundId] = {
                status: 'WAITING',
                timeLeft: 30,
                players: [],
                drawnNumbers: [],
                timer: null
            };
            startLobbyTimer(currentRoundId);
        }
    }, 1000);
}

// Start drawing numbers every 3 seconds for the active playing room
function startRoomGame(roundId) {
    let room = rooms[roundId];
    let interval = setInterval(() => {
        if (room.status !== 'PLAYING' || room.drawnNumbers.length >= 75) {
            clearInterval(interval);
            return;
        }
        let rand;
        do {
            rand = Math.floor(Math.random() * 75) + 1;
        } while (room.drawnNumbers.includes(rand));

        room.drawnNumbers.push(rand);
        io.to(`room_${roundId}`).emit('numberDrawn', { number: rand, drawnHistory: room.drawnNumbers, roundId });
    }, 3000);
}

// Initialize the first room timer on boot
startLobbyTimer(currentRoundId);

// --- Telegram & API Routes ---
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
        let user = userRes.rows[0];

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

// --- Socket.io Rooms Connection Handling ---
io.on('connection', (socket) => {
    // Client joins the currently active WAITING room
    socket.on('joinActiveLobby', () => {
        // Find the active waiting room
        let activeRoomId = Object.keys(rooms).find(id => rooms[id].status === 'WAITING');
        if (!activeRoomId) {
            activeRoomId = currentRoundId;
        }

        socket.join(`room_${activeRoomId}`);
        socket.emit('joinedRoom', { 
            roundId: activeRoomId, 
            status: rooms[activeRoomId].status, 
            timeLeft: rooms[activeRoomId].timeLeft 
        });
    });

    socket.on('claimBingo', async (data) => {
        const { identifier, winAmount, roundId } = data;
        let room = rooms[roundId];
        
        if (!room || room.status !== 'PLAYING') {
            return socket.emit('bingoResponse', { success: false, message: 'ይህ ዙር አልተፈቀደም ወይም አብቅቷል!' });
        }

        try {
            let userRes = await pool.query('SELECT * FROM users WHERE identifier = $1', [identifier]);
            if (userRes.rows.length > 0) {
                let newBal = parseFloat(userRes.rows[0].balance) + parseFloat(winAmount);
                await pool.query('UPDATE users SET balance = $1 WHERE identifier = $2', [newBal, identifier]);
                
                room.status = 'FINISHED';
                io.to(`room_${roundId}`).emit('gameOver', { message: `🎉 ተጫዋች ${userRes.rows[0].name} በ Round ${roundId} አሸንፏል!` });
            }
        } catch (e) {
            console.error(e);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
