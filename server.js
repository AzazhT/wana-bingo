const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

let users = {}; // user database
let rooms = {}; // active rooms data

function getOrCreateRoom(betAmount) {
    let activeRoomId = Object.keys(rooms).find(id => rooms[id].betAmount === betAmount && rooms[id].status === 'waiting');
    if (!activeRoomId) {
        activeRoomId = 'ROOM_' + betAmount + '_' + Date.now();
        rooms[activeRoomId] = {
            roomId: activeRoomId,
            betAmount: betAmount,
            selectedBoards: {},
            drawnNumbers: [],
            status: 'waiting',
            countdown: 30,
            timer: null,
            players: []
        };
        startRoomCountdown(activeRoomId);
    }
    return activeRoomId;
}

function startRoomCountdown(roomId) {
    rooms[roomId].timer = setInterval(() => {
        if (!rooms[roomId]) return;
        rooms[roomId].countdown--;
        io.to(roomId).emit('countdownUpdate', { countdown: rooms[roomId].countdown });
        
        if (rooms[roomId].countdown <= 0) {
            clearInterval(rooms[roomId].timer);
            rooms[roomId].status = 'playing';
            io.to(roomId).emit('gameStarted', { message: 'Game started!' });
            startDrawingNumbers(roomId);
        }
    }, 1000);
}

function startDrawingNumbers(roomId) {
    let room = rooms[roomId];
    if (!room) return;
    
    let interval = setInterval(() => {
        if (room.status !== 'playing') {
            clearInterval(interval);
            return;
        }
        if (room.drawnNumbers.length >= 75) {
            clearInterval(interval);
            return;
        }
        
        let num;
        do {
            num = Math.floor(Math.random() * 75) + 1;
        } while (room.drawnNumbers.includes(num));
        
        room.drawnNumbers.push(num);
        io.to(roomId).emit('numberDrawn', { number: num, drawnHistory: room.drawnNumbers });
    }, 4000);
}

// API Endpoints
app.post('/api/get-user', (req, res) => {
    const { identifier, name, username } = req.body;
    if (!users[identifier]) {
        users[identifier] = { identifier, name, username, balance: 1000.00, phone: '' }; // የሙከራ ዎችንግ (Bonus)
    }
    res.json({ success: true, user: users[identifier] });
});

app.post('/api/update-phone', (req, res) => {
    const { identifier, phone } = req.body;
    if (users[identifier]) {
        users[identifier].phone = phone;
        return res.json({ success: true });
    }
    res.json({ success: false, message: 'User not found' });
});

app.post('/api/request-transaction', (req, res) => {
    const { identifier, amount } = req.body;
    if (users[identifier]) {
        users[identifier].balance += parseFloat(amount);
        return res.json({ success: true, tx_id: 'TX_' + Math.floor(Math.random() * 1000000) });
    }
    res.json({ success: false });
});

io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);
    let currentRoomId = null;

    socket.on('joinLobby', (data) => {
        const { betAmount } = data;
        currentRoomId = getOrCreateRoom(betAmount);
        socket.join(currentRoomId);
        rooms[currentRoomId].players.push(socket.id);

        socket.emit('assignedRoom', {
            roomId: currentRoomId,
            countdown: rooms[currentRoomId].countdown,
            selectedBoards: rooms[currentRoomId].selectedBoards
        });
    });

    // ቦርዱን የሚይዘው እና ስታርት ሲደረግ ገንዘብ የሚቆርጠው ክፍል
    socket.on('lockBoardAndStart', (data) => {
        const { roomId, boardNumber, identifier, betAmount } = data;
        const room = rooms[roomId];

        if (!room) {
            return socket.emit('lockError', { message: 'ይህ ክፍል አልተገኘም!' });
        }

        if (!users[identifier] || users[identifier].balance < betAmount) {
            return socket.emit('lockError', { message: 'በቂ ባላንስ የለዎትም!' });
        }

        // ቦርዱ በሌላ ተጫዋች መያዙን ማረጋገጥ
        if (room.selectedBoards[boardNumber]) {
            return socket.emit('lockError', { message: 'ይህ ቦርድ በሌላ ተጫዋች ተይዟል! እባክዎ ሌላ ይምረጡ።' });
        }

        // ባላንስ መቀነስ
        users[identifier].balance -= betAmount;

        // ቦርዱን ለዚህ ተጫዋች መቆለፍ
        room.selectedBoards[boardNumber] = socket.id;

        // ለሌሎች ተጫዋቾች ቦርዱ መያዙን ማሳወቅ
        io.to(roomId).emit('boardSelected', { boardNumber, socketId: socket.id });

        // ለተጠቃሚው ስኬታማ መሆኑን መንገር
        socket.emit('lockSuccess', { newBalance: users[identifier].balance, boardNumber });
    });

    socket.on('claimBingo', (data) => {
        const { identifier, winAmount, roomId } = data;
        if (users[identifier]) {
            users[identifier].balance += winAmount;
        }
        io.to(roomId).emit('gameOver', { message: `🎉 ተጫዋች አሸንፏል! (Bingo Won!)` });
    });

    socket.on('disconnect', () => {
        if (currentRoomId && rooms[currentRoomId]) {
            let room = rooms[currentRoomId];
            for (let bNum in room.selectedBoards) {
                if (room.selectedBoards[bNum] === socket.id) {
                    delete room.selectedBoards[bNum];
                    io.to(currentRoomId).emit('boardReleased', { boardNumber: bNum });
                }
            }
            room.players = room.players.filter(id => id !== socket.id);
        }
        console.log('User disconnected:', socket.id);
    });
});

server.listen(3000, () => {
    console.log('Server running on port 3000');
});
