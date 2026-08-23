const express = require('http');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// የ 3 ራውንዶች የሰርቨር ስቴት አስተዳደር (Multi-Round Lobby State)
const rounds = {
    1: { id: 1, status: 'waiting', timer: 30, selectedNumbers: {}, players: [] },
    2: { id: 2, status: 'idle', timer: 30, selectedNumbers: {}, players: [] },
    3: { id: 3, status: 'idle', timer: 30, selectedNumbers: {}, players: [] }
};

// የሰርቨር ቆጠራ (Timers) ማከማቻ
const roundTimers = {};

// ራውንድ እንዲጀምር ወይም ቆጠራ እንዲቀጥል የሚያደርግ ፋንክሽን
function startRoundTimer(roundId) {
    if (roundTimers[roundId]) clearInterval(roundTimers[roundId]);

    roundTimers[roundId] = setInterval(() => {
        const round = rounds[roundId];
        if (round.status === 'waiting') {
            round.timer--;
            io.emit('timerUpdate', { roundId: round.id, timer: round.timer });

            if (round.timer <= 0) {
                clearInterval(roundTimers[roundId]);
                startActiveGame(roundId);
            }
        }
    }, 1000);
}

// 30 ሰከንዱ አልቆ ጨዋታው ሲጀምር
function startActiveGame(roundId) {
    const round = rounds[roundId];
    round.status = 'playing';
    io.emit('gameStarted', { roundId: round.id });

    // ቀጣዩ ራውንድ በራስ-ሰር ክፍት እንዲሆን ማድረግ (Waiting እንዲገባ)
    let nextRoundId = roundId + 1;
    if (nextRoundId > 3) nextRoundId = 1; // ሉፕ (Loop back to 1)

    const nextRound = rounds[nextRoundId];
    if (nextRound.status === 'idle') {
        nextRound.status = 'waiting';
        nextRound.timer = 30;
        nextRound.selectedNumbers = {};
        startRoundTimer(nextRoundId);
        io.emit('newRoundOpened', { roundId: nextRoundId });
    }

    // የጨዋታው ጊዜ (ለምሳሌ ጨዋታው ተጫውቶ ሲያልቅ - በምሳሌነት 30 ሰከንድ ቆይታ ተሰጥቷል)
    setTimeout(() => {
        handleRoundCompletion(roundId);
    }, 30000); 
}

// ራውንድ ሲያልቅ (የ 3 ሰከንድ Clear ቆይታ)
function handleRoundCompletion(finishedRoundId) {
    const round = rounds[finishedRoundId];
    round.status = 'clearing';
    round.selectedNumbers = {};
    round.players = [];

    // ቦርዱ ለ 3 ሰከንድ ባዶ (Clear) ሆኖ እንዲቆይ ለተጫዋቾች ማሳወቅ
    io.emit('roundClearing', { 
        roundId: finishedRoundId, 
        message: `ራውንድ ${finishedRoundId} አልቋል፤ ቦርዱ ለ 3 ሰከንድ ባዶ ሆኖ ይቆያል...` 
    });

    setTimeout(() => {
        round.status = 'idle';
        io.emit('boardCleared', { roundId: finishedRoundId });

        // ሁለቱም ቀጣይ ራውንዶች አድል ሰጥተው ከጨረሱ፣ ይህኛው ራውንድ እንደገና 'waiting' ሆኖ ሊከፈት ይችላል
        // ሰርቨሩ ሁልጊዜ ቢያንስ አንድ ራውንድ ክፍት (Waiting) መኖሩን ያረጋግጣል
        checkAndEnsureActiveLobby();
    }, 3000); // 3 ሰከንድ ማቆያ
}

// ሁልጊዜ ቢያንስ አንድ ራውንድ ክፍት መሆኑን ማረጋገጫ
function checkAndEnsureActiveLobby() {
    const activeWaiting = Object.values(rounds).find(r => r.status === 'waiting');
    if (!activeWaiting) {
        // ምንም Waiting ራውንድ ከሌለ፣ Idle የሆነውን ወደ waiting መቀየር
        const idleRound = Object.values(rounds).find(r => r.status === 'idle');
        if (idleRound) {
            idleRound.status = 'waiting';
            idleRound.timer = 30;
            idleRound.selectedNumbers = {};
            startRoundTimer(idleRound.id);
            io.emit('newRoundOpened', { roundId: idleRound.id });
        }
    }
}

// የሶኬት ግንኙነቶች
io.on('connection', (socket) => {
    console.log('አዲስ ተጠቃሚ ተገናኝቷል:', socket.id);

    // ተጠቃሚው ወደ ሲስተሙ ሲገባ የሚገኝበትን ክፍት ራውንድ መጠየቅ
    socket.on('joinGame', () => {
        const availableRound = Object.values(rounds).find(r => r.status === 'waiting');

        if (!availableRound) {
            // ሶስቱም ራውንዶች ሞልተው አክቲቭ ከሆኑ
            socket.emit('gameNotification', { 
                type: 'BUSY', 
                message: 'ጨዋታ እየተካሄደ ነው፣ እባክዎ ትንሽ ይጠብቁ' 
            });
            return;
        }

        socket.join(`round_${availableRound.id}`);
        availableRound.players.push(socket.id);
        
        socket.emit('joinedRound', { 
            roundId: availableRound.id, 
            timer: availableRound.timer,
            selectedNumbers: availableRound.selectedNumbers 
        });
    });

    // ቁጥር ሲመርጥ
    socket.on('selectNumber', (data) => {
        const { roundId, number } = data;
        const round = rounds[roundId];

        if (round && round.status === 'waiting') {
            round.selectedNumbers[number] = socket.id;
            io.emit('numberSelected', { roundId, number, socketId: socket.id });
        }
    });

    socket.on('disconnect', () => {
        console.log('ተጠቃሚ ወጥቷል:', socket.id);
    });
});

// የመጀመሪያውን ራውንድ በማስጀመር ሰርቨሩን መክፈት
rounds[1].status = 'waiting';
startRoundTimer(1);

server.listen(3000, () => {
    console.log('ሰርቨሩ በ 3000 ፖርት እየሰራ ነው...');
});
