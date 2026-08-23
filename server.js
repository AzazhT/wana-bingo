function startGlobalLobbyCountdown(roomId) {
    let room = activeRooms[roomId];
    if (!room) return;

    if (room.timer) clearInterval(room.timer);

    room.timer = setInterval(() => {
        if (room.status !== 'waiting') return;

        room.countdown--;

        // --- ፌክ ተጫዋቾች (Bots) በዘፈቀደ ቦርድ የሚመርጡበት ሎጂክ ---
        // ለምሳሌ ከጠቅላላው የቦርድ ብዛት (ከ 1 እስከ 100 እንበል) ቦቶች ያልተያዙትን በሰዓቱ ሂደት ይይዛሉ
        let totalPossibleBoards = 100; // በሳይትህ ላይ ያሉት የቦርዶች ብዛት (ለምሳሌ 100 ከሆን)
        let targetBotSelections = Math.floor((30 - room.countdown) * 1.5); // በሰዓቱ ሂደት ቦቶች እየጨመሩ ይመርጣሉ
        let currentSelectedCount = Object.keys(room.selectedBoards).length;

        if (currentSelectedCount < targetBotSelections && currentSelectedCount < totalPossibleBoards) {
            let randomBoard;
            let attempts = 0;
            do {
                randomBoard = Math.floor(Math.random() * totalPossibleBoards) + 1;
                attempts++;
            } while (room.selectedBoards[randomBoard] && attempts < 20);

            // ቦቱ ቦርዱን እንደመረጠ ተደርጎ ይመዝገብ (ለየት ያለ መለያ ለምሳሌ 'BOT_')
            if (!room.selectedBoards[randomBoard]) {
                let botId = `BOT_${Math.floor(Math.random() * 10000)}`;
                room.selectedBoards[randomBoard] = botId;

                // ለሁሉም በክፍሉ ውስጥ ለሚገኙ ተጫዋቾች ቦርዱ መያዙን እናሳውቃለን
                io.to(roomId).emit('boardSelected', { boardNumber: randomBoard, socketId: botId });
            }
        }
        // ----------------------------------------------------

        let currentPrizePool = calculatePrizePool(room);

        io.to(roomId).emit('countdownUpdate', { 
            countdown: room.countdown, 
            playersCount: room.players.size,
            activePlayersCount: getActivePlayersCount(room),
            prizePool: currentPrizePool,
            startTime: room.startTime 
        });

        if (room.countdown <= 0) {
            let selectedBoardsCount = Object.keys(room.selectedBoards).length;

            if (room.players.size < 1 || selectedBoardsCount < 1) {
                room.countdown = 30;
                room.startTime = Date.now() + 30000;
                io.to(roomId).emit('notification', { message: 'በቂ ተጫዋች ወይም የተመረጠ ቦርድ ስለሌለ ሰዓቱ እንደገና ከ 30 ጀምሮ ቆጠራ ጀምሯል...' });
            } else {
                startRoomGame(roomId);
            }
        }
    }, 1000);
}
