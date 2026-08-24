// --- MULTI-ROOM & CONTINUOUS ROUND MANAGEMENT (MAX 3 GAMES STRICT LIMIT) ---
let activeRooms = {}; 

// === አዲስ ፈንክሽን: አጠቃላይ እየተጫወቱ ያሉ ጫወታዎችን ቁጥር ለመቁጠር ===
function getActiveGamesCount() {
    return Object.values(activeRooms).filter(r => r.status === 'waiting' || r.status === 'playing').length;
}

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
    let roomId = null;
    // እየጠበቀ (waiting) ላለ ክፍል ብቻ ነው የምናገኘው
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
            currentRound: 1, 
            maxRounds: 3,
            players: new Set(),
            playerNames: {},
            reservedNumbers: {}, 
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

function resetRoomForNextRound(roomId) {
    let room = activeRooms[roomId];
    if (!room) return;

    room.drawnNumbers = [];
    room.reservedNumbers = {};
    room.selectedBoards = {}; 
    room.tempSelections = {};
    room.status = 'waiting';
    room.countdown = 30;
    room.startTime = Date.now() + 30000;

    io.to(roomId).emit('roomResetForNextRound', {
        currentRound: room.currentRound,
        maxRounds: room.maxRounds,
        countdown: room.countdown,
        startTime: room.startTime,
        selectedBoards: room.selectedBoards
    });

    startGlobalLobbyCountdown(roomId);
}

function startGlobalLobbyCountdown(roomId) {
    let room = activeRooms[roomId];
    if (!room) return;

    if (room.timer) clearInterval(room.timer);

    room.timer = setInterval(() => {
        if (room.status !== 'waiting') return;

        room.countdown--;

        // Bot auto-selection logic (እንደነበረ ይቀጥላል)
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
            startTime: room.startTime,
            currentRound: room.currentRound,
            maxRounds: room.maxRounds
        });

        // === አዲስ ሎጂክ: 30 ሴኮንድ ሲያልቅ ጫወታውን ራሱ ይጀምራል ===
        if (room.countdown <= 0) {
            let selectedBoardsCount = Object.keys(room.selectedBoards).length;

            if (room.players.size < 1 || selectedBoardsCount < 1) {
                room.countdown = 30;
                room.startTime = Date.now() + 30000;
                io.to(roomId).emit('notification', { message: 'በቂ ተጫዋች ወይም የተመረጠ ቦርድ ስለሌለ ሰዓቱ እንደገና ከ 30 ጀምሮ ቆጠራ ጀምሯል...' });
            } else {
                startRoomGame(roomId); // ጫወታውን ይጀምራል
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

    for(let r=0; r<5; r++) {
        if([0,1,2,3,4].every(c => marked[r][c])) return { type: 'row', index: r };
    }
    for(let c=0; c<5; c++) {
        if([0,1,2,3,4].every(r => marked[r][c])) return { type: 'col', index: c };
    }
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

// === አዲስ ሎጂክ: ጫወታ ሲያልቅ ክፍሉን ከሜሞሪ ማጥፋት (ቦታ ለአዲስ ጫወታ ይከፍታል) ===
function cleanupRoom(roomId) {
    if (activeRooms[roomId]) {
        if (activeRooms[roomId].timer) clearInterval(activeRooms[roomId].timer);
        if (activeRooms[roomId].gameInterval) clearInterval(activeRooms[roomId].gameInterval);
        delete activeRooms[roomId];
        console.log(`✅ Room ${roomId} cleaned up. Active games now: ${getActiveGamesCount()}`);
    }
}

function handleNextRoundOrFinish(roomId) {
    let room = activeRooms[roomId];
    if (!room) return;

    if (room.currentRound < room.maxRounds) {
        room.currentRound++; 
        resetRoomForNextRound(roomId);
    } else {
        io.to(roomId).emit('roomFinished', { message: '3ቱም ራውንዶች ተጠናቀዋል! ክፍሉ ተዘግቷል።' });
        // ከ 5 ሴኮንድ በኋላ ክፍሉን ያጥፋል (Frontend ሞዳሉን እንዲያሳይ ጊዜ ለመስጠት)
        setTimeout(() => cleanupRoom(roomId), 5000);
    }
}

function startRoomGame(roomId) {
    let room = activeRooms[roomId];
    if (!room) return;

    room.status = 'playing'; // === ይህ መስመር አዲስ መግባትን ይከለክላል ===
    if (room.timer) clearInterval(room.timer);
    
    let finalPrizePool = calculatePrizePool(room);
    io.to(roomId).emit('gameStarted', { 
        message: 'ጨዋታው ተጀምሯል!',
        prizePool: finalPrizePool,
        currentRound: room.currentRound,
        maxRounds: room.maxRounds
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
            io.to(roomId).emit('gameOver', { message: 'ጨዋታው አልቋል! 75ቱ ቁጥሮች ተጠርተዋል አሸናፊ አልተገኘም።' });
            setTimeout(() => {
                handleNextRoundOrFinish(roomId);
            }, 5000);
            return;
        }

        let rand;
        do {
            rand = Math.floor(Math.random() * 75) + 1;
        } while (room.drawnNumbers.includes(rand));

        room.drawnNumbers.push(rand);
        io.to(roomId).emit('numberDrawn', { number: rand, drawnHistory: room.drawnNumbers });

        // Check bot wins
        for (let botId in roomBotCards) {
            let botData = roomBotCards[botId];
            let winningLine = findWinningLine(botData.card, room.drawnNumbers);
            if (winningLine) {
                clearInterval(room.gameInterval);
                room.status = 'ended';

                let botWinAmount = finalPrizePool;
                let botName = room.playerNames[botId] || "Kenbo-Bot";

                // === አዲስ ሎጂክ: ውጤቱ ለዚህ ክፍል (roomId) ብቻ ይላካል (Isolated Win) ===
                io.to(roomId).emit('gameOver', { 
                    subtitle: '1 player has won the game',
                    winnerName: botName,
                    boardNumber: botData.boardNumber,
                    winAmount: botWinAmount,
                    winningLine: winningLine
                });

                setTimeout(() => {
                    handleNextRoundOrFinish(roomId);
                }, 5000);
                return;
            }
        }
    }, 3000);
}

// --- SOCKET.IO CONNECTIONS ---
io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('joinLobby', (data) => {
        const betAmount = data && data.betAmount ? data.betAmount : '20';
        
        // === አዲስ ሎጂክ 1: ከ 3 በላይ ጫወታዎች ካሉ አዲስ መግባት አይቻልም ===
        if (getActiveGamesCount() >= 3) {
            return socket.emit('lobbyFull', { message: "3 ጫወታዎች እየተጫወቱ ነው። አንዱ እስኪያልቅ እባክዎ ይጠብቁ!" });
        }

        let room = getOrCreateLobby(betAmount);

        // === አዲስ ሎጂክ 2: ጫወታው ከጀመረ በኋላ መግባት አለመቻል ===
        if (room.status === 'playing' || room.status === 'ended') {
            return socket.emit('gameAlreadyStarted', { message: 'ጨዋታው ኦሬዲ ጀምሯል! እባክዎ ቀጣዩን ጨዋታ ይጠብቁ።' });
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
            reservedNumbers: room.reservedNumbers,
            selectedBoards: room.selectedBoards,
            activePlayersCount: getActivePlayersCount(room),
            prizePool: currentPrizePool,
            currentRound: room.currentRound,
            maxRounds: room.maxRounds
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
                return socket.emit('boardSelectError', { message: 'ይህ ቦርድ ቁጥር አስቀድሞ በሌላ ተጫዋች ወይም በቦት ተይዟል!' });
            }

            if (!room.tempSelections) room.tempSelections = {};
            room.tempSelections[socket.id] = boardNumber;

            socket.emit('boardTempSelected', { boardNumber });
        } else if (room && room.status === 'playing') {
            socket.emit('gameAlreadyStarted', { message: 'ጨዋታው ኦሬዲ ጀምሯል!' });
        }
    });

    socket.on('startPlayerGame', (data) => {
        const { roomId, boardNumber, name } = data;
        let room = activeRooms[roomId];

        if (room && room.status === 'waiting') {
            if (room.selectedBoards[boardNumber]) {
                return socket.emit('boardSelectError', { message: 'ይህ ቦርድ ቁጥር አስቀድሞ በሌላ ተጫዋች ወይም በቦት ተይዟል!' });
            }

            let previousBoard = null;
            for (let bNum in room.selectedBoards) {
                if (room.selectedBoards[bNum] === socket.id) {
                    previousBoard = bNum;
                    delete room.selectedBoards[bNum];
                }
            }

            if (previousBoard) {
                io.to(roomId).emit('boardReleased', { boardNumber: previousBoard });
            }

            room.selectedBoards[boardNumber] = socket.id;
            room.playerNames[socket.id] = name || 'Player';

            if (room.tempSelections && room.tempSelections[socket.id]) {
                delete room.tempSelections[socket.id];
            }
            
            let currentPrizePool = calculatePrizePool(room);

            io.to(roomId).emit('boardSelected', { boardNumber, socketId: socket.id });
            io.to(roomId).emit('activePlayersUpdate', { 
                activePlayersCount: getActivePlayersCount(room),
                prizePool: currentPrizePool 
            });

            socket.emit('gameJoinSuccess', { boardNumber, prizePool: currentPrizePool });
        } else if (room && room.status === 'playing') {
            socket.emit('gameAlreadyStarted', { message: 'ጨዋታው ኦሬዲ ጀምሯል!' });
        }
    });

    socket.on('claimBingo', async (data) => {
        const { identifier, name, winAmount, roomId, boardNumber, winningLine } = data;
        let room = activeRooms[roomId];
        
        if (room && room.status === 'playing') {
            room.status = 'ended'; // ጨዋታውን ያቆማል
            if (room.gameInterval) clearInterval(room.gameInterval);
            if (room.timer) clearInterval(room.timer);

            let finalWinAmount = calculatePrizePool(room) || winAmount;

            try {
                const userRes = await pool.query('SELECT balance FROM users WHERE identifier = $1', [identifier]);
                if (userRes.rows.length > 0) {
                    let newBal = parseFloat(userRes.rows[0].balance) + parseFloat(finalWinAmount);
                    await pool.query('UPDATE users SET balance = $1 WHERE identifier = $2', [newBal, identifier]);
                    
                    // === አዲስ ሎጂክ: ውጤቱ ለዚህ ሩም ብቻ ይላካል ===
                    io.to(roomId).emit('gameOver', { 
                        subtitle: 'እንኳን ደስ አለዎት! አሸንፈዋል!',
                        winnerName: name || room.playerNames[socket.id] || 'Winner',
                        boardNumber: boardNumber,
                        winAmount: finalWinAmount,
                        winningLine: winningLine
                    });

                    // ከ 5 ሴኮንድ በኋላ ራውንዱን ያሻሽላል ወይም ያጠፋል
                    setTimeout(() => {
                        handleNextRoundOrFinish(roomId);
                    }, 5000);
                }
            } catch (err) {
                console.error('Bingo claim error:', err);
            }
        }
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        for (let roomId in activeRooms) {
            let room = activeRooms[roomId];
            if (room.players.has(socket.id)) {
                room.players.delete(socket.id);
                delete room.playerNames[socket.id];
                
                if (room.tempSelections && room.tempSelections[socket.id]) {
                    delete room.tempSelections[socket.id];
                }

                let boardReleasedFlag = false;
                if (room.status === 'waiting') {
                    for (let bNum in room.selectedBoards) {
                        if (room.selectedBoards[bNum] === socket.id) {
                            delete room.selectedBoards[bNum];
                            boardReleasedFlag = true;
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

                if (boardReleasedFlag) {
                    io.to(roomId).emit('activePlayersUpdate', { 
                        activePlayersCount: getActivePlayersCount(room),
                        prizePool: currentPrizePool 
                    });
                }
            }
        }
    });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, `0.0.0.0`, () => {
    console.log(`Server running on port ${PORT}`);
});
