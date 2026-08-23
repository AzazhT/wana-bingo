const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const TelegramBot = require('node-telegram-bot-api');
const pool = require('./database');

const app = express();
const server = http.createServer(app);
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

// REST APIs for User & Wallet
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
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.post('/api/update-phone', async (req, res) => {
    const { identifier, phone } = req.body;
    try {
        await pool.query('UPDATE users SET phone = $1 WHERE identifier = $2', [phone, identifier]);
        res.json({ success: true });
    } catch (err) {
        console.error(err);
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
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.post('/api/request-transaction', async (req, res) => {
    const { identifier, type, amount } = req.body;
    const tx_id = 'TX' + Math.floor(100000 + Math.random() * 900000);
    try {
        await pool.query(
            'INSERT INTO transactions (tx_id, identifier, type, amount, handled) VALUES ($1, $2, $3, $4, FALSE)',
            [tx_id, identifier, type, amount]
        );
        res.json({ success: true, tx_id });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false });
    }
});

// --- GLOBAL LOBBY & ROOM SOCKET MANAGEMENT ---
let activeRooms = {}; 

function getActivePlayersCount(room) {
    let activeSocketIds = new Set();
    for (let bNum in room.selectedBoards) {
        if (room.selectedBoards[bNum]) {
            activeSocketIds.add(room.selectedBoards[bNum]);
        }
    }
    for (let socketId of room.players) {
        activeSocketIds.add(socketId);
    }
    return activeSocketIds.size;
}

function calculatePrizePool(room) {
    let activeCount = getActivePlayersCount(room);
    let totalBet = activeCount * parseFloat(room.betAmount);
    let commissionRate = 0.10; 
    let prizePool = totalBet * (1 - commissionRate);
    return Math.floor(prizePool > 0 ? prizePool : parseFloat(room.betAmount));
}

function getOrCreateLobby(betAmount) {
    let roomId = `ROOM_${betAmount}`;
    
    if (!activeRooms[roomId] || activeRooms[roomId].status === 'ended') {
        activeRooms[roomId] = {
            roomId,
            betAmount,
            status: 'waiting', 
            players: new Set(),
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
        let currentPrizePool = calculatePrizePool(room);

        io.to(roomId).emit('countdownUpdate', { 
            countdown: room.countdown, 
            playersCount: room.players.size,
            activePlayersCount: getActivePlayersCount(room),
            prizePool: currentPrizePool,
            startTime: room.startTime 
        });

        if (room.countdown <= 0) {
            clearInterval(room.timer);
            startRoomGame(roomId);
        }
    }, 1000);
}

function startRoomGame(roomId) {
    let room = activeRooms[roomId];
    if (!room) return;

    room.status = 'playing';
    if (room.timer) clearInterval(room.timer);
    
    let finalPrizePool = calculatePrizePool(room);
    
    // ጨዋታው መጀመሩን እና መቆለፉን (Lock) ለሁሉም በክፍሉ ውስጥ ላሉት እናሳውቃለን
    io.to(roomId).emit('gameStarted', { 
        message: 'ጨዋታው ጀምሯል! አዳዲስ መግቢያዎች ተዘግተዋል።',
        prizePool: finalPrizePool
    });

    room.gameInterval = setInterval(() => {
        if (room.drawnNumbers.length >= 75) {
            clearInterval(room.gameInterval);
            room.status = 'ended';
            io.to(roomId).emit('gameOver', { message: 'ጨዋታው አልቋል! 75ቱ ቁጥሮች ተጠርተዋል አሸናፊ አልተገኘም።' });
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
    console.log('User connected:', socket.id);

    socket.on('joinLobby', (data) => {
        const betAmount = data && data.betAmount ? data.betAmount : '20';
        let room = getOrCreateLobby(betAmount);

        // ጨዋታው ቀደም ብሎ ከጀመረ አዳዲስ ተጫዋቾችን ወደ ጨዋታው እንዳይገቡ እንከለክላለን
        if (room.status === 'playing') {
            socket.emit('gameAlreadyStarted', { 
                message: 'ይህ ጨዋታ ጀምሯል! ከዚህ በኋላ ቁጥር መምረጥም ሆነ ወደ ጨዋታው መግባት አይቻልም።'
            });
            return;
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
                return socket.emit('boardSelectError', { message: 'ይህ ቦርድ ቁጥር አስቀድሞ በሌላ ተጫዋች ተይዟል!' });
            }
            if (!room.tempSelections) room.tempSelections = {};
            room.tempSelections[socket.id] = boardNumber;
            socket.emit('boardTempSelected', { boardNumber });
        } else {
            socket.emit('boardSelectError', { message: 'ጨዋታው ስለጀመረ ቦርድ መምረጥ አይቻልም!' });
        }
    });

    socket.on('startPlayerGame', (data) => {
        const { roomId, boardNumber } = data;
        let room = activeRooms[roomId];

        // ጨዋታው ከተጀመረ (playing) ማንም ሰው ቦርድ ይዞ ወደ ውስጥ መግባት አይችልም
        if (!room || room.status !== 'waiting') {
            return socket.emit('gameAlreadyStarted', { message: 'ሰዓቱ አልቋል ወይም ጨዋታው ጀምሯል!' });
        }

        if (room.selectedBoards[boardNumber]) {
            return socket.emit('boardSelectError', { message: 'ይህ ቦርድ ቁጥር አስቀድሞ ተይዟል!' });
        }

        room.selectedBoards[boardNumber] = socket.id;
        let currentPrizePool = calculatePrizePool(room);

        io.to(roomId).emit('boardSelected', { boardNumber, socketId: socket.id });
        io.to(roomId).emit('activePlayersUpdate', { 
            activePlayersCount: getActivePlayersCount(room),
            prizePool: currentPrizePool 
        });

        socket.emit('gameJoinSuccess', { boardNumber, prizePool: currentPrizePool });
    });

    // ቢንጎ ሲጠየቅ ሰርቨሩ ላይ ቼክ ተደርጎ ውጤቱ ለዛው ክፍል (Room) ብቻ ይላካል
    socket.on('claimBingo', async (data) => {
        const { identifier, name, winAmount, roomId, boardNumber, winningLine } = data;
        let room = activeRooms[roomId];
        
        if (room && room.status === 'playing') {
            room.status = 'ended';
            if (room.gameInterval) clearInterval(room.gameInterval);
            if (room.timer) clearInterval(room.timer);

            let finalWinAmount = calculatePrizePool(room) || winAmount;

            try {
                const userRes = await pool.query('SELECT balance FROM users WHERE identifier = $1', [identifier]);
                if (userRes.rows.length > 0) {
                    let newBal = parseFloat(userRes.rows[0].balance) + parseFloat(finalWinAmount);
                    await pool.query('UPDATE users SET balance = $1 WHERE identifier = $2', [newBal, identifier]);
                }
            } catch (err) {
                console.error('Bingo claim error:', err);
            }

            // ውጤቱን በዛው ክፍል (Room) ውስጥ ላሉ ንቁ ተጫዋቾች ብቻ እናሳያለን
            io.to(roomId).emit('gameOver', { 
                subtitle: `${name} ጨዋታውን አሸንፏል!`,
                winnerName: name,
                boardNumber: boardNumber,
                winAmount: finalWinAmount,
                winningLine: winningLine
            });
        }
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        for (let roomId in activeRooms) {
            let room = activeRooms[roomId];
            if (room.players.has(socket.id)) {
                room.players.delete(socket.id);
                
                if (room.status === 'waiting') {
                    for (let bNum in room.selectedBoards) {
                        if (room.selectedBoards[bNum] === socket.id) {
                            delete room.selectedBoards[bNum];
                            io.to(roomId).emit('boardReleased', { boardNumber: bNum });
                        }
                    }
                }

                let currentPrizePool = calculatePrizePool(room);
                io.to(roomId).emit('playersUpdate', { 
                    playersCount: room.players.size,
                    activePlayersCount: getActivePlayersCount(room),
                    prizePool: currentPrizePool
                });
            }
        }
    });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
