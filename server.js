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

const TOKEN = '8957133551:AAGBPCGEzFLtJRXHRU0PfKJ2QXDf1AyvXec';
const ADMIN_CHAT_ID = '686733543';
const WEB_APP_URL = 'https://wana-bingo.onrender.com';

let bot = null;
if (TOKEN) {
    try {
        bot = new TelegramBot(TOKEN, {  
            polling: { interval: 300, autoStart: true, params: { timeout: 10 } } 
        });
        console.log('Telegram Bot started successfully!');
    } catch (err) { console.error('Bot Error:', err); }
}

// --- Database & APIs (እንዳሉ ሆነው) ---
async function initializeDatabase() {
    try {
        await pool.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='transactions' AND column_name='details') THEN ALTER TABLE transactions ADD COLUMN details TEXT; END IF; END $$;`);
    } catch (err) { console.error(err.message); }
}
initializeDatabase();

app.post('/api/get-user', async (req, res) => {
    const { identifier, name, username } = req.body;
    try {
        let userRes = await pool.query('SELECT * FROM users WHERE identifier = $1', [identifier]);
        let user = userRes.rows[0];
        if (!user) {
            const insertRes = await pool.query('INSERT INTO users (identifier, name, username, balance) VALUES ($1, $2, $3, $4) RETURNING *', [identifier, name || 'Player', username || '', 0.00]);
            user = insertRes.rows[0];
        }
        res.json({ success: true, user });
    } catch (err) { res.status(500).json({ success: false }); }
});

app.post('/api/place-bet', async (req, res) => {
    const { identifier, amount } = req.body;
    try {
        const userRes = await pool.query('SELECT balance FROM users WHERE identifier = $1', [identifier]);
        if (!userRes.rows[0]) return res.json({ success: false, message: 'User not found' });
        let balance = parseFloat(userRes.rows[0].balance);
        if (balance < amount) return res.json({ success: false, message: 'በቂ ባላንስ የለዎትም!' });
        await pool.query('UPDATE users SET balance = $1 WHERE identifier = $2', [balance - amount, identifier]);
        res.json({ success: true, newBalance: balance - amount });
    } catch (err) { res.status(500).json({ success: false }); }
});

app.post('/api/request-transaction', async (req, res) => {
    const { identifier, type, amount, details } = req.body;
    const tx_id = 'TX' + Math.floor(100000 + Math.random() * 900000);
    try {
        if (type === 'WITHDRAW') {
            const userRes = await pool.query('SELECT balance FROM users WHERE identifier = $1', [identifier]);
            if (parseFloat(userRes.rows[0].balance) < parseFloat(amount)) return res.json({ success: false, message: 'በቂ ባላንስ የለዎትም!' });
        }
        await pool.query('INSERT INTO transactions (tx_id, identifier, type, amount, details, handled) VALUES ($1, $2, $3, $4, $5, FALSE)', [tx_id, identifier, type, amount, details || 'N/A']);
        
        if (bot && ADMIN_CHAT_ID) {
            const userRes = await pool.query('SELECT name FROM users WHERE identifier = $1', [identifier]);
            let msg = `🔔 ${type}: ${amount} ETB\n👤 ${userRes.rows[0]?.name}\n🆔 ${tx_id}`;
            bot.sendMessage(ADMIN_CHAT_ID, msg, {
                reply_markup: { inline_keyboard: [[{ text: '✅ Approve', callback_data: `approve_${tx_id}_${identifier}_${amount}` }, { text: '❌ Reject', callback_data: `reject_${tx_id}` }]] }
            });
        }
        res.json({ success: true, tx_id });
    } catch (err) { res.status(500).json({ success: false }); }
});

// --- GAME LOGIC: PARALLEL GAMES (MAX 3) ---
let activeRooms = {}; 
let globalGameCounter = 0; 

function getActiveGamesCount() {
    return Object.values(activeRooms).filter(r => r.status === 'waiting' || r.status === 'playing').length;
}

function getActivePlayersCount(room) {
    let count = 0;
    for (let key in room.selectedBoards) { if (room.selectedBoards[key]) count++; }
    return count > 0 ? count : room.players.size;
}

function calculatePrizePool(room) {
    let activeCount = getActivePlayersCount(room);
    return Math.max(parseFloat(room.betAmount), activeCount * parseFloat(room.betAmount) * 0.9);
}

// Generate Bingo Card for Bots
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

// Check Winning Line
function findWinningLine(card, drawnNums) {
    let marked = Array(5).fill(false).map(() => Array(5).fill(false));
    marked[2][2] = true;
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

function createNewLobby(betAmount) {
    globalGameCounter++;
    let gameNumber = ((globalGameCounter - 1) % 3) + 1; // 1, 2, or 3
    
    let uniqueId = Math.floor(1000 + Math.random() * 9000);
    let roomId = `ROOM_${betAmount}_${uniqueId}`;
    
    activeRooms[roomId] = {
        roomId,
        betAmount,
        status: 'waiting', 
        gameNumber: gameNumber,
        currentRound: 1, 
        maxRounds: 3,
        players: new Set(),
        playerNames: {},
        selectedBoards: {}, 
        botCards: {}, // Store bot cards here
        drawnNumbers: [],
        countdown: 30,
        startTime: Date.now() + 30000, // Start counting immediately
        timer: null,
        gameInterval: null
    };
    startGlobalLobbyCountdown(roomId);
    return activeRooms[roomId];
}

function startGlobalLobbyCountdown(roomId) {
    let room = activeRooms[roomId];
    if (!room) return;
    if (room.timer) clearInterval(room.timer);

    room.timer = setInterval(() => {
        if (room.status !== 'waiting') return;
        room.countdown--;

        // Bot Auto-selection & Card Generation
        let targetBots = Math.floor((30 - room.countdown) * 1.5);
        let currentSelected = Object.keys(room.selectedBoards).length;
        
        if (currentSelected < targetBots && currentSelected < 100) {
            let randBoard = Math.floor(Math.random() * 100) + 1;
            if (!room.selectedBoards[randBoard]) {
                let botId = `BOT_${Math.floor(Math.random()*10000)}`;
                room.selectedBoards[randBoard] = botId;
                room.playerNames[botId] = `Kenbo-${Math.floor(10000+Math.random()*90000)}`;
                room.botCards[botId] = generateServerBingoCard(); // Save bot card
                io.to(roomId).emit('boardSelected', { boardNumber: randBoard, socketId: botId });
            }
        }

        io.to(roomId).emit('countdownUpdate', { 
            countdown: room.countdown, 
            startTime: room.startTime,
            activePlayersCount: getActivePlayersCount(room),
            prizePool: calculatePrizePool(room),
            currentRound: room.currentRound,
            maxRounds: room.maxRounds,
            gameNumber: room.gameNumber
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

    room.status = 'playing'; 
    if (room.timer) clearInterval(room.timer);
    
    io.to(roomId).emit('gameStarted', { 
        message: 'ጨዋታው ተጀምሯል!',
        prizePool: calculatePrizePool(room),
        currentRound: room.currentRound,
        maxRounds: room.maxRounds,
        gameNumber: room.gameNumber
    });

    room.gameInterval = setInterval(() => {
        if (room.drawnNumbers.length >= 75) {
            endGame(roomId, null);
            return;
        }
        let rand;
        do { rand = Math.floor(Math.random() * 75) + 1; } while (room.drawnNumbers.includes(rand));
        room.drawnNumbers.push(rand);
        io.to(roomId).emit('numberDrawn', { number: rand, drawnHistory: room.drawnNumbers });

        // === CHECK BOT WINS ===
        for (let botId in room.botCards) {
            let botCard = room.botCards[botId];
            let winningLine = findWinningLine(botCard, room.drawnNumbers);
            if (winningLine) {
                endGame(roomId, {
                    name: room.playerNames[botId],
                    boardNumber: Object.keys(room.selectedBoards).find(key => room.selectedBoards[key] === botId),
                    winAmount: calculatePrizePool(room),
                    winningLine: winningLine
                });
                return;
            }
        }
    }, 3000);
}

function endGame(roomId, winnerData) {
    let room = activeRooms[roomId];
    if (!room) return;

    room.status = 'ended';
    if (room.gameInterval) clearInterval(room.gameInterval);

    io.to(roomId).emit('gameOver', { 
        subtitle: winnerData ? "እንኳን ደስ አለዎት!" : "ጨዋታው አልቋል",
        winnerName: winnerData ? winnerData.name : "No Winner",
        boardNumber: winnerData ? winnerData.boardNumber : "--",
        winAmount: winnerData ? winnerData.winAmount : 0,
        winningLine: winnerData ? winnerData.winningLine : null,
        gameNumber: room.gameNumber
    });

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
        
        if (getActiveGamesCount() >= 3) {
            return socket.emit('lobbyFull', { message: "3 ጫወታዎች እየተጫወቱ ነው። አንዱ እስኪያልቅ እባክዎ ይጠብቁ!" });
        }

        let room = createNewLobby(betAmount);

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
            maxRounds: room.maxRounds,
            gameNumber: room.gameNumber
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
