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

let bot = null;
if (TOKEN) {
    try {
        bot = new TelegramBot(TOKEN, { polling: { interval: 300, autoStart: true, params: { timeout: 10 } } });
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
        console.error('Database init warning:', err.message);
    }
}
initializeDatabase();

// REST APIs
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
            if (currentBalance < parseFloat(amount)) return res.json({ success: false, message: 'በዋሌትዎ ውስጥ ያለው ብር በቂ አይደለም!' });
        }

        await pool.query(
            'INSERT INTO transactions (tx_id, identifier, type, amount, details, handled) VALUES ($1, $2, $3, $4, $5, FALSE)',
            [tx_id, identifier, type, amount, details || 'N/A']
        );

        if (bot && ADMIN_CHAT_ID) {
            const userRes = await pool.query('SELECT name, username, phone FROM users WHERE identifier = $1', [identifier]);
            let userInfo = userRes.rows[0] || {};
            let msgText = `🔔 አዲስ የ ${type} ጥያቄ ገብቷል!\n🆔 TxID: ${tx_id}\n👤 ስም: ${userInfo.name || 'Unknown'} (@${userInfo.username || 'none'})\n📱 ስልክ: ${userInfo.phone || 'N/A'}\n💰 መጠን: ${amount} ብር\n🏦 ባንክ/አካውንት: ${details || 'N/A'}`;
            await bot.sendMessage(ADMIN_CHAT_ID, msgText, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [[
                        { text: '✅ አረጋግጥ', callback_data: `approve_${tx_id}_${identifier}_${amount}` },
                        { text: '❌ ሰርዝ', callback_data: `reject_${tx_id}` }
                    ]]
                }
            });
        }
        res.json({ success: true, tx_id });
    } catch (err) {
        res.status(500).json({ success: false, message: 'ሰርቨር ላይ ስህተት ተፈጥሯል' });
    }
});

// Single Game Room Management
let activeRooms = {}; 

function getActivePlayersCount(room) {
    let activeSocketIds = new Set();
    for (let bNum in room.selectedBoards) {
        if (room.selectedBoards[bNum]) activeSocketIds.add(room.selectedBoards[bNum]);
    }
    for (let socketId of room.players) {
        activeSocketIds.add(socketId);
    }
    return activeSocketIds.size;
}

function calculatePrizePool(room) {
    let activeCount = getActivePlayersCount(room);
    let totalBet = activeCount * parseFloat(room.betAmount);
    let prizePool = totalBet * 0.90; // 10% Commission
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
            tempSelections: {},  
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

        let totalPossibleBoards = 100;
        let targetBotSelections = Math.floor((30 - room.countdown) * 1.5); 
        let currentSelectedCount = Object.keys(room.selectedBoards).length;

        if (currentSelectedCount < targetBotSelections && currentSelectedCount < totalPossibleBoards) {
            let randomBoard;
            let attempts = 0;
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

        let currentPrizePool = calculatePrizePool(room);

        io.to(roomId).emit('countdownUpdate', { 
            countdown: room.countdown, 
            playersCount: room.players.size,
            activePlayersCount: getActivePlayersCount(room),
            prizePool: currentPrizePool,
            startTime: room.startTime
        });

        if (room.countdown <= 0) {
            let selectedBoardsCount = Object.keys(room.selectedBoards).length;
            if (room.players.size < 1 || selectedBoardsCount < 1) {
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
    marked[2][2] = true;

    for (let r = 0; r < 5; r++) {
        for (let c = 0; c < 5; c++) {
            let val = card[r][c];
            if (val === '*' || drawnNums.includes(val)) {
                marked[r][c] = true;
            }
        }
    }

    for(let r=0; r<5; r++) { if([0,1,2,3,4].every(c => marked[r][c])) return { type: 'row', index: r }; }
    for(let c=0; c<5; c++) { if([0,1,2,3,4].every(r => marked[r][c])) return { type: 'col', index: c }; }
    if([0,1,2,3,4].every(i => marked[i][i])) return { type: 'diag1', index: 0 };
    if([0,1,2,3,4].every(i => marked[i][4-i])) return { type: 'diag2', index: 0 };
    return null;
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
        let c = 0;
        while(c < 5) {
            row.push(r === 2 && c === 2 ? "*" : cols[c][r]);
            c++;
        }
        card.push(row);
    }
    return card;
}

function startRoomGame(roomId) {
    let room = activeRooms[roomId];
    if (!room) return;

    room.status = 'playing'; // LOCK ROOM LOCK SELECTION
    if (room.timer) clearInterval(room.timer);
    
    let finalPrizePool = calculatePrizePool(room);
    io.to(roomId).emit('gameStarted', { 
        message: 'ጨዋታው ተጀምሯል!',
        prizePool: finalPrizePool
    });

    let roomBotCards = {};
    for (let bNum in room.selectedBoards) {
        let ownerId = room.selectedBoards[bNum];
        if (ownerId && ownerId.startsWith('BOT_')) {
            roomBotCards[ownerId] = { boardNumber: bNum, card: generateServerBingoCard() };
        }
    }

    room.gameInterval = setInterval(() => {
        if (room.drawnNumbers.length >= 75) {
            clearInterval(room.gameInterval);
            room.status = 'ended';
            io.to(roomId).emit('gameOver', { message: 'ጨዋታው አልቋል!' });
            delete activeRooms[roomId];
            return;
        }

        let rand;
        do {
            rand = Math.floor(Math.random() * 75) + 1;
        } while (room.drawnNumbers.includes(rand));

        room.drawnNumbers.push(rand);
        io.to(roomId).emit('numberDrawn', { number: rand, drawnHistory: room.drawnNumbers });

        for (let botId in roomBotCards) {
            let botData = roomBotCards[botId];
            let winningLine = findWinningLine(botData.card, room.drawnNumbers);
            if (winningLine) {
                clearInterval(room.gameInterval);
                room.status = 'ended';
                io.to(roomId).emit('gameOver', { 
                    subtitle: '1 player has won the game',
                    winnerName: room.playerNames[botId] || "Kenbo-Bot",
                    boardNumber: botData.boardNumber,
                    winAmount: finalPrizePool,
                    winningLine: winningLine
                });
                delete activeRooms[roomId];
                return;
            }
        }
    }, 3000);
}

io.on('connection', (socket) => {
    socket.on('joinLobby', (data) => {
        const betAmount = data && data.betAmount ? data.betAmount : '20';
        let room = getOrCreateLobby(betAmount);

        // ጨዋታው ከጀመረ መግባት በፍጹም አይቻልም
        if (room.status === 'playing') {
            return socket.emit('gameAlreadyStarted', { message: 'ጨዋታው ኦሬዲ ጀምሯል! አዲስ ተጫዋች መግባት አይችልም።' });
        }

        socket.join(room.roomId);
        room.players.add(socket.id);
        socket.currentRoomId = room.roomId;

        let currentPrizePool = calculatePrizePool(room);
        socket.emit('assignedRoom', { 
            roomId: room.roomId, 
            betAmount: room.betAmount,
            countdown: room.countdown,
            startTime: room.startTime,
            status: room.status,
            selectedBoards: room.selectedBoards,
            activePlayersCount: getActivePlayersCount(room),
            prizePool: currentPrizePool
        });
        
        io.to(room.roomId).emit('playersUpdate', { 
            playersCount: room.players.size,
            activePlayersCount: getActivePlayersCount(room),
            prizePool: currentPrizePool
        });
    });

    socket.on('selectBoardTemp', (data) => {
        const { roomId, boardNumber } = data;
        let room = activeRooms[roomId];

        if (room && room.status === 'waiting') {
            if (room.selectedBoards[boardNumber]) {
                return socket.emit('boardSelectError', { message: 'ይህ ቦርድ አስቀድሞ ተይዟል!' });
            }
            if (!room.tempSelections) room.tempSelections = {};
            room.tempSelections[socket.id] = boardNumber;
            socket.emit('boardTempSelected', { boardNumber });
        } else if (room && room.status === 'playing') {
            socket.emit('gameAlreadyStarted', { message: 'ጨዋታው ኦሬዲ ጀምሯል! ቦርድ መምረጥ አይቻልም።' });
        }
    });

    socket.on('startPlayerGame', (data) => {
        const { roomId, boardNumber, name } = data;
        let room = activeRooms[roomId];

        if (room && room.status === 'waiting') {
            if (room.selectedBoards[boardNumber]) {
                return socket.emit('boardSelectError', { message: 'ይህ ቦርድ አስቀድሞ ተይዟል!' });
            }

            for (let bNum in room.selectedBoards) {
                if (room.selectedBoards[bNum] === socket.id) {
                    delete room.selectedBoards[bNum];
                    io.to(roomId).emit('boardReleased', { boardNumber: bNum });
                }
            }

            room.selectedBoards[boardNumber] = socket.id;
            room.playerNames[socket.id] = name || 'Player';

            let currentPrizePool = calculatePrizePool(room);
            io.to(roomId).emit('boardSelected', { boardNumber, socketId: socket.id });
            io.to(roomId).emit('activePlayersUpdate', { activePlayersCount: getActivePlayersCount(room), prizePool: currentPrizePool });
            socket.emit('gameJoinSuccess', { boardNumber, prizePool: currentPrizePool });
        } else if (room && room.status === 'playing') {
            socket.emit('gameAlreadyStarted', { message: 'ጨዋታው ኦሬዲ ጀምሯል! መግባት አይቻልም።' });
        }
    });

    socket.on('claimBingo', async (data) => {
        const { identifier, name, winAmount, roomId, boardNumber, winningLine } = data;
        let room = activeRooms[roomId];
        
        if (room && room.status === 'playing') {
            room.status = 'ended';
            if (room.gameInterval) clearInterval(room.gameInterval);

            let finalWinAmount = calculatePrizePool(room) || winAmount;
            try {
                const userRes = await pool.query('SELECT balance FROM users WHERE identifier = $1', [identifier]);
                if (userRes.rows.length > 0) {
                    let newBal = parseFloat(userRes.rows[0].balance) + parseFloat(finalWinAmount);
                    await pool.query('UPDATE users SET balance = $1 WHERE identifier = $2', [newBal, identifier]);
                    
                    io.to(roomId).emit('gameOver', { 
                        subtitle: '1 player has won the game',
                        winnerName: name || room.playerNames[socket.id] || 'Winner',
                        boardNumber: boardNumber,
                        winAmount: finalWinAmount,
                        winningLine: winningLine
                    });
                    delete activeRooms[roomId];
                }
            } catch (err) {
                console.error('Bingo claim error:', err);
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
                let currentPrizePool = calculatePrizePool(room);
                io.to(roomId).emit('playersUpdate', { playersCount: room.players.size, activePlayersCount: getActivePlayersCount(room), prizePool: currentPrizePool });
            }
        }
    });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, `0.0.0.0`, () => {
    console.log(`Server running on port ${PORT}`);
});s
