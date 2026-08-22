const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const TelegramBot = require('node-telegram-bot-api');
const pool = require('./database');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

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
} else {
    console.error('ERROR: Telegram Bot Token not provided!');
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
    const { identifier, type, amount, details } = req.body;
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

// --- TELEGRAM BOT COMMANDS ---
if (bot) {
    bot.setMyCommands([
        { command: 'start', description: 'ቦቱን ለመጀመር' },
        { command: 'play', description: '🎮 Play Bingo (ጨዋታውን ክፈት)' },
        { command: 'balance', description: '💰 ቀሪ ሂሳብዎን ለማየት' },
        { command: 'deposit', description: '💳 የዲፖዚት መመሪያ' },
        { command: 'withdraw', description: '💸 ገንዘብ ወጪ ለማድረግ' }
    ]);

    bot.onText(/\/start/, (msg) => {
        const chatId = msg.chat.id;
        const name = msg.from.first_name;
        let welcomeMessage = `✨ **እንኳን ደህና መጡ!** ✨\n\nሰላም **${name}**! ወደ 🏆 **ዋና ቢንጎ (Wana Bingo)** በሰላም መጡ።`;
        bot.sendMessage(chatId, welcomeMessage, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🚀  ዋናውን ቢንጎ ጨዋታ ጀምር (Play Bingo)  🎮', web_app: { url: WEB_APP_URL } }]
                ]
            }
        });
    });
}

// --- DYNAMIC ROOM & LOBBY SOCKET MANAGEMENT ---
let activeRooms = {}; // Key: roomId, Value: Room Object

function getOrCreateActiveRoom(betAmount) {
    // ለእያንዳንዱ የስታክ መጠን ገቢ ጨዋታ እየተካሄደበት ያለ ሩም መኖሩን እንፈትሻለን
    let currentRoomId = null;
    
    for (let rId in activeRooms) {
        if (activeRooms[rId].betAmount == betAmount && activeRooms[rId].status === 'waiting') {
            currentRoomId = rId;
            break;
        }
    }

    // ከዚህ በፊት የሚጠብቅ (waiting) ሩም ካልተገኘ አዲስ ሩም እንፈጥራለን (Room ID በሰዓት/ራንደም በመታገዝ የተለያየ ይደረጋል)
    if (!currentRoomId) {
        currentRoomId = `ROOM_${betAmount}_${Date.now()}`;
        activeRooms[currentRoomId] = {
            roomId: currentRoomId,
            betAmount,
            status: 'waiting', // waiting, playing, ended
            players: new Set(),
            reservedNumbers: {}, 
            selectedBoards: {},  
            drawnNumbers: [],
            countdown: 30,
            timer: null,
            gameInterval: null
        };
        startGlobalLobbyCountdown(currentRoomId);
    }
    return activeRooms[currentRoomId];
}

function startGlobalLobbyCountdown(roomId) {
    let room = activeRooms[roomId];
    if (!room) return;

    if (room.timer) clearInterval(room.timer);

    room.timer = setInterval(() => {
        if (room.status !== 'waiting') return;

        room.countdown--;
        io.to(roomId).emit('countdownUpdate', { countdown: room.countdown, playersCount: room.players.size });

        if (room.countdown <= 0) {
            // ማሳሰቢያ፡ ሩሙ ቢያንስ 2 ተጫዋቾች ሊኖሩት ይገባል!
            if (room.players.size < 2) {
                room.countdown = 30; // ተጫዋች ካልተገኘ ሰዓቱ ተመልሶ ከ 30 ጀምሮ ይቆጥራል
                io.to(roomId).emit('notification', { message: 'በቂ ተጫዋች (ቢያንስ 2) ስላልተገኘ ሰዓቱ እንደገና ከ 30 ጀምሮ ቆጠራ ጀምሯል...' });
            } else {
                startRoomGame(roomId);
            }
        }
    }, 1000);
}

function startRoomGame(roomId) {
    let room = activeRooms[roomId];
    if (!room) return;

    room.status = 'playing'; // ጨዋታው ስለተጀመረ አዲስ ተጫዋች ወደዚህ ሩም መግባት አይችልም
    if (room.timer) clearInterval(room.timer);
    io.to(roomId).emit('gameStarted', { message: 'ጨዋታው ተጀምሯል! ቁጥሮች መጥራት ጀምረዋል...' });

    room.gameInterval = setInterval(() => {
        // እስከ 75 (ወይም እንደ ቦርዱ ብዛት 100) ቁጥሮች መጥራት
        if (room.drawnNumbers.length >= 100) {
            clearInterval(room.gameInterval);
            room.status = 'ended';
            io.to(roomId).emit('gameOver', { message: 'ጨዋታው አልቋል! ሁሉም ቁጥሮች ተጠርተዋል አሸናፊ አልተገኘም።' });
            delete activeRooms[roomId]; // ሩሙ ይዘጋል
            return;
        }

        let rand;
        do {
            rand = Math.floor(Math.random() * 100) + 1;
        } while (room.drawnNumbers.includes(rand));

        room.drawnNumbers.push(rand);
        io.to(roomId).emit('numberDrawn', { number: rand, drawnHistory: room.drawnNumbers });
    }, 3000);
}

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('joinLobby', (data) => {
        const betAmount = data && data.betAmount ? data.betAmount : '100';
        let room = getOrCreateActiveRoom(betAmount);

        // ጨዋታው የተጀመረ ከሆነ አዲስ ተጫዋች ወደዚህ ሩም እንዳይገባ እንከለክላለን (ሌላ አዲስ ሩም እንዲፈጠር ይደረጋል)
        if (room.status === 'playing') {
            socket.emit('joinError', { message: 'ይህ ጨዋታ ተጀምሯል፤ እባክዎን ለቀጣዩ ዙር አዲስ ሩም ይቀላቀሉ!' });
            return;
        }

        socket.join(room.roomId);
        room.players.add(socket.id);
        socket.currentRoomId = room.roomId;

        socket.emit('assignedRoom', { 
            roomId: room.roomId, 
            betAmount: room.betAmount,
            countdown: room.countdown,
            status: room.status,
            reservedNumbers: room.reservedNumbers,
            selectedBoards: room.selectedBoards 
        });
    });

    // ቁጥር መያዝ (እንደ ፎቶው ዓይነት ተጫዋቾች የመረጡትን ቁጥር ለሁሉም ማሳየት)
    socket.on('reserveNumber', (data) => {
        const { roomId, number } = data;
        let room = activeRooms[roomId];

        if (room && room.status === 'waiting') {
            if (!room.reservedNumbers[number]) {
                room.reservedNumbers[number] = socket.id;
                // የተያዘውን ቁጥር በሰኮንዶች ውስጥ ለሚገኙ ሁሉም ተጫዋቾች እናሳያለን
                io.to(roomId).emit('numberReserved', { number, socketId: socket.id });
            } else {
                socket.emit('reservationError', { message: 'ይህ ቁጥር አስቀድሞ በሌላ ተጫዋች ተይዟል!' });
            }
        }
    });

    socket.on('claimBingo', async (data) => {
        const { identifier, winAmount, roomId } = data;
        let room = activeRooms[roomId];
        
        if (room && room.status === 'playing') {
            room.status = 'ended';
            if (room.gameInterval) clearInterval(room.gameInterval);
            if (room.timer) clearInterval(room.timer);

            try {
                const userRes = await pool.query('SELECT balance FROM users WHERE identifier = $1', [identifier]);
                if (userRes.rows.length > 0) {
                    let newBal = parseFloat(userRes.rows[0].balance) + parseFloat(winAmount);
                    await pool.query('UPDATE users SET balance = $1 WHERE identifier = $2', [newBal, identifier]);
                    io.to(roomId).emit('gameOver', { message: `🎉 ተጫዋች BINGO አሸንፏል! ${winAmount} ብር ተሸልሟል።` });
                }
            } catch (err) {
                console.error('Bingo claim error:', err);
            } finally {
                delete activeRooms[roomId]; // ጨዋታው ሲያልቅ ሩሙ ሙሉ በሙሉ ይዘጋል
            }
        }
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        for (let roomId in activeRooms) {
            let room = activeRooms[roomId];
            if (room.players.has(socket.id)) {
                room.players.delete(socket.id);
                
                for (let num in room.reservedNumbers) {
                    if (room.reservedNumbers[num] === socket.id) {
                        delete room.reservedNumbers[num];
                        io.to(roomId).emit('numberReleased', { number: num });
                    }
                }
            }
        }
    });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
