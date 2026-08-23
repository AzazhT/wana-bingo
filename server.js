const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static('public')); // ወይም የስታቲክ ፋይሎች ማከማቻ ማውጫዎ

// የክፍሎች እና ተጫዋቾች መረጃ ማከማቻ
const activeRooms = {};

// ----------------- የደህንነት ጥበቃ (Render Crashes እንዳይፈጥር) -----------------
process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception occurred:', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});
// --------------------------------------------------------------------------

function calculatePrizePool(room) {
    let count = Object.keys(room.selectedBoards || {}).length;
    return count * 20 * 0.90; // እንደ ቤቱ መጠን ሊስተካከል ይችላል
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

// 🤖 የглоባል ሎቢ እና ቦቶች ቆጠራ ሎጂክ
function startGlobalLobbyCountdown(roomId) {
    let room = activeRooms[roomId];
    if (!room) return;

    if (room.timer) clearInterval(room.timer);

    room.timer = setInterval(() => {
        if (!room || room.status !== 'waiting') return;

        room.countdown--;

        // --- ፌክ ተጫዋቾች (Bots) በዘፈቀደ ቦርድ የሚመርጡበት ሎጂክ ---
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

                // ለሁሉም በክፍሉ ውስጥ ለሚገኙ ተጫዋቾች ቦርዱ በቦት መያዙን እናሳውቃለን[cite: 6]
                io.to(roomId).emit('boardSelected', { boardNumber: randomBoard, socketId: botId });
            }
        }
        // ----------------------------------------------------

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

            if (!room.players || room.players.size < 1 || selectedBoardsCount < 1) {
                room.countdown = 30;
                room.startTime = Date.now() + 30000;
                io.to(roomId).emit('notification', { message: 'በቂ ተጫዋች ወይም የተመረጠ ቦርድ ስለሌለ ሰዓቱ እንደገና ከ 30 ጀምሮ ቆጠራ ጀምሯል...' });
            } else {
                startRoomGame(roomId);
            }
        }
    }, 1000);
}

// Socket.io ግንኙነት
io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    // ተጫዋቹ ሎቢ ሲቀላቀል
    socket.on('joinLobby', (data) => {
        let roomId = 'room_1'; // እንደ አስፈላጊነቱ መቀየር ይቻላል
        
        if (!activeRooms[roomId]) {
            activeRooms[roomId] = {
                roomId: roomId,
                status: 'waiting',
                countdown: 30,
                startTime: Date.now() + 30000,
                players: new Set(),
                selectedBoards: {},
                timer: null
            };
            startGlobalLobbyCountdown(roomId);
        }

        let room = activeRooms[roomId];
        room.players.add(socket.id);
        socket.join(roomId);

        // 👈 የተያዙ ቦርዶች በሙሉ (ቦቶቹን ጨምሮ) ወደ ክላይንት ይላካሉ
        socket.emit('assignedRoom', {
            roomId: roomId,
            startTime: room.startTime,
            countdown: room.countdown,
            selectedBoards: room.selectedBoards, 
            derashAmount: calculatePrizePool(room),
            activePlayersCount: getActivePlayersCount(room)
        });

        io.to(roomId).emit('playersUpdate', {
            activePlayersCount: getActivePlayersCount(room),
            derashAmount: calculatePrizePool(room)
        });
    });

    // ተጫዋቹ ቦርድ ሲመርጥ
    socket.on('selectBoardTemp', (data) => {
        let { roomId, boardNumber } = data;
        let room = activeRooms[roomId];
        if (!room) return;

        if (room.selectedBoards[boardNumber] && room.selectedBoards[boardNumber] !== socket.id) {
            socket.emit('boardSelectError', { message: 'ይህ ቦርድ ቀድሞ ተይዟል!' });
            return;
        }

        room.selectedBoards[boardNumber] = socket.id;
        io.to(roomId).emit('boardSelected', { boardNumber: boardNumber, socketId: socket.id });
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        for (let roomId in activeRooms) {
            let room = activeRooms[roomId];
            if (room.players) {
                room.players.delete(socket.id);
            }
            // ተጫዋቹ ሲወጣ የያዘውን ቦርድ መልቀቅ ከፈለጉ
            for (let boardNum in room.selectedBoards) {
                if (room.selectedBoards[boardNum] === socket.id) {
                    delete room.selectedBoards[boardNum];
                    io.to(roomId).emit('boardReleased', { boardNumber: boardNum });
                }
            }
        }
    });
});

// ለ Render ፖርት አቀማመጥ ትክክለኛ ውቅር
const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
