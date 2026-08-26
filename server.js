const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const TelegramBot = require('node-telegram-bot-api');
const pool = require('./database');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*", methods: ["GET", "POST"] } });

app.use(express.json());
app.use(express.static('public'));

const TOKEN = '8957133551:AAGBPCGEzFLtJRXHRU0PfKJ2QXDf1AyvXec';
const ADMIN_CHAT_ID = '686733543';
const WEB_APP_URL = 'https://wana-bingo.onrender.com';

let bot = null;
if (TOKEN) {
    try {
        bot = new TelegramBot(TOKEN, { polling: { interval: 300, autoStart: true, params: { timeout: 10 } } });
        console.log('Telegram Bot started successfully!');
    } catch (err) { console.error(err); }
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
    } catch (err) { console.error(err.message); }
}
initializeDatabase();

app.post('/api/get-user', async (req, res) => {
    const { identifier, name, username } = req.body;
    try {
        let userRes = await pool.query('SELECT * FROM users WHERE identifier = $1', [identifier]);
        let user;
        if (userRes.rows.length === 0) {
            const insertRes = await pool.query(
                'INSERT INTO users (identifier, name, username, balance) VALUES ($1, $2, $3, $4) RETURNING *',
                [identifier, name || 'አክሊል Player', username || '', 0.00]
            );
            user = insertRes.rows[0];
        } else { user = userRes.rows[0]; }
        res.json({ success: true, user });
    } catch (err) { res.status(500).json({ success: false }); }
});

app.post('/api/update-phone', async (req, res) => {
    const { identifier, phone } = req.body;
    try {
        await pool.query('UPDATE users SET phone = $1 WHERE identifier = $2', [phone, identifier]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false }); }
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
    } catch (err) { res.status(500).json({ success: false }); }
});

app.post('/api/request-transaction', async (req, res) => {
    const { identifier, type, amount, details } = req.body;
    const tx_id = 'TX' + Math.floor(100000 + Math.random() * 900000);
    try {
        if (type === 'WITHDRAW') {
            const userRes = await pool.query('SELECT balance FROM users WHERE identifier = $1', [identifier]);
            let currentBalance = parseFloat(userRes.rows[0].balance);
            if (currentBalance < parseFloat(amount)) return res.json({ success: false, message: 'ብር በቂ አይደለም!' });
            await pool.query('UPDATE users SET balance = $1 WHERE identifier = $2', [currentBalance - parseFloat(amount), identifier]);
        }
        await pool.query('INSERT INTO transactions (tx_id, identifier, type, amount, details, handled) VALUES ($1, $2, $3, $4, $5, FALSE)', [tx_id, identifier, type, amount, details || 'N/A']);
        
        if (bot && ADMIN_CHAT_ID) {
            const userRes = await pool.query('SELECT name, username, phone FROM users WHERE identifier = $1', [identifier]);
            let userInfo = userRes.rows[0] || {};
            let msgText = `🔔 አዲስ የ ${type} ጥያቄ ገብቷል!\n🆔 TxID: ${tx_id}\n👤 ስም: ${userInfo.name}\n💰 መጠን: ${amount} ብር`;
            await bot.sendMessage(ADMIN_CHAT_ID, msgText, {
                reply_markup: {
                    inline_keyboard: [[
                        { text: '✅ Approve', callback_data: `approve_${tx_id}_${identifier}_${amount}_${type}` },
                        { text: '❌ Reject', callback_data: `reject_${tx_id}_${identifier}_${amount}_${type}` }
                    ]]
                }
            });
        }
        res.json({ success: true, tx_id });
    } catch (err) { res.status(500).json({ success: false }); }
});

if (bot) {
    bot.onText(/\/start/, (msg) => {
        bot.sendMessage(msg.chat.id, `✨ **እንኳን ደህና መጡ ወደ Wana Bingo (አክሊል & ሀሴት)** ✨`, {
            reply_markup: { inline_keyboard: [[{ text: '🚀 Play Bingo 🎮', web_app: { url: WEB_APP_URL } }]] }
        });
    });
}

let activeRooms = {}; 

function getActivePlayersCount(room) {
    let activeSocketIds = new Set();
    for (let bNum in room.selectedBoards) if (room.selectedBoards[bNum]) activeSocketIds.add(room.selectedBoards[bNum]);
    for (let socketId of room.players) activeSocketIds.add(socketId);
    return activeSocketIds.size;
}

function calculatePrizePool(room) {
    let activeCount = getActivePlayersCount(room);
    let totalBet = activeCount * parseFloat(room.betAmount);
    return Math.floor(totalBet * 0.90 > 0 ? totalBet * 0.90 : parseFloat(room.betAmount));
}

function getOrCreateLobby(betAmount) {
    let roomId = null;
    for (let id in activeRooms) if (activeRooms[id].betAmount === betAmount) { roomId = id; break; }
    if (!roomId) {
        roomId = `ROOM_${betAmount}_${Math.floor(1000 + Math.random() * 9000)}`;
        activeRooms[roomId] = {
            roomId, betAmount, status: 'waiting', players: new Set(), playerNames: {},
            reservedNumbers: {}, selectedBoards: {}, tempSelections: {}, drawnNumbers: [],
            countdown: 30, startTime: Date.now() + 30000, timer: null, gameInterval: null
        };
        startGlobalLobbyCountdown(roomId);
    }
    return activeRooms[roomId];
}

function resetRoomForNextGame(roomId) {
    let room = activeRooms[roomId];
    if (!room) return;
    room.drawnNumbers = []; room.reservedNumbers = {}; room.selectedBoards = {}; room.tempSelections = {};
    room.status = 'waiting'; room.countdown = 30; room.startTime = Date.now() + 30000;
    io.to(roomId).emit('roomResetForNextRound', { status: room.status, countdown: room.countdown, startTime: room.startTime, selectedBoards: room.selectedBoards });
    startGlobalLobbyCountdown(roomId);
}

function startGlobalLobbyCountdown(roomId) {
    let room = activeRooms[roomId];
    if (!room) return;
    if (room.timer) clearInterval(room.timer);
    room.timer = setInterval(() => {
        if (room.status !== 'waiting') return;
        room.countdown--;
        if (Object.keys(room.selectedBoards).length < 3 && room.countdown > 5) {
            let randB = Math.floor(Math.random() * 100) + 1;
            if (!room.selectedBoards[randB]) {
                let botId = `BOT_${Math.floor(Math.random() * 10000)}`;
                room.selectedBoards[randB] = botId;
                room.playerNames[botId] = `ሀሴት-${Math.floor(1000 + Math.random()*9000)}`;
                io.to(roomId).emit('boardSelected', { boardNumber: randB, socketId: botId });
            }
        }
        io.to(roomId).emit('countdownUpdate', { countdown: room.countdown, status: room.status, activePlayersCount: getActivePlayersCount(room), prizePool: calculatePrizePool(room), startTime: room.startTime });
        if (room.countdown <= 0) startRoomGame(roomId);
    }, 1000);
}

function findWinningLine(card, drawnNums) {
    let marked = Array(5).fill(false).map(() => Array(5).fill(false));
    marked[2][2] = true;
    for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) if (card[r][c] === '*' || drawnNums.includes(card[r][c])) marked[r][c] = true;
    for(let r=0; r<5; r++) if([0,1,2,3,4].every(c => marked[r][c])) return { type: 'row', index: r };
    for(let c=0; c<5; c++) if([0,1,2,3,4].every(r => marked[r][c])) return { type: 'col', index: c };
    if([0,1,2,3,4].every(i => marked[i][i])) return { type: 'diag1', index: 0 };
    if([0,1,2,3,4].every(i => marked[i][4-i])) return { type: 'diag2', index: 0 };
    return null;
}

function generateServerBingoCard() {
    let ranges = [[1,15], [16,30], [31,45], [46,60], [61,75]];
    let cols = [];
    for(let c = 0; c < 5; c++) {
        let col = [], min = ranges[c][0], max = ranges[c][1];
        while(col.length < 5) { let rand = Math.floor(Math.random() * (max - min + 1)) + min; if(!col.includes(rand)) col.push(rand); }
        cols.push(col);
    }
    let card = [];
    for(let r = 0; r < 5; r++) {
        let row = [], c = 0;
        while(c < 5) { row.push(r === 2 && c === 2 ? "*" : cols[c][r]); c++; }
        card.push(row);
    }
    return card;
}

function startRoomGame(roomId) {
    let room = activeRooms[roomId];
    if (!room) return;
    room.status = 'playing';
    if (room.timer) clearInterval(room.timer);
    io.to(roomId).emit('gameStarted', { message: 'ጨዋታው ተጀምሯል!', prizePool: calculatePrizePool(room) });

    let roomBotCards = {};
    for (let bNum in room.selectedBoards) {
        let ownerId = room.selectedBoards[bNum];
        if (ownerId && ownerId.startsWith('BOT_')) roomBotCards[ownerId] = { boardNumber: bNum, card: generateServerBingoCard() };
    }

    room.gameInterval = setInterval(() => {
        if (room.drawnNumbers.length >= 75) {
            clearInterval(room.gameInterval);
            resetRoomForNextGame(roomId);
            return;
        }
        let rand;
        do { rand = Math.floor(Math.random() * 75) + 1; } while (room.drawnNumbers.includes(rand));
        room.drawnNumbers.push(rand);
        io.to(roomId).emit('numberDrawn', { number: rand, drawnHistory: room.drawnNumbers });

        for (let botId in roomBotCards) {
            let botData = roomBotCards[botId];
            if (findWinningLine(botData.card, room.drawnNumbers)) {
                clearInterval(room.gameInterval);
                room.status = 'ended';
                io.to(roomId).emit('gameOver', { subtitle: 'አሸናፊ ተገኝቷል!', winnerName: room.playerNames[botId] || "እድል-Bot", boardNumber: botData.boardNumber, winAmount: calculatePrizePool(room) });
                setTimeout(() => resetRoomForNextGame(roomId), 3000);
                return;
            }
        }
    }, 3000);
}

io.on('connection', (socket) => {
    socket.on('joinLobby', (data) => {
        let room = getOrCreateLobby(data?.betAmount || '20');
        socket.join(room.roomId);
        room.players.add(socket.id);
        socket.emit('assignedRoom', { roomId: room.roomId, betAmount: room.betAmount, countdown: room.countdown, startTime: room.startTime, status: room.status, selectedBoards: room.selectedBoards, activePlayersCount: getActivePlayersCount(room) });
    });

    socket.on('selectBoardTemp', (data) => {
        let room = activeRooms[data.roomId];
        if (room && room.status === 'waiting' && !room.selectedBoards[data.boardNumber]) socket.emit('boardTempSelected', { boardNumber: data.boardNumber });
    });

    socket.on('startPlayerGame', (data) => {
        let room = activeRooms[data.roomId];
        if (room && room.status === 'waiting' && !room.selectedBoards[data.boardNumber]) {
            room.selectedBoards[data.boardNumber] = socket.id;
            room.playerNames[socket.id] = data.name || 'ተጫዋች';
            io.to(data.roomId).emit('boardSelected', { boardNumber: data.boardNumber, socketId: socket.id });
            socket.emit('gameJoinSuccess', { boardNumber: data.boardNumber });
        }
    });

    socket.on('claimBingo', async (data) => {
        let room = activeRooms[data.roomId];
        if (room && room.status === 'playing') {
            room.status = 'ended';
            if (room.gameInterval) clearInterval(room.gameInterval);
            let finalWin = calculatePrizePool(room) || data.winAmount;
            let userRes = await pool.query('SELECT balance FROM users WHERE identifier = $1', [data.identifier]);
            if (userRes.rows.length > 0) {
                await pool.query('UPDATE users SET balance = $1 WHERE identifier = $2', [parseFloat(userRes.rows[0].balance) + parseFloat(finalWin), data.identifier]);
                io.to(data.roomId).emit('gameOver', { subtitle: 'አሸናፊ ተገኝቷል!', winnerName: data.name, boardNumber: data.boardNumber, winAmount: finalWin, winningLine: data.winningLine });
                setTimeout(() => resetRoomForNextGame(data.roomId), 3000);
            }
        }
    });

    socket.on('disconnect', () => {
        for (let roomId in activeRooms) {
            let room = activeRooms[roomId];
            if (room.players.has(socket.id)) {
                room.players.delete(socket.id);
                for (let bNum in room.selectedBoards) if (room.selectedBoards[bNum] === socket.id) { delete room.selectedBoards[bNum]; io.to(roomId).emit('boardReleased', { boardNumber: bNum }); }
            }
        }
    });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));
