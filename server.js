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
        bot.on('polling_error', (error) => console.log(`Telegram Polling Error: ${error.code} - ${error.message}`));
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
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='phone') THEN
                    ALTER TABLE users ADD COLUMN phone TEXT;
                END IF;
            END $$;
        `);
        console.log('Database tables checked and updated.');
    } catch (err) {
        console.error('Database initialization warning:', err.message);
    }
}
initializeDatabase();

// ==========================================
// 🔹 API ENDPOINTS
// ==========================================

app.get('/api/admin/users', async (req, res) => {
    try {
        const usersRes = await pool.query(`SELECT id, identifier, name, username, phone, balance, created_at FROM users ORDER BY id DESC`);
        res.json({ success: true, totalUsers: usersRes.rows.length, users: usersRes.rows });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Server Error' });
    }
});

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

app.post('/api/update-phone', async (req, res) => {
    const { identifier, phone } = req.body;
    try {
        await pool.query('UPDATE users SET phone = $1 WHERE identifier = $2', [phone, identifier]);
        if (bot && ADMIN_CHAT_ID) {
            try {
                const userRes = await pool.query('SELECT name, username FROM users WHERE identifier = $1', [identifier]);
                let userInfo = userRes.rows[0] || {};
                let msgText = `📱 **አዲስ ስልክ ቁጥር ተመዝግቧል!**\n👤 ስም: ${userInfo.name || 'Unknown'} (@${userInfo.username || 'none'})\n🆔 Telegram ID: \`${identifier}\`\n📞 ስልክ ቁጥር: \`${phone}\``;
                await bot.sendMessage(ADMIN_CHAT_ID, msgText, { parse_mode: 'Markdown' });
            } catch (e) {}
        }
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
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.post('/api/request-transaction', async (req, res) => {
    const { identifier, type, amount, details } = req.body;
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

        await pool.query(
            'INSERT INTO transactions (tx_id, identifier, type, amount, details, handled) VALUES ($1, $2, $3, $4, $5, FALSE)',
            [tx_id, identifier, type, amount, details || 'N/A']
        );

        if (bot && ADMIN_CHAT_ID) {
            try {
                const userRes = await pool.query('SELECT name, username, phone FROM users WHERE identifier = $1', [identifier]);
                let userInfo = userRes.rows[0] || {};
                let msgText = `🔔 አዲስ የ ${type} ጥያቄ ገብቷል!\n🆔 TxID: ${tx_id}\n👤 ስም: ${userInfo.name || 'Unknown'} (@${userInfo.username || 'none'})\n📱 ስልክ: ${userInfo.phone || 'N/A'}\n💰 መጠን: ${amount} ብር\n🏦 ባንክ/መረጃ: ${details || 'N/A'}`;

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
            } catch (notifyErr) {}
        }
        res.json({ success: true, tx_id });
    } catch (err) {
        res.status(500).json({ success: false, message: 'ሰርቨር ላይ ስህተት ተፈጥሯል' });
    }
});

// Telegram Bot event logic remains attached...
if (bot) {
    bot.setMyCommands([
        { command: 'start', description: 'ቦቱን ለመጀመር' },
        { command: 'play', description: '🎮 Play Bingo' },
        { command: 'balance', description: '💰 ቀሪ ሂሳብ' },
        { command: 'deposit', description: '💳 ዲፖዚት' },
        { command: 'withdraw', description: '💸 ገንዘብ ወጪ' },
        { command: 'cancel', description: '❌ ሰርዝ' }
    ]);
    // [Bot Handlers standard implementations...]
}

// ==========================================
// 🎲 GAME ENGINE & SOCKET.IO IMPLEMENTATION
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
    let activeCount = Object.keys(room.selectedBoards).length;
    let totalBet = activeCount * parseFloat(room.betAmount);
    let prizePool = totalBet * 0.90;
    return Math.floor(prizePool > 0 ? prizePool : parseFloat(room.betAmount));
}

function generateServerBingoCard() {
    let ranges = [[1,15], [16,30], [31,45], [46,60], [61,75]];
    let cols = [];
    for(let c = 0; c < 5; c++) {
        let col = [];
        let min = ranges[c][0], max = ranges[c][1];
        while(col.length < 5) {
            let rand = Math.floor(Math.random() * (max - min + 1)) + min;
            if(!col.includes(rand)) col.push(rand);
        }
        cols.push(col);
    }
    let card = [];
    for(let r = 0; r < 5; r++) {
        let row = [];
        for(let c = 0; c < 5; c++) {
            row.push(r === 2 && c === 2 ? "*" : cols[c][r]);
        }
        card.push(row);
    }
    return card;
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
        
        let boardCards = {};
        for(let i = 1; i <= 100; i++) {
            boardCards[i] = generateServerBingoCard();
        }

        activeRooms[roomId] = {
            roomId,
            betAmount,
            status: 'waiting', 
            players: new Set(),
            playerNames: {},
            selectedBoards: {}, 
            boardCards: boardCards,
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
    
    for(let i = 1; i <= 100; i++) {
        room.boardCards[i] = generateServerBingoCard();
    }

    io.to(roomId).emit('roomResetForNextRound', {
        status: room.status,
        countdown: room.countdown,
        startTime: room.startTime,
        selectedBoards: room.selectedBoards,
        boardCards: room.boardCards
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

        let totalPossibleBoards = 100;
        let targetBotSelections = Math.floor((30 - room.countdown) * 1.2); 
        let currentSelectedCount = Object.keys(room.selectedBoards).length;

        if (currentSelectedCount < targetBotSelections && currentSelectedCount < totalPossibleBoards) {
            let randomBoard, attempts = 0;
            do {
                randomBoard = Math.floor(Math.random() * totalPossibleBoards) + 1;
                attempts++;
            } while (room.selectedBoards[randomBoard] && attempts < 20);

            if (!room.selectedBoards[randomBoard]) {
                let botId = `BOT_${Math.floor(Math.random() * 10000)}`;
                room.selectedBoards[randomBoard] = botId;
                room.playerNames[botId] = `Kenbo-${Math.floor(10000 + Math.random()*90000)}`;
                io.to(roomId).emit('boardSelected', { boardNumber: randomBoard, socketId: botId });
            }
        }

        io.to(roomId).emit('countdownUpdate', { 
            countdown: room.countdown, 
            status: room.status,
            activePlayersCount: Object.keys(room.selectedBoards).length,
            prizePool: calculatePrizePool(room),
            startTime: room.startTime
        });

        if (room.countdown <= 0) {
            if (Object.keys(room.selectedBoards).length < 1) {
                room.countdown = 30;
                room.startTime = Date.now() + 30000;
            } else {
                startRoomGame(roomId);
            }
        }
    }, 1000);
}

function findWinningLine(card, drawnNums) {
    let marked = Array(5).fill(false).map(() => Array(5).fill(false));
    for (let r = 0; r < 5; r++) {
        for (let c = 0; c < 5; c++) {
            let val = card[r][c];
            if (val === '*' || drawnNums.includes(val)) marked[r][c] = true;
        }
    }
    for(let r=0; r<5; r++) if([0,1,2,3,4].every(c => marked[r][c])) return { type: 'row', index: r };
    for(let c=0; c<5; c++) if([0,1,2,3,4].every(r => marked[r][c])) return { type: 'col', index: c };
    if([0,1,2,3,4].every(i => marked[i][i])) return { type: 'diag1', index: 0 };
    if([0,1,2,3,4].every(i => marked[i][4-i])) return { type: 'diag2', index: 0 };
    return null;
}

function startRoomGame(roomId) {
    let room = activeRooms[roomId];
    if (!room) return;

    room.status = 'playing';
    if (room.timer) clearInterval(room.timer);
    
    let finalPrizePool = calculatePrizePool(room);
    io.to(roomId).emit('gameStarted', { prizePool: finalPrizePool, status: room.status });

    room.gameInterval = setInterval(() => {
        if (room.drawnNumbers.length >= 75) {
            clearInterval(room.gameInterval);
            room.status = 'ended';
            io.to(roomId).emit('gameOver', { message: 'ጨዋታው አልቋል! አሸናፊ አልተገኘም።' });
            setTimeout(() => resetRoomForNextGame(roomId), 4000);
            return;
        }

        let rand;
        do { rand = Math.floor(Math.random() * 75) + 1; } while (room.drawnNumbers.includes(rand));
        room.drawnNumbers.push(rand);

        io.to(roomId).emit('numberDrawn', { number: rand, drawnHistory: room.drawnNumbers });

        // Bot аሸናፊነት ማረጋገጫ
        for (let bNum in room.selectedBoards) {
            let ownerId = room.selectedBoards[bNum];
            if (ownerId && ownerId.startsWith('BOT_')) {
                let card = room.boardCards[bNum];
                let winningLine = findWinningLine(card, room.drawnNumbers);
                if (winningLine) {
                    clearInterval(room.gameInterval);
                    room.status = 'ended';
                    io.to(roomId).emit('gameOver', { 
                        subtitle: '1 player has won the game',
                        winnerName: room.playerNames[ownerId] || "Kenbo-Bot",
                        boardNumber: bNum,
                        winAmount: finalPrizePool,
                        winningLine: winningLine
                    });
                    setTimeout(() => resetRoomForNextGame(roomId), 4000);
                    return;
                }
            }
        }
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
            boardCards: room.boardCards,
            prizePool: calculatePrizePool(room)
        });
    });

    socket.on('startPlayerGame', (data) => {
        const { roomId, boardNumber, name } = data;
        let room = activeRooms[roomId];
        if (room && room.status === 'waiting') {
            if (!room.selectedBoards[boardNumber]) {
                room.selectedBoards[boardNumber] = socket.id;
                room.playerNames[socket.id] = name || 'Player';
                let prize = calculatePrizePool(room);
                io.to(roomId).emit('boardSelected', { boardNumber, socketId: socket.id });
                io.to(roomId).emit('activePlayersUpdate', { activePlayersCount: Object.keys(room.selectedBoards).length, prizePool: prize });
                socket.emit('gameJoinSuccess', { boardNumber, prizePool: prize });
            }
        }
    });

    socket.on('claimBingo', async (data) => {
        const { identifier, name, roomId, boardNumber } = data;
        let room = activeRooms[roomId];
        
        if (room && room.status === 'playing' && room.selectedBoards[boardNumber] === socket.id) {
            let card = room.boardCards[boardNumber];
            let winningLine = findWinningLine(card, room.drawnNumbers);

            if (winningLine) {
                room.status = 'ended';
                if (room.gameInterval) clearInterval(room.gameInterval);
                let finalWinAmount = calculatePrizePool(room);

                try {
                    const userRes = await pool.query('SELECT balance FROM users WHERE identifier = $1', [identifier]);
                    if (userRes.rows.length > 0) {
                        let newBal = parseFloat(userRes.rows[0].balance) + parseFloat(finalWinAmount);
                        await pool.query('UPDATE users SET balance = $1 WHERE identifier = $2', [newBal, identifier]);
                    }
                } catch (e) {}

                io.to(roomId).emit('gameOver', { 
                    subtitle: '1 player has won the game',
                    winnerName: name || room.playerNames[socket.id] || 'Winner',
                    boardNumber: boardNumber,
                    winAmount: finalWinAmount,
                    winningLine: winningLine
                });

                setTimeout(() => resetRoomForNextGame(roomId), 4000);
            } else {
                socket.emit('boardSelectError', { message: 'ቢንጎ አልሞላም! እባክዎ በትክክል ያረጋግጡ።' });
            }
        }
    });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, `0.0.0.0`, () => console.log(`Server running on port ${PORT}`));
