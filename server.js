const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const TelegramBot = require('node-telegram-bot-api');
const pool = require('./database');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

app.use(express.json());
app.use(express.static('public'));

const TOKEN = '8957133551:AAGBPCGEzFLtJRXHRU0PfKJ2QXDf1AyvXec';
const ADMIN_CHAT_ID = '686733543';
const WEB_APP_URL = 'https://wana-bingo.onrender.com';
// የላክኸው የ3D ፎቶ URL (ወይም በቦቱ የላከውን photo_id መጠቀም ትችላለህ)
const PHOTO_URL = `${WEB_APP_URL}/bingo_bg.jpg`;

let bot = null;
if (TOKEN) {
    try {
        bot = new TelegramBot(TOKEN, {  
            polling: { interval: 300, autoStart: true, params: { timeout: 10 } } 
        });
        console.log('Telegram Bot started successfully!');
    } catch (err) {
        console.error('Telegram Bot initialization error:', err);
    }
}

async function initializeDatabase() {
    try {
        await pool.query(`
            DO $$ 
            BEGIN 
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='transactions' AND column_name='details') THEN
                    ALTER TABLE transactions ADD COLUMN details TEXT;
                END IF;
            END $$;
        `);
    } catch (err) {
        console.error('Database initialization warning:', err.message);
    }
}
initializeDatabase();

// --- TELEGRAM BOT COMMANDS ---
if (bot) {
    bot.setMyCommands([
        { command: 'start', description: 'ቦቱን ለመጀመር' },
        { command: 'play', description: '🎮 Play Bingo (ጨዋታውን ክፈት)' },
        { command: 'balance', description: '💰 ቀሪ ሂሳብዎን ለማየት' }
    ]);

    bot.onText(/\/start/, (msg) => {
        const chatId = msg.chat.id;
        const name = msg.from.first_name;
        
        let welcomeCaption = `✨ **እንኳን ወደ እድል ቢንጎ በደህና መጡ!** ✨\n\n` +
                             `ሰላም **${name}**! በደስታ የተሞላውን የቢንጎ ጨዋታ ይቀላቀሉ! በአድስ መልኩ የቀረበውን የቢንጎ ጨዋታ ተጫውተው አሸናፊ ይሁኑ።\n\n` +
                             `👇 **ጨዋታውን ለመጀመር ከታች ያለውን ቁልፍ ይጫኑ፡**`;

        // አዲሱን 3D ፎቶ ከነጽሁፉ እና ከዌብ አፕ ቁልፉ ጋር ይልካል
        bot.sendPhoto(chatId, PHOTO_URL, {
            caption: welcomeCaption,
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🎲 ጨዋታውን ጀምር (Play Bingo) 🚀', web_app: { url: WEB_APP_URL } }]
                ]
            }
        }).catch(() => {
            // ፎቶ መላክ ካልቻለ በጽሁፍ ብቻ ይልካል
            bot.sendMessage(chatId, welcomeCaption, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🎲 ጨዋታውን ጀምር (Play Bingo) 🚀', web_app: { url: WEB_APP_URL } }]
                    ]
                }
            });
        });
    });

    bot.onText(/\/play/, (msg) => {
        bot.sendMessage(msg.chat.id, `🎮 የቢንጎ ጨዋታውን ለመጀመር ከታች ያለውን ቁልፍ ይጫኑ፡`, {
            reply_markup: { inline_keyboard: [[{ text: '🚀 Play Bingo Web App 🎮', web_app: { url: WEB_APP_URL } }]] }
        });
    });

    bot.onText(/\/balance/, async (msg) => {
        const chatId = msg.chat.id;
        try {
            const userRes = await pool.query('SELECT balance, name FROM users WHERE identifier = $1', [chatId.toString()]);
            if (userRes.rows.length > 0) {
                bot.sendMessage(chatId, `👤 ስም: ${userRes.rows[0].name}\n💰 ቀሪ ባላንስዎ: ${userRes.rows[0].balance} ETB`);
            } else {
                bot.sendMessage(chatId, `እባክዎ መጀመሪያ ዌብሳይቱ ላይ በመግባት አካውንት ይክፈቱ!`);
            }
        } catch (err) {
            bot.sendMessage(chatId, 'የሰርቨር ስህተት አጋጥሟል።');
        }
    });

    // --- ADMIN APPROVE / REJECT HANDLER ---
    bot.on('callback_query', async (callbackQuery) => {
        const action = callbackQuery.data;
        const msg = callbackQuery.message;
        const parts = action.split('_');
        const status = parts[0]; 
        const tx_id = parts[1];
        const identifier = parts[2];
        const amount = parseFloat(parts[3]);
        const type = parts[4];

        try {
            if (status === 'approve') {
                if (type === 'DEPOSIT') {
                    const userRes = await pool.query('SELECT balance FROM users WHERE identifier = $1', [identifier]);
                    if (userRes.rows.length > 0) {
                        let newBal = parseFloat(userRes.rows[0].balance) + amount;
                        await pool.query('UPDATE users SET balance = $1 WHERE identifier = $2', [newBal, identifier]);
                    }
                }
                await pool.query('UPDATE transactions SET handled = TRUE WHERE tx_id = $1', [tx_id]);
                await bot.editMessageText(`✅ **ይህ ጥያቄ (${tx_id}) በስኬት ጸድቋል (Approved)!**`, {
                    chat_id: msg.chat.id, message_id: msg.message_id, parse_mode: 'Markdown'
                });
            } else if (status === 'reject') {
                if (type === 'WITHDRAW') {
                    const userRes = await pool.query('SELECT balance FROM users WHERE identifier = $1', [identifier]);
                    if (userRes.rows.length > 0) {
                        let newBal = parseFloat(userRes.rows[0].balance) + amount;
                        await pool.query('UPDATE users SET balance = $1 WHERE identifier = $2', [newBal, identifier]);
                    }
                }
                await pool.query('UPDATE transactions SET handled = TRUE WHERE tx_id = $1', [tx_id]);
                await bot.editMessageText(`❌ **ይህ ጥያቄ (${tx_id}) ውድቅ ተደርጓል (Rejected)!**`, {
                    chat_id: msg.chat.id, message_id: msg.message_id, parse_mode: 'Markdown'
                });
            }
            await bot.answerCallbackQuery(callbackQuery.id, { text: 'ተጠናቋል!' });
        } catch (err) {
            console.error('Error handling callback:', err);
        }
    });
}

// --- API ENDPOINTS ---
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
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.post('/api/place-bet', async (req, res) => {
    const { identifier, amount } = req.body;
    try {
        const userRes = await pool.query('SELECT balance FROM users WHERE identifier = $1', [identifier]);
        if (userRes.rows.length === 0) return res.json({ success: false, message: 'ተጠቃሚው አልተገኘም' });
        
        let balance = parseFloat(userRes.rows[0].balance);
        if (balance < amount) return res.json({ success: false, message: 'በቂ ባላንስ የለዎትም!' });

        let newBalance = balance - amount;
        await pool.query('UPDATE users SET balance = $1 WHERE identifier = $2', [newBalance, identifier]);
        res.json({ success: true, newBalance });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.post('/api/request-transaction', async (req, res) => {
    const { identifier, type, amount, details, sms } = req.body;
    const tx_id = 'TX' + Math.floor(100000 + Math.random() * 900000);
    
    try {
        if (type === 'WITHDRAW') {
            const userRes = await pool.query('SELECT balance FROM users WHERE identifier = $1', [identifier]);
            if (userRes.rows.length === 0) return res.json({ success: false, message: 'ተጠቃሚው አልተገኘም' });
            
            let currentBalance = parseFloat(userRes.rows[0].balance);
            if (currentBalance < parseFloat(amount)) return res.json({ success: false, message: 'በዋሌትዎ ውስጥ ያለው ብር በቂ አይደለም!' });

            let newBalance = currentBalance - parseFloat(amount);
            await pool.query('UPDATE users SET balance = $1 WHERE identifier = $2', [newBalance, identifier]);
        }

        const fullDetails = sms ? `SMS: ${sms} | ${details || ''}` : (details || 'N/A');
        await pool.query(
            'INSERT INTO transactions (tx_id, identifier, type, amount, details, handled) VALUES ($1, $2, $3, $4, $5, FALSE)',
            [tx_id, identifier, type, amount, fullDetails]
        );

        if (bot && ADMIN_CHAT_ID) {
            const userRes = await pool.query('SELECT name, username, phone FROM users WHERE identifier = $1', [identifier]);
            let userInfo = userRes.rows[0] || {};
            
            let msgText = `🔔 **አዲስ የ ${type} ጥያቄ ገብቷል!**\n\n` +
                          `🆔 **TxID:** \`${tx_id}\`\n` +
                          `👤 **ስም:** ${userInfo.name || 'Unknown'} (@${userInfo.username || 'none'})\n` +
                          `💰 **መጠን:** ${amount} ETB\n` +
                          `📝 **መረጃ:** ${fullDetails}`;

            await bot.sendMessage(ADMIN_CHAT_ID, msgText, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: '✅ አረጋግጥ (Approve)', callback_data: `approve_${tx_id}_${identifier}_${amount}_${type}` },
                            { text: '❌ ሰርዝ (Reject)', callback_data: `reject_${tx_id}_${identifier}_${amount}_${type}` }
                        ]
                    ]
                }
            });
        }

        res.json({ success: true, tx_id });
    } catch (err) {
        res.status(500).json({ success: false, message: 'ሰርቨር ላይ ስህተት ተፈጥሯል' });
    }
});

// --- GAME LOGIC (SOCKET.IO) ---
let activeRooms = {}; 

function getActivePlayersCount(room) {
    let activeSocketIds = new Set();
    for (let bNum in room.selectedBoards) {
        if (room.selectedBoards[bNum]) activeSocketIds.add(room.selectedBoards[bNum]);
    }
    for (let socketId of room.players) activeSocketIds.add(socketId);
    return activeSocketIds.size;
}

function calculatePrizePool(room) {
    let activeCount = getActivePlayersCount(room);
    let totalBet = activeCount * parseFloat(room.betAmount);
    let prizePool = totalBet * 0.90;
    return Math.floor(prizePool > 0 ? prizePool : parseFloat(room.betAmount));
}

function getOrCreateLobby(betAmount) {
    let roomId = null;
    for (let id in activeRooms) {
        if (activeRooms[id].betAmount === betAmount) { roomId = id; break; }
    }

    if (!roomId) {
        let uniqueId = Math.floor(1000 + Math.random() * 9000);
        roomId = `ROOM_${betAmount}_${uniqueId}`;
        activeRooms[roomId] = {
            roomId, betAmount, status: 'waiting', players: new Set(),
            playerNames: {}, selectedBoards: {}, drawnNumbers: [],
            countdown: 30, startTime: Date.now() + 30000
        };
        startGlobalLobbyCountdown(roomId);
    }
    return activeRooms[roomId];
}

function startGlobalLobbyCountdown(roomId) {
    let room = activeRooms[roomId];
    if (!room) return;
    if (room.timer) clearInterval(room.timer);

    room.timer = setInterval(() => {
        if (room.status !== 'waiting') return;
        room.countdown--;

        if (room.countdown <= 0) {
            if (room.players.size < 1) {
                room.countdown = 30;
                room.startTime = Date.now() + 30000;
            } else {
                startRoomGame(roomId);
            }
        }
        io.to(roomId).emit('countdownUpdate', { 
            countdown: room.countdown, status: room.status, startTime: room.startTime
        });
    }, 1000);
}

function startRoomGame(roomId) {
    let room = activeRooms[roomId];
    if (!room) return;
    room.status = 'playing';
    if (room.timer) clearInterval(room.timer);

    io.to(roomId).emit('gameStarted', { prizePool: calculatePrizePool(room) });

    room.gameInterval = setInterval(() => {
        if (room.drawnNumbers.length >= 75) {
            clearInterval(room.gameInterval);
            room.status = 'ended';
            io.to(roomId).emit('gameOver', { message: '75ቱ ቁጥሮች ተጠርተዋል።' });
            return;
        }

        let rand;
        do { rand = Math.floor(Math.random() * 75) + 1; } while (room.drawnNumbers.includes(rand));

        room.drawnNumbers.push(rand);
        io.to(roomId).emit('numberDrawn', { number: rand, drawnHistory: room.drawnNumbers });
    }, 3000);
}

io.on('connection', (socket) => {
    socket.on('joinLobby', (data) => {
        let room = getOrCreateLobby(data.betAmount || '20');
        socket.join(room.roomId);
        room.players.add(socket.id);
        socket.emit('assignedRoom', { roomId: room.roomId, selectedBoards: room.selectedBoards });
    });

    socket.on('selectBoardTemp', (data) => {
        let room = activeRooms[data.roomId];
        if (room && !room.selectedBoards[data.boardNumber]) {
            socket.emit('boardTempSelected', { boardNumber: data.boardNumber });
        }
    });

    socket.on('startPlayerGame', (data) => {
        let room = activeRooms[data.roomId];
        if (room && !room.selectedBoards[data.boardNumber]) {
            room.selectedBoards[data.boardNumber] = socket.id;
            io.to(data.roomId).emit('boardSelected', { boardNumber: data.boardNumber, socketId: socket.id });
            socket.emit('gameJoinSuccess', { boardNumber: data.boardNumber });
        }
    });

    socket.on('claimBingo', async (data) => {
        let room = activeRooms[data.roomId];
        if (room && room.status === 'playing') {
            room.status = 'ended';
            clearInterval(room.gameInterval);
            
            let userRes = await pool.query('SELECT balance FROM users WHERE identifier = $1', [data.identifier]);
            if (userRes.rows.length > 0) {
                let newBal = parseFloat(userRes.rows[0].balance) + parseFloat(data.winAmount);
                await pool.query('UPDATE users SET balance = $1 WHERE identifier = $2', [data.identifier, newBal]);
            }

            io.to(data.roomId).emit('gameOver', { 
                winnerName: data.name, boardNumber: data.boardNumber, winAmount: data.winAmount, winningLine: data.winningLine 
            });
        }
    });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, `0.0.0.0`, () => console.log(`Server running on port ${PORT}`));
