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
const PHOTO_URL = `${WEB_APP_URL}/bingo_bg.jpg`;

const userStates = {};
let bot = null;

if (TOKEN) {
    try {
        bot = new TelegramBot(TOKEN, {  
            polling: { interval: 300, autoStart: true, params: { timeout: 10 } } 
        });
        console.log('Telegram Bot started successfully!');
        bot.on('polling_error', (error) => {
            console.log(`Telegram Polling Error: ${error.code} - ${error.message}`);
        });
    } catch (err) {
        console.error('Telegram Bot initialization error:', err);
    }
}

// 🛠️ ዳታቤዝ ማስተካከያ (ስህተት እንዳይፈጥር)
async function initializeDatabase() {
    try {
        // 1. ሰንጠረዦች ከሌሉ መፍጠር
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                identifier TEXT UNIQUE NOT NULL,
                name TEXT,
                username TEXT,
                phone TEXT,
                balance NUMERIC(12, 2) DEFAULT 0.00,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS transactions (
                id SERIAL PRIMARY KEY,
                tx_id TEXT UNIQUE NOT NULL,
                identifier TEXT NOT NULL,
                type TEXT NOT NULL,
                amount NUMERIC(12, 2) NOT NULL,
                details TEXT,
                handled BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // 2. አስፈላጊ የሆኑ ዓምዶች (Columns) መኖራቸውን ማረጋገጥ
        await pool.query(`
            DO $$ 
            BEGIN 
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='transactions' AND column_name='details') THEN
                    ALTER TABLE transactions ADD COLUMN details TEXT;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='phone') THEN
                    ALTER TABLE users ADD COLUMN phone TEXT;
                END IF;
            END $$;
        `);
        console.log('Database tables checked and updated.');
    } catch (err) {
        console.error('Database initialization error:', err.message);
    }
}
initializeDatabase();

// ==========================================
// 🔹 API ENDPOINTS
// ==========================================

app.get('/api/admin/users', async (req, res) => {
    try {
        const usersRes = await pool.query('SELECT id, identifier, name, username, phone, balance, created_at FROM users ORDER BY id DESC');
        res.json({ success: true, totalUsers: usersRes.rows.length, users: usersRes.rows });
    } catch (err) {
        console.error('Error fetching admin users:', err);
        res.status(500).json({ success: false, message: 'Server Error' });
    }
});

app.post('/api/get-user', async (req, res) => {
    const { identifier, name, username } = req.body;
    if (!identifier) return res.status(400).json({ success: false, message: 'Identifier missing' });
    
    const strIdentifier = String(identifier);
    try {
        let userRes = await pool.query('SELECT * FROM users WHERE identifier = $1', [strIdentifier]);
        let user;
        if (userRes.rows.length === 0) {
            const insertRes = await pool.query(
                'INSERT INTO users (identifier, name, username, balance) VALUES ($1, $2, $3, $4) RETURNING *',
                [strIdentifier, name || 'Player', username || '', 0.00]
            );
            user = insertRes.rows[0];
        } else {
            user = userRes.rows[0];
        }
        res.json({ success: true, user });
    } catch (err) {
        console.error('Get user error:', err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.post('/api/update-phone', async (req, res) => {
    const { identifier, phone } = req.body;
    const strIdentifier = String(identifier);
    try {
        await pool.query('UPDATE users SET phone = $1 WHERE identifier = $2', [phone, strIdentifier]);
        
        if (bot && ADMIN_CHAT_ID) {
            try {
                const userRes = await pool.query('SELECT name, username FROM users WHERE identifier = $1', [strIdentifier]);
                let userInfo = userRes.rows[0] || {};
                let msgText = `📱 **አዲስ ስልክ ቁጥር ተመዝግቧል!**\n` +
                              `👤 ስም: ${userInfo.name || 'Unknown'} (@${userInfo.username || 'none'})\n` +
                              `🆔 Telegram ID: \`${strIdentifier}\`\n` +
                              `📞 ስልክ ቁጥር: \`${phone}\``;
                await bot.sendMessage(ADMIN_CHAT_ID, msgText, { parse_mode: 'Markdown' });
            } catch (e) { console.error('Notify admin error:', e); }
        }

        res.json({ success: true });
    } catch (err) {
        console.error('Update phone error:', err);
        res.status(500).json({ success: false });
    }
});

app.post('/api/place-bet', async (req, res) => {
    const { identifier, amount } = req.body;
    const strIdentifier = String(identifier);
    const numAmount = parseFloat(amount);

    try {
        const userRes = await pool.query('SELECT balance FROM users WHERE identifier = $1', [strIdentifier]);
        if (userRes.rows.length === 0) return res.json({ success: false, message: 'ተጠቃሚው አልተገኘም' });
        
        let balance = parseFloat(userRes.rows[0].balance);
        if (balance < numAmount) return res.json({ success: false, message: 'በቂ ባላንስ የለዎትም!' });

        let newBalance = balance - numAmount;
        await pool.query('UPDATE users SET balance = $1 WHERE identifier = $2', [newBalance, strIdentifier]);
        res.json({ success: true, newBalance });
    } catch (err) {
        console.error('Place bet error:', err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.post('/api/request-transaction', async (req, res) => {
    const { identifier, type, amount, details, sms } = req.body;
    const strIdentifier = String(identifier);
    const numAmount = parseFloat(amount);
    const txDetails = details || sms || 'N/A';
    const tx_id = 'TX' + Math.floor(100000 + Math.random() * 900000);
    
    try {
        if (type === 'WITHDRAW') {
            const userRes = await pool.query('SELECT balance FROM users WHERE identifier = $1', [strIdentifier]);
            if (userRes.rows.length === 0) return res.json({ success: false, message: 'ተጠቃሚው አልተገኘም' });
            
            let currentBalance = parseFloat(userRes.rows[0].balance);
            if (currentBalance < numAmount) {
                return res.json({ success: false, message: 'በዋሌትዎ ውስጥ ያለው ብር በቂ አይደለም!' });
            }
            let newBalance = currentBalance - numAmount;
            await pool.query('UPDATE users SET balance = $1 WHERE identifier = $2', [newBalance, strIdentifier]);
        }

        await pool.query(
            'INSERT INTO transactions (tx_id, identifier, type, amount, details, handled) VALUES ($1, $2, $3, $4, $5, FALSE)',
            [tx_id, strIdentifier, type, numAmount, txDetails]
        );

        if (bot && ADMIN_CHAT_ID) {
            try {
                const userRes = await pool.query('SELECT name, username, phone FROM users WHERE identifier = $1', [strIdentifier]);
                let userInfo = userRes.rows[0] || {};
                
                let msgText = `🔔 አዲስ የ ${type} ጥያቄ ገብቷል!\n` +
                              `🆔 TxID: ${tx_id}\n` +
                              `👤 ስም: ${userInfo.name || 'Unknown'} (@${userInfo.username || 'none'})\n` +
                              `📱 ስልክ: ${userInfo.phone || 'N/A'}\n` +
                              `💰 መጠን: ${numAmount} ብር\n` +
                              `🏦 መረጃ/መግለጫ: ${txDetails}`;

                await bot.sendMessage(ADMIN_CHAT_ID, msgText, {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [
                                { text: '✅ አረጋግጥ (Approve)', callback_data: `approve_${tx_id}_${strIdentifier}_${numAmount}_${type}` },
                                { text: '❌ ሰርዝ (Reject)', callback_data: `reject_${tx_id}_${strIdentifier}_${numAmount}_${type}` }
                            ]
                        ]
                    }
                });
            } catch (notifyErr) {
                console.error('Admin notification error:', notifyErr);
            }
        }

        res.json({ success: true, tx_id });
    } catch (err) {
        console.error('Request transaction error:', err);
        res.status(500).json({ success: false, message: 'ሰርቨር ላይ ስህተት ተፈጥሯል' });
    }
});

// ==========================================
// 🤖 TELEGRAM BOT LOGIC
// ==========================================

if (bot) {
    bot.setMyCommands([
        { command: 'start', description: 'ቦቱን ለመጀመር' },
        { command: 'play', description: '🎮 Play Bingo' },
        { command: 'balance', description: '💰 ቀሪ ሂሳብ' },
        { command: 'deposit', description: '💳 የዲፖዚት መመሪያ' },
        { command: 'withdraw', description: '💸 ገንዘብ ወጪ ለማድረግ' },
        { command: 'cancel', description: '❌ ሂደቱን ሰርዝ' }
    ]);

    bot.onText(/\/start/, (msg) => {
        const chatId = msg.chat.id;
        delete userStates[chatId];
        
        let welcomeCaption = `✨ **እንኳን ወደ እድል ቢንጎ በደህና መጡ!** ✨\n\n` +
                             `ሰላም **${msg.from.first_name}**! 👋\n\n` +
                             `🎯 **እየተዝናኑ እድልዎን ይፈትሹ!**`;

        const inlineButtons = {
            inline_keyboard: [
                [{ text: '🎲 ጨዋታውን ጀምር (Play Bingo) 🚀', web_app: { url: WEB_APP_URL } }],
                [{ text: '💳 Deposit', callback_data: 'btn_deposit' }, { text: '💸 Withdraw', callback_data: 'btn_withdraw' }]
            ]
        };

        let keyboardRows = [
            [{ text: "Check Balance 💰" }, { text: "Contact Us 📞" }],
            [{ text: "📲 Share Contact", request_contact: true }]
        ];

        if (chatId.toString() === ADMIN_CHAT_ID.toString()) {
            keyboardRows.push([{ text: "👑 Admin Panel" }]);
        }

        bot.sendMessage(chatId, welcomeCaption, {
            parse_mode: 'Markdown',
            reply_markup: inlineButtons
        });
    });

    bot.on('callback_query', async (callbackQuery) => {
        const action = callbackQuery.data;
        const msg = callbackQuery.message;
        const parts = action.split('_');
        
        if (parts.length >= 5) {
            const status = parts[0]; 
            const tx_id = parts[1];
            const identifier = parts[2];
            const amount = parseFloat(parts[3]);
            const type = parts[4]; 

            try {
                if (status === 'approve') {
                    if (type === 'DEPOSIT') {
                        await pool.query('UPDATE users SET balance = balance + $1 WHERE identifier = $2', [amount, identifier]);
                    }
                    await pool.query('UPDATE transactions SET handled = TRUE WHERE tx_id = $1', [tx_id]);

                    await bot.editMessageText(`✅ **ጥያቄ (${tx_id}) ፀድቋል (Approved)!**`, {
                        chat_id: msg.chat.id, message_id: msg.message_id, parse_mode: 'Markdown'
                    });
                    try { await bot.sendMessage(identifier, `🎉 የ ${tx_id} የ ${type} ጥያቄዎ ${amount} ብር ፀድቋል።`); } catch (e) {}

                } else if (status === 'reject') {
                    if (type === 'WITHDRAW') {
                        await pool.query('UPDATE users SET balance = balance + $1 WHERE identifier = $2', [amount, identifier]);
                    }
                    await pool.query('UPDATE transactions SET handled = TRUE WHERE tx_id = $1', [tx_id]);

                    await bot.editMessageText(`❌ **ጥያቄ (${tx_id}) ተሰርዟል (Rejected)!**`, {
                        chat_id: msg.chat.id, message_id: msg.message_id, parse_mode: 'Markdown'
                    });
                    try { await bot.sendMessage(identifier, `❌ የ ${tx_id} የ ${type} ጥያቄዎ አልፀደቀም።`); } catch (e) {}
                }
                await bot.answerCallbackQuery(callbackQuery.id, { text: 'ተከናውኗል!' });
            } catch (err) {
                console.error('Callback query error:', err);
            }
        }
    });
}

// ==========================================
// 🎲 GAME LOBBY & SOCKET.IO ENGINE
// ==========================================

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
    let prizePool = totalBet * 0.90; // 10% ኮሚሽን
    return Math.floor(prizePool > 0 ? prizePool : parseFloat(room.betAmount));
}

function getOrCreateLobby(betAmount) {
    let roomId = null;
    for (let id in activeRooms) {
        if (activeRooms[id].betAmount === betAmount && activeRooms[id].status === 'waiting') {
            roomId = id;
            break;
        }
    }

    if (!roomId) {
        let uniqueId = Math.floor(1000 + Math.random() * 9000);
        roomId = `ROOM_${betAmount}_${uniqueId}`;
        
        activeRooms[roomId] = {
            roomId,
            betAmount,
            status: 'waiting', 
            players: new Set(),
            playerNames: {},
            selectedBoards: {}, 
            drawnNumbers: [],
            countdown: 30,
            startTime: Date.now() + 30000,
            timer: null,
            gameInterval: null
        };
        startGlobalLobbyCountdown(roomId);
    }
    return activeRooms[roomId];
}

function resetRoomForNextGame(roomId) {
    let room = activeRooms[roomId];
    if (!room) return;

    room.drawnNumbers = [];
    room.selectedBoards = {}; 
    room.status = 'waiting';
    room.countdown = 30;
    room.startTime = Date.now() + 30000;

    io.to(roomId).emit('roomResetForNextRound', {
        status: room.status,
        countdown: room.countdown,
        startTime: room.startTime,
        selectedBoards: room.selectedBoards
    });

    startGlobalLobbyCountdown(roomId);
}

function startGlobalLobbyCountdown(roomId) {
    let room = activeRooms[roomId];
    if (!room) return;

    if (room.timer) clearInterval(room.timer);

    room.timer = setInterval(() => {
        if (room.status !== 'waiting') return;

        room.countdown--;

        io.to(roomId).emit('countdownUpdate', { 
            countdown: room.countdown, 
            status: room.status,
            activePlayersCount: getActivePlayersCount(room),
            prizePool: calculatePrizePool(room),
            startTime: room.startTime
        });

        if (room.countdown <= 0) {
            let selectedBoardsCount = Object.keys(room.selectedBoards).length;
            if (selectedBoardsCount < 1) {
                room.countdown = 30;
                room.startTime = Date.now() + 30000;
            } else {
                startRoomGame(roomId);
            }
        }
    }, 1000);
}

function startRoomGame(roomId) {
    let room = activeRooms[roomId];
    if (!room) return;

    room.status = 'playing';
    if (room.timer) clearInterval(room.timer);
    
    let finalPrizePool = calculatePrizePool(room);
    io.to(roomId).emit('gameStarted', { 
        message: 'ጨዋታው ተጀምሯል!',
        prizePool: finalPrizePool,
        status: room.status
    });

    room.gameInterval = setInterval(() => {
        if (room.drawnNumbers.length >= 75) {
            clearInterval(room.gameInterval);
            room.status = 'ended';
            io.to(roomId).emit('gameOver', { message: '75ቱ ቁጥሮች ተጠርተዋል አሸናፊ አልተገኘም።' });
            setTimeout(() => resetRoomForNextGame(roomId), 3000);
            return;
        }

        let rand;
        do {
            rand = Math.floor(Math.random() * 75) + 1;
        } while (room.drawnNumbers.includes(rand));

        room.drawnNumbers.push(rand);
        io.to(roomId).emit('numberDrawn', { number: rand, drawnHistory: room.drawnNumbers });
    }, 3000);
}

io.on('connection', (socket) => {
    socket.on('joinLobby', (data) => {
        const betAmount = data && data.betAmount ? data.betAmount : '20';
        let room = getOrCreateLobby(betAmount);

        socket.join(room.roomId);
        room.players.add(socket.id);

        socket.emit('assignedRoom', { 
            roomId: room.roomId, 
            betAmount: room.betAmount,
            countdown: room.countdown,
            startTime: room.startTime,
            status: room.status,
            selectedBoards: room.selectedBoards,
            activePlayersCount: getActivePlayersCount(room),
            prizePool: calculatePrizePool(room)
        });
    });

    socket.on('startPlayerGame', (data) => {
        const { roomId, boardNumber, name } = data;
        let room = activeRooms[roomId];

        if (room && room.status === 'waiting') {
            if (room.selectedBoards[boardNumber]) {
                return socket.emit('boardSelectError', { message: 'ይህ ቦርድ አስቀድሞ ተይዟል!' });
            }

            room.selectedBoards[boardNumber] = socket.id;
            room.playerNames[socket.id] = name || 'Player';

            let currentPrizePool = calculatePrizePool(room);
            io.to(roomId).emit('boardSelected', { boardNumber, socketId: socket.id });
            io.to(roomId).emit('activePlayersUpdate', { 
                activePlayersCount: getActivePlayersCount(room),
                prizePool: currentPrizePool 
            });

            socket.emit('gameJoinSuccess', { boardNumber, prizePool: currentPrizePool });
        }
    });

    socket.on('claimBingo', async (data) => {
        const { identifier, name, roomId, boardNumber } = data;
        let room = activeRooms[roomId];
        
        if (room && room.status === 'playing') {
            room.status = 'ended';
            if (room.gameInterval) clearInterval(room.gameInterval);

            let finalWinAmount = calculatePrizePool(room);
            try {
                const strIdentifier = String(identifier);
                await pool.query('UPDATE users SET balance = balance + $1 WHERE identifier = $2', [finalWinAmount, strIdentifier]);
                
                io.to(roomId).emit('gameOver', { 
                    subtitle: '1 player has won the game',
                    winnerName: name || 'Winner',
                    boardNumber: boardNumber,
                    winAmount: finalWinAmount
                });

                setTimeout(() => resetRoomForNextGame(roomId), 4000);
            } catch (err) {
                console.error('Bingo claim DB error:', err);
            }
        }
    });

    socket.on('disconnect', () => {
        for (let roomId in activeRooms) {
            let room = activeRooms[roomId];
            if (room.players.has(socket.id)) {
                room.players.delete(socket.id);
                delete room.playerNames[socket.id];
                
                if (room.status === 'waiting') {
                    for (let bNum in room.selectedBoards) {
                        if (room.selectedBoards[bNum] === socket.id) {
                            delete room.selectedBoards[bNum];
                            io.to(roomId).emit('boardReleased', { boardNumber: bNum });
                        }
                    }
                }
            }
        }
    });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, `0.0.0.0`, () => console.log(`Server running on port ${PORT}`));
