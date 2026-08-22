const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());

let rooms = {}; 
let users = {}; 

app.post('/api/get-user', (req, res) => {
    const reqBody = req.body || {};
    const identifier = reqBody.identifier;
    const name = reqBody.name || reqBody.username;

    if (!identifier) {
        return res.json({ success: false, message: 'Identifier is required' });
    }

    if (!users[identifier]) {
        users[identifier] = { identifier: identifier, name: name || 'Player', balance: 1000.00, phone: '' };
    }
    res.json({ success: true, user: users[identifier] });
});

app.post('/api/place-bet', (req, res) => {
    const reqBody = req.body || {};
    const identifier = reqBody.identifier;
    const amount = parseFloat(reqBody.amount || 0);

    let user = users[identifier];
    if (!user || user.balance < amount) {
        return res.json({ success: false, message: 'በቂ ባላንስ የለዎትም!' });
    }
    user.balance -= amount;
    res.json({ success: true, newBalance: user.balance });
});

app.post('/api/request-transaction', (req, res) => {
    res.json({ success: true, tx_id: 'TXN-' + Math.floor(Math.random() * 1000000) });
});

app.post('/api/update-phone', (req, res) => {
    const reqBody = req.body || {};
    const identifier = reqBody.identifier;
    const phone = reqBody.phone;

    if (identifier && users[identifier]) {
        users[identifier].phone = phone;
    }
    res.json({ success: true });
});

io.on('connection', (socket) => {
    let currentJoinedRoom = null;

    socket.on('joinLobby', (data) => {
        data = data || {};
        let betAmount = data.betAmount || 20;
        let roomId = 'room_' + betAmount;

        if (!rooms[roomId]) {
            rooms[roomId] = {
                betAmount: betAmount,
                startTime: Date.now() + 30000, 
                status: 'waiting', 
                selectedBoards: {}, 
                drawnNumbers: [],
                players: new Set(),
                timer: null
            };
            startRoomCountdown(roomId);
        }

        currentJoinedRoom = roomId;
        socket.join(roomId);
        rooms[roomId].players.add(socket.id);

        socket.emit('assignedRoom', {
            roomId: roomId,
            startTime: rooms[roomId].startTime,
            selectedBoards: rooms[roomId].selectedBoards
        });

        updateRoomStats(roomId);
    });

    socket.on('selectBoardTemp', (data) => {
        data = data || {};
        let room = rooms[data.roomId];
        if (!room) return;

        for (let b in room.selectedBoards) {
            if (room.selectedBoards[b] === socket.id) {
                delete room.selectedBoards[b];
            }
        }

        room.selectedBoards[data.boardNumber] = socket.id;
        io.to(data.roomId).emit('boardSelected', { boardNumber: data.boardNumber, socketId: socket.id });
        updateRoomStats(data.roomId);
    });

    socket.on('startPlayerGame', (data) => {
        data = data || {};
        let room = rooms[data.roomId];
        if (!room) return;
        room.selectedBoards[data.boardNumber] = socket.id;
        io.to(data.roomId).emit('boardSelected', { boardNumber: data.boardNumber, socketId: socket.id });
        updateRoomStats(data.roomId);
    });

    socket.on('claimBingo', (data) => {
        data = data || {};
        let room = rooms[data.roomId];
        if (!room || room.status !== 'playing') return;

        room.status = 'finished';
        let winnerUser = users[data.identifier];
        let winnerName = winnerUser ? winnerUser.name : 'ተጫዋች';
        let prize = parseFloat(data.winAmount || 0);

        if (winnerUser) {
            winnerUser.balance += prize;
        }

        io.to(data.roomId).emit('gameOver', {
            message: '🎉 እንኳን ደስ አለዎት! ' + winnerName + ' በቦርድ ቁጥር ' + (data.boardNumber || '--') + ' አሸንፈዋል! (ሽልማት: ' + prize.toFixed(2) + ' ብር)'
        });
    });

    socket.on('disconnect', () => {
        if (currentJoinedRoom && rooms[currentJoinedRoom]) {
            let room = rooms[currentJoinedRoom];
            room.players.delete(socket.id);
            for (let b in room.selectedBoards) {
                if (room.selectedBoards[b] === socket.id) {
                    delete room.selectedBoards[b];
                    io.to(currentJoinedRoom).emit('boardReleased', { boardNumber: b });
                }
            }
            updateRoomStats(currentJoinedRoom);
        }
    });
});

function startRoomCountdown(roomId) {
    let room = rooms[roomId];
    if (!room) return;

    room.timer = setInterval(() => {
        let timeLeft = Math.floor((room.startTime - Date.now()) / 1000);
        
        if (timeLeft <= 0 && room.status === 'waiting') {
            room.status = 'playing';
            clearInterval(room.timer);
            io.to(roomId).emit('gameStarted', {});
            startCallingNumbers(roomId);
        }
    }, 1000);
}

function startCallingNumbers(roomId) {
    let room = rooms[roomId];
    if (!room) return;

    let availableNumbers = [];
    for (let i = 1; i <= 75; i++) {
        availableNumbers.push(i);
    }
    availableNumbers.sort(() => Math.random() - 0.5);

    let callInterval = setInterval(() => {
        if (room.status !== 'playing' || availableNumbers.length === 0) {
            clearInterval(callInterval);
            return;
        }
        let num = availableNumbers.pop();
        room.drawnNumbers.push(num);

        io.to(roomId).emit('numberDrawn', {
            number: num,
            drawnHistory: room.drawnNumbers
        });
    }, 3000);
}

function updateRoomStats(roomId) {
    let room = rooms[roomId];
    if (!room) return;
    let activeBoardsCount = Object.keys(room.selectedBoards).length;
    let currentDerash = activeBoardsCount * room.betAmount * 0.85;

    io.to(roomId).emit('roomStatsUpdate', {
        activePlayers: room.players.size,
        activeBoards: activeBoardsCount,
        derash: currentDerash
    });
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log('Server is running on port ' + PORT);
});
