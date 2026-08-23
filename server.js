const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// ሚድልዌር (Middleware)
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'))); // የፍሮንትንድ ፋይሎች የሚቀመጡበት ፎልደር (ካለ)

// ማከማቻዎች (Storages)
const activeRooms = {}; // የክፍሎች መረጃ

//  helper functions (የጎደሉትን እዚህ ማካተት ይቻላል)
function calculatePrizePool(room) {
    let count = Object.keys(room.selectedBoards).length;
    return count * 20 * 0.90; // በቆመበት የ ಬೆት መጠን መሰረት
}

function getActivePlayersCount(room) {
    return room.players ? room.players.size : 0;
}

function startRoomGame(roomId) {
    let room = activeRooms[roomId];
    if (!room) return;
    room.status = 'playing';
    io.to(roomId).emit('gameStarted', { prizePool: calculatePrizePool(room) });
}

// የላከው የሰዓት ቆጠራ ተግባር
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
                io.to(roomId).emit('boardSelected', { boardNumber: randomBoard, socketId: botId });
            }
        }

        let currentPrizePool = calculatePrizePool(room);

        io.to(roomId).emit('countdownUpdate', { 
            countdown: room.countdown, 
            playersCount: room.players ? room.players.size : 0,
            activePlayersCount: getActivePlayersCount(room),
            prizePool: currentPrizePool,
            startTime: room.startTime 
        });

        if (room.countdown <= 0) {
            let selectedBoardsCount = Object.keys(room.selectedBoards).length;

            if ((room.players ? room.players.size : 0) < 1 || selectedBoardsCount < 1) {
                room.countdown = 30;
                room.startTime = Date.now() + 30000;
                io.to(roomId).emit('notification', { message: 'በቂ ተጫዋች ወይም የተመረጠ ቦርድ ስለሌለ ሰዓቱ እንደገና ከ 30 ጀምሮ ቆጠራ ጀምሯል...' });
            } else {
                startRoomGame(roomId);
            }
        }
    }, 1000);
}

//  ሶኬት ግንኙነት (Socket.io Connection)
io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('joinLobby', (data) => {
        let roomId = 'room_1'; // ነባሪ ክፍል
        if (!activeRooms[roomId]) {
            activeRooms[roomId] = {
                status: 'waiting',
                countdown: 30,
                startTime: Date.now() + 30000,
                players: new Set(),
                selectedBoards: {},
                timer: null
            };
            startGlobalLobbyCountdown(roomId);
        }

        socket.join(roomId);
        activeRooms[roomId].players.add(socket.id);

        socket.emit('assignedRoom', {
            roomId: roomId,
            startTime: activeRooms[roomId].startTime,
            countdown: activeRooms[roomId].countdown,
            selectedBoards: activeRooms[roomId].selectedBoards,
            derashAmount: calculatePrizePool(activeRooms[roomId]),
            activePlayersCount: getActivePlayersCount(activeRooms[roomId])
        });
    });

    socket.on('selectBoardTemp', (data) => {
        let room = activeRooms[data.roomId];
        if (room && room.status === 'waiting') {
            room.selectedBoards[data.boardNumber] = socket.id;
            io.to(data.roomId).emit('boardSelected', { boardNumber: data.boardNumber, socketId: socket.id });
        }
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        // ከተጫዋቹ ጋር የተያዙ ቦርዶችን መልቀቅ ካፈለግን እዚህ እንሰራዋለን
    });
});

// ሰርቨሩ የሚነሳበት ፖርት (Render ወይም Localhost እንዲሰራ process.env.PORT ይጠቀማል)
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
