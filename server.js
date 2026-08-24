const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const TelegramBot = require('node-telegram-bot-api');
const pool = require('./database');

const app = express();
const server = http.createServer(app);

// === 'io' በትክክል ተገልጿል ===
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

app.use(express.json());
app.use(express.static('public'));

// --- የቦት እና አድሚን መረጃዎች ---
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
                params: { timeout: 10 }
            } 
        });
        console.log('Telegram Bot started successfully!');
        bot.on('polling_error', (error) => {
            console.log(`Telegram Polling Error: ${error.code} - ${error.message}`);
        });
    } catch (err) {
        console.error('Telegram Bot initialization error:', err);
    }
}

// --- Database Initialization ---
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
        console.error('DB Init Warning:', err.message);
    }
}
initializeDatabase();

// --- REST APIs (እንዳሉ ሆነው) ---
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
            if (currentBalance < parseFloat(amount)) return res.json({ success: false, message: 'በቂ ባላንስ የለዎትም!' });
        }

        await pool.query(
            'INSERT INTO transactions (tx_id, identifier, type, amount, details, handled) VALUES ($1, $2, $3, $4, $5, FALSE)',
            [tx_id, identifier, type, amount, details || 'N/A']
        );

        if (bot && ADMIN_CHAT_ID) {
            try {
                const userRes = await pool.query('SELECT name, username, phone FROM users WHERE identifier = $1', [identifier]);
                let userInfo = userRes.rows[0] || {};
                let msgText = `🔔 አዲስ የ ${type} ጥያቄ!\n🆔 TxID: ${tx_id}\n👤 ስም: ${userInfo.name}\n💰 መጠን: ${amount} ብር`;
                await bot.sendMessage(ADMIN_CHAT_ID, msgText, {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '✅ Approve', callback_data: `approve_${tx_id}_${identifier}_${amount}` },
                             { text: '❌ Reject', callback_data: `reject_${tx_id}` }]
                        ]
                    }
                });
            } catch (e) { console.error(e); }
        }
        res.json({ success: true, tx_id });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// --- Telegram Bot Commands (እንዳሉ ሆነው) ---
if (bot) {
    bot.setMyCommands([
        { command: 'start', description: 'Start' },
        { command: 'play', description: 'Play Bingo' },
        { command: 'balance', description: 'Check Balance' }
    ]);

    bot.onText(/\/start/, (msg) => {
        bot.sendMessage(msg.chat.id, `Welcome to Wana Bingo!`, {
            reply_markup: {
                inline_keyboard: [[{ text: '🎮 Play Now', web_app: { url: WEB_APP_URL } }]]
            }
        });
    });
    
    // ... (ሌሎች ትዕዛዞች እንዳሉ ይቀጥሉ) ...
    
    bot.on('callback_query', async (query) => {
        const data = query.data;
        const parts = data.split('_');
        const action = parts[0];
        const tx_id = parts[1];
        // ... (Approval logic እንዳሉ ይቀጥሉ) ...
        bot.answerCallbackQuery(query.id, { text: 'Processed' });
    });
}

// --- GAME LOGIC: PARALLEL GAMES (MAX 3) ---
let activeRooms = {}; 

// 1. እየተጫወቱ ያሉ ጫወታዎችን ቁጥር (Waiting + Playing)
function getActiveGamesCount() {
    return Object.values(activeRooms).filter(r => r.status === 'waiting' || r.status === 'playing').length;
}

function getActivePlayersCount(room) {
    let count = 0;
    for (let key in room.selectedBoards) {
        if (room.selectedBoards[key]) count++;
    }
    return count > 0 ? count : room.players.size;
}

function calculatePrizePool(room) {
    let activeCount = getActivePlayersCount(room);
    return Math.max(parseFloat(room.betAmount), activeCount * parseFloat(room.betAmount) * 0.9);
}

// 2. አዲስ ክፍል መፍጠር ወይም ክፍት ክፍል መፈለግ
function getOrCreateLobby(betAmount) {
    let roomId = null;
    // እየጠበቀ (Waiting) ላለ ክፍል ብቻ ነው የምንፈልገው
    for (let id in activeRooms) {
        if (activeRooms[id].betAmount === betAmount && activeRooms[id].status === 'waiting') {
            roomId = id;
            break;
        }
    }

    if (!roomId) {
        // አዲስ ክፍል እንፍጠር
        let uniqueId = Math.floor(1000 + Math.random() * 9000);
        roomId = `ROOM_${betAmount}_${uniqueId}`;
        
        activeRooms[roomId] = {
            roomId,
            betAmount,
            status: 'waiting', 
            currentRound: 1, 
            maxRounds: 3,
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

function startGlobalLobbyCountdown(roomId) {
    let room = activeRooms[roomId];
    if (!room) return;
    if (room.timer) clearInterval(room.timer);

    room.timer = setInterval(() => {
        if (room.status !== 'waiting') return;
        room.countdown--;

        // Bot Auto-selection
        let targetBots = Math.floor((30 - room.countdown) * 1.5);
        let currentSelected = Object.keys(room.selectedBoards).length;
        if (currentSelected < targetBots && currentSelected < 100) {
            let randBoard = Math.floor(Math.random() * 100) + 1;
            if (!room.selectedBoards[randBoard]) {
                let botId = `BOT_${Math.floor(Math.random()*10000)}`;
                room.selectedBoards[randBoard] = botId;
                room.playerNames[botId] = `Kenbo-${Math.floor(10000+Math.random()*90000)}`;
                io.to(roomId).emit('boardSelected', { boardNumber: randBoard, socketId: botId });
            }
        }

        io.to(roomId).emit('countdownUpdate', { 
            countdown: room.countdown, 
            startTime: room.startTime,
            activePlayersCount: getActivePlayersCount(room),
            prizePool: calculatePrizePool(room),
            currentRound: room.currentRound,
            maxRounds: room.maxRounds
        });

        if (room.countdown <= 0) {
            if (getActivePlayersCount(room) >= 1) {
                startRoomGame(roomId);
            } else {
                room.countdown = 30;
                room.startTime = Date.now() + 30000;
            }
        }
    }, 1000);
}

function startRoomGame(roomId) {
    let room = activeRooms[roomId];
    if (!room) return;

    room.status = 'playing'; // === ይህ መስመር አዲስ መግባትን ይከለክላል ===
    if (room.timer) clearInterval(room.timer);
    
    io.to(roomId).emit('gameStarted', { 
        message: 'ጨዋታው ተጀምሯል!',
        prizePool: calculatePrizePool(room),
        currentRound: room.currentRound,
        maxRounds: room.maxRounds
    });

    // Game Loop
    room.gameInterval = setInterval(() => {
        if (room.drawnNumbers.length >= 75) {
            endGame(roomId, null);
            return;
        }
        let rand;
        do { rand = Math.floor(Math.random() * 75) + 1; } while (room.drawnNumbers.includes(rand));
        room.drawnNumbers.push(rand);
        io.to(roomId).emit('numberDrawn', { number: rand, drawnHistory: room.drawnNumbers });
        
        // Check Bot Wins (Simplified)
        // ... (Bot win check logic here if needed) ...
    }, 3000);
}

function endGame(roomId, winnerData) {
    let room = activeRooms[roomId];
    if (!room) return;

    room.status = 'ended';
    if (room.gameInterval) clearInterval(room.gameInterval);

    // === ውጤቱ ለዚህ ክፍል ብቻ ይላካል (Isolated Win) ===
    io.to(roomId).emit('gameOver', { 
        subtitle: winnerData ? "እንኳን ደስ አለዎት!" : "ጨዋታው አልቋል",
        winnerName: winnerData ? winnerData.name : "No Winner",
        boardNumber: winnerData ? winnerData.boardNumber : "--",
        winAmount: winnerData ? winnerData.winAmount : 0,
        winningLine: winnerData ? winnerData.winningLine : null
    });

    // ከ 5 ሴኮንድ በኋላ ክፍሉን ያጥፉ (ቦታ ለአዲስ ጫወታ ይከፍታል)
    setTimeout(() => {
        delete activeRooms[roomId];
        console.log(`Room ${roomId} closed. Active games: ${getActiveGamesCount()}`);
    }, 5000);
}

// --- SOCKET.IO CONNECTIONS ---
io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('joinLobby', (data) => {
        const betAmount = data && data.betAmount ? data.betAmount : '20';
        
        // === 1. MAX 3 GAMES CHECK ===
        if (getActiveGamesCount() >= 3) {
            return socket.emit('lobbyFull', { message: "3 ጫወታዎች እየተጫወቱ ነው። አንዱ እስኪያልቅ እባክዎ ይጠብቁ!" });
        }

        let room = getOrCreateLobby(betAmount);

        // === 2. LATE JOIN PREVENTION ===
        if (room.status === 'playing' || room.status === 'ended') {
            return socket.emit('gameAlreadyStarted', { message: 'ጨዋታው ኦሬዲ ጀምሯል! እባክዎ ቀጣዩን ጨዋታ ይጠብቁ።' });
        }

        socket.join(room.roomId);
        room.players.add(socket.id);
        socket.currentRoomId = room.roomId;

        socket.emit('assignedRoom', { 
            roomId: room.roomId, 
            betAmount: room.betAmount,
            countdown: room.countdown,
            startTime: room.startTime,
            selectedBoards: room.selectedBoards,
            activePlayersCount: getActivePlayersCount(room),
            prizePool: calculatePrizePool(room),
            currentRound: room.currentRound,
            maxRounds: room.maxRounds
        });
        
        io.to(room.roomId).emit('playersUpdate', { 
            activePlayersCount: getActivePlayersCount(room),
            prizePool: calculatePrizePool(room)
        });
    });

    socket.on('selectBoardTemp', (data) => {
        const { roomId, boardNumber } = data;
        let room = activeRooms[roomId];
        if (room && room.status === 'waiting') {
            if (room.selectedBoards[boardNumber]) {
                return socket.emit('boardSelectError', { message: 'ይህ ቦርድ ተይዟል!' });
            }
            socket.emit('boardTempSelected', { boardNumber });
        }
    });

    socket.on('startPlayerGame', (data) => {
        const { roomId, boardNumber, name } = data;
        let room = activeRooms[roomId];
        if (room && room.status === 'waiting') {
            if (room.selectedBoards[boardNumber]) {
                return socket.emit('boardSelectError', { message: 'ይህ ቦርድ ተይዟል!' });
            }
            room.selectedBoards[boardNumber] = socket.id;
            room.playerNames[socket.id] = name || 'Player';
            
            io.to(roomId).emit('boardSelected', { boardNumber, socketId: socket.id });
            socket.emit('gameJoinSuccess', { boardNumber, prizePool: calculatePrizePool(room) });
        } else {
            socket.emit('gameAlreadyStarted', { message: 'ጨዋታው ኦሬዲ ጀምሯል!' });
        }
    });

    socket.on('claimBingo', async (data) => {
        const { identifier, name, winAmount, roomId, boardNumber, winningLine } = data;
        let room = activeRooms[roomId];
        
        if (room && room.status === 'playing') {
            // Validate Win (Simplified)
            let finalWinAmount = calculatePrizePool(room);
            
            try {
                const userRes = await pool.query('SELECT balance FROM users WHERE identifier = $1', [identifier]);
                if (userRes.rows.length > 0) {
                    let newBal = parseFloat(userRes.rows[0].balance) + parseFloat(finalWinAmount);
                    await pool.query('UPDATE users SET balance = $1 WHERE identifier = $2', [newBal, identifier]);
                    
                    endGame(roomId, {
                        name: name,
                        boardNumber: boardNumber,
                        winAmount: finalWinAmount,
                        winningLine: winningLine
                    });
                }
            } catch (err) { console.error(err); }
        }
    });

    socket.on('disconnect', () => {
        for (let roomId in activeRooms) {
            let room = activeRooms[roomId];
            if (room.players.has(socket.id)) {
                room.players.delete(socket.id);
                delete room.playerNames[socket.id];
                // Remove board if waiting
                if (room.status === 'waiting') {
                    for (let bNum in room.selectedBoards) {
                        if (room.selectedBoards[bNum] === socket.id) {
                            delete room.selectedBoards[bNum];
                            io.to(roomId).emit('boardReleased', { boardNumber: bNum });
                        }
                    }
                }
                io.to(roomId).emit('playersUpdate', { 
                    activePlayersCount: getActivePlayersCount(room),
                    prizePool: calculatePrizePool(room)
                });
            }
        }
    });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, `0.0.0.0`, () => {
    console.log(`Server running on port ${PORT}`);
});
