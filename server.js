const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static('public'));

let activeRooms = {};

function getOrCreateLobby(betAmount) {
    let roomId = `ROOM_${betAmount}`;
    if (!activeRooms[roomId]) {
        activeRooms[roomId] = {
            roomId,
            betAmount,
            status: 'waiting',
            players: new Set(),
            selectedBoards: {},
            drawnNumbers: [],
            gameInterval: null
        };
    }
    return activeRooms[roomId];
}

function startRoomGame(roomId) {
    let room = activeRooms[roomId];
    if (!room || room.status === 'playing') return;

    room.status = 'playing';
    room.drawnNumbers = [];

    room.gameInterval = setInterval(() => {
        if (room.drawnNumbers.length >= 75) {
            clearInterval(room.gameInterval);
            io.to(roomId).emit('gameOver', { winnerName: "ማንም", boardNumber: "-", winAmount: 0 });
            room.status = 'waiting';
            return;
        }

        let rand;
        do {
            rand = Math.floor(Math.random() * 75) + 1;
        } while (room.drawnNumbers.includes(rand));

        room.drawnNumbers.push(rand);
        io.to(roomId).emit('numberDrawn', { number: rand, drawnHistory: room.drawnNumbers });
    }, 3000); // በየ 3 ሰከንዱ ቁጥር ይጠራል
}

io.on('connection', (socket) => {
    socket.on('joinLobby', (data) => {
        let room = getOrCreateLobby(data.betAmount || 20);
        socket.join(room.roomId);
        room.players.add(socket.id);

        socket.emit('assignedRoom', {
            roomId: room.roomId,
            selectedBoards: room.selectedBoards
        });
    });

    socket.on('startPlayerGame', (data) => {
        let room = activeRooms[data.roomId];
        if (room) {
            room.selectedBoards[data.boardNumber] = socket.id;
            io.to(data.roomId).emit('boardSelected', { boardNumber: data.boardNumber });
            
            // የመጀመሪያው ተጫዋች ሲገባ ጨዋታውን ያስጀምራል
            if (room.status === 'waiting') {
                startRoomGame(data.roomId);
            }
        }
    });

    socket.on('claimBingo', (data) => {
        let room = activeRooms[data.roomId];
        if (room && room.status === 'playing') {
            clearInterval(room.gameInterval);
            room.status = 'ended';

            let prizePool = Object.keys(room.selectedBoards).length * room.betAmount * 0.90;

            io.to(data.roomId).emit('gameOver', {
                winnerName: data.name,
                boardNumber: data.boardNumber,
                winAmount: prizePool.toFixed(2)
            });

            // አዲስ ዙር ለማዘጋጀት ሪሴት ማድረግ
            setTimeout(() => {
                room.status = 'waiting';
                room.selectedBoards = {};
                room.drawnNumbers = [];
            }, 5000);
        }
    });

    socket.on('disconnect', () => {
        for (let rId in activeRooms) {
            activeRooms[rId].players.delete(socket.id);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
