const express = require('http');
const { Server } = require('socket.io');
const app = express();
const http = require('http').createServer(app);
const io = new Server(http);

app.use(express.json());

// የጨዋታ ክፍሎች (Rooms) እና ተጠቃሚዎች ማከማቻ
let rooms = {}; // roomId -> { betAmount, startTime, status, selectedBoards: {}, drawnNumbers: [], players: Set }
let users = {}; // identifier -> { id, name, balance, phone }

// ዩዘርን የማግኘት ወይም የመፍጠር API
app.post('/api/get-user', (req, res) => {
    const { identifier, name, username } = req.body;
    if (!users[identifier]) {
        users[identifier] = { identifier, name: name || username, balance: 1000.00, phone: '' }; // ለፈተና 1000 ብር ቦነስ ተሰጥቷል
    }
    res.json({ success: true, user: users[identifier] });
});

// ውርርድ የመቀበል API
app.post('/api/place-bet', (req, res) => {
    const { identifier, amount } = req.body;
    let user = users[identifier];
    if (!user || user.balance < amount) {
        return res.json({ success: false, message: 'በቂ ባላንስ የለዎትም!' });
    }
    user.balance -= parseFloat(amount);
    res.json({ success: true, newBalance: user.balance });
});

// የገንዘብ ግብይት ጥያቄ
app.post('/api/request-transaction', (req, res) => {
    res.json({ success: true, tx_id: 'TXN-' + Math.floor(Math.random() * 1000000) });
});

// ስልክ ቁጥር ማሻሻያ
app.post('/api/update-phone', (req, res) => {
    const { identifier, phone } = req.body;
    if (users[identifier]) {
        users[identifier].phone = phone;
    }
    res.json({ success: true });
});

// Socket.io ግንኙነት
io.on('connection', (socket) => {
    let currentJoinedRoom = null;

    // ተጫዋቹ የውርርድ መጠን መርጦ ወደ ሎቢ ሲገባ
    socket.on('joinLobby', (data) => {
        let betAmount = data.betAmount;
        let roomId = `room_${betAmount}`;

        if (!rooms[roomId]) {
            rooms[roomId] = {
                betAmount: betAmount,
                startTime: Date.now() + 30000, // 30 ሰከንድ ቆይታ
                status: 'waiting', // waiting, playing
                selectedBoards: {}, // boardNumber -> socket.id
                drawnNumbers: [],
                players: new Set(),
                timer: null
            };
            startRoomCountdown(roomId);
        }

        currentJoinedRoom = roomId;
        socket.join(roomId);
        rooms[roomId].players.add(socket.id);

        // አዳዲስ መረጃዎችን ለተጫዋቹ መላክ
        socket.emit('assignedRoom', {
            roomId: roomId,
            startTime: rooms[roomId].startTime,
            selectedBoards: rooms[roomId].selectedBoards
        });

        updateRoomStats(roomId);
    });

    // ቦርድ በጊዜያዊነት መምረጥ (Temporary Select)
    socket.on('selectBoardTemp', (data) => {
        let room = rooms[data.roomId];
        if (!room) return;

        // የራሱን ძველი ቦርድ መልቀቅ
        for (let b in room.selectedBoards) {
            if (room.selectedBoards[b] === socket.id) {
                delete room.selectedBoards[b];
            }
        }

        room.selectedBoards[data.boardNumber] = socket.id;
        io.to(data.roomId).emit('boardSelected', { boardNumber: data.boardNumber, socket.id: socket.id });
        updateRoomStats(data.roomId);
    });

    // ጨዋታው ሲጀመር ቦርዱን በቋሚነት መያዝ
    socket.on('startPlayerGame', (data) => {
        let room = rooms[data.roomId];
        if (!room) return;
        room.selectedBoards[data.boardNumber] = socket.id;
        io.to(data.roomId).emit('boardSelected', { boardNumber: data.boardNumber, socket.id: socket.id });
        updateRoomStats(data.roomId);
    });

    // ቢንጎ ማሸነፉን ማረጋገጥ
    socket.on('claimBingo', (data) => {
        let room = rooms[data.roomId];
        if (!room || room.status !== 'playing') return;

        room.status = 'finished';
        let winnerUser = users[data.identifier];
        let winnerName = winnerUser ? winnerUser.name : 'ተጫዋች';
        let prize = data.winAmount;

        // አሸናፊውን ባላንስ መጨመር
        if (winnerUser) {
            winnerUser.balance += prize;
        }

        // ለሁሉም ተጫዋቾች ማሳወቂያ መላክ (የአሸናፊው ስም፣ ቦርድ እና ሽልማት)
        io.to(data.roomId).emit('gameOver', {
            message: `🎉 እንኳን ደስ አለዎት! ${winnerName} በቦርድ ቁጥር ${data.boardNumber || '--'} አሸንፈዋል! (ሽልማት: ${prize.toFixed(2)} ብር)`
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

// የክፍል ሰከንድ ቆጣሪ እና የቁጥር መጥሪያ
function startRoomCountdown(roomId) {
    let room = rooms[roomId];
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

// ኳሶችን በየቅደም ተከተሉ መጥራት
function startCallingNumbers(roomId) {
    let room = rooms[roomId];
    let availableNumbers = Array.from({length: 75}, (_, i) => i + 1);
    // ቁጥሮችን መቀላቀል
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
    }, 3000); // በግልጽ በልዩ ሶስት ሰከንድ ልዩነት ይጠራል
}

// የስታቲስቲክስ እና የደርሽ (Pot) ማሻሻያ ለሁሉም መላክ
function updateRoomStats(roomId) {
    let room = rooms[roomId];
    if (!room) return;
    let activeBoardsCount = Object.keys(room.selectedBoards).length;
    let currentDerash = activeBoardsCount * room.betAmount * 0.85; // 85% ለደርሽ

    io.to(roomId).emit('roomStatsUpdate', {
        activePlayers: room.players.size,
        activeBoards: activeBoardsCount,
        derash: currentDerash
    });
}

http.listen(3000, () => {
    console.log('Server is running on port 3000');
});
