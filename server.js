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

const TOKEN = process.env.BOT_TOKEN || 'YOUR_TELEGRAM_BOT_TOKEN';
const bot = new TelegramBot(TOKEN, { polling: true });

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
        res.status(500).json({ success: false });
    }
});

// --- LOBBY & ROOM SOCKET MANAGEMENT ---
let activeRooms = {}; // roomId -> { status: 'waiting'|'playing', players: [], drawnNumbers: [], timer: null, countdown: 30 }

function createNewRoom() {
    const roomId = 'ROOM_' + Math.floor(1000 + Math.random() * 9000);
    activeRooms[roomId] = {
        roomId,
        status: 'waiting',
        players: new Set(),
        drawnNumbers: [],
        countdown: 30,
        timer: null
    };
    startLobbyCountdown(roomId);
    return roomId;
}

let currentActiveLobbyId = createNewRoom();

function startLobbyCountdown(roomId) {
    activeRooms[roomId].timer = setInterval(() => {
        let room = activeRooms[roomId];
        if (!room) return;

        room.countdown--;
        io.to(roomId).emit('countdownUpdate', { countdown: room.countdown });

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
    io.to(roomId).emit('gameStarted', { message: 'ጨዋታው ተጀምሯል!' });

    // Create next lobby for incoming players
    if (currentActiveLobbyId === roomId) {
        currentActiveLobbyId = createNewRoom();
    }

    // Start drawing numbers every 3 seconds
    room.gameInterval = setInterval(() => {
        if (room.drawnNumbers.length >= 75) {
            clearInterval(room.gameInterval);
            io.to(roomId).emit('gameOver', { message: 'ጨዋታው አልቋል! አሸናፊ አልተገኘም።' });
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

    socket.on('joinLobby', () => {
        let roomId = currentActiveLobbyId;
        socket.join(roomId);
        activeRooms[roomId].players.add(socket.id);

        socket.emit('assignedRoom', { 
            roomId, 
            countdown: activeRooms[roomId].countdown,
            status: activeRooms[roomId].status 
        });
    });

    socket.on('claimBingo', async (data) => {
        const { identifier, winAmount, roomId } = data;
        let room = activeRooms[roomId];
        
        if (room && room.status === 'playing') {
            room.status = 'ended';
            if (room.gameInterval) clearInterval(room.gameInterval);

            // Update user balance in DB for winning
            try {
                const userRes = await pool.query('SELECT balance FROM users WHERE identifier = $1', [identifier]);
                if (userRes.rows.length > 0) {
                    let newBal = parseFloat(userRes.rows[0].balance) + parseFloat(winAmount);
                    await pool.query('UPDATE users SET balance = $1 WHERE identifier = $2', [newBal, identifier]);
                    
                    io.to(roomId).emit('gameOver', { message: `🎉 ተጫዋች አሸንፏል! ${winAmount} ብር ወስዷል።` });
                }
            } catch (err) {
                console.error('Bingo claim error:', err);
            }
        }
    });

    socket.on('disconnect', () => {
        for (let roomId in activeRooms) {
            if (activeRooms[roomId].players.has(socket.id)) {
                activeRooms[roomId].players.delete(socket.id);
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
