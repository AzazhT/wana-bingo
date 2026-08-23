const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// የ 3 ራውንዶች የሰርቨር ስቴት አስተዳደር
const rounds = {
    1: { id: 1, status: 'waiting', timer: 30, selectedNumbers: {}, players: [] },
    2: { id: 2, status: 'idle', timer: 30, selectedNumbers: {}, players: [] },
    3: { id: 3, status: 'idle', timer: 30, selectedNumbers: {}, players: [] }
};

const roundTimers = {};

// ቆጠራን ማስጀመር (ለ waiting ራውንዶች)
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

// 30 ሰከንዱ አልቆ ጨዋታው ሲጀምር የሚፈጸም
function startActiveGame(roundId) {
    const round = rounds[roundId];
    round.status = 'playing';
    io.emit('gameStarted', { roundId: round.id });

    // **እዚህ ጋር ነው ዋናው ለውጥ:** 
    // አንደኛው ራውንድ ጨዋታውን ሲጀምር፣ ሌላው ራውንድ ሌላ ጨዋታ (Lobby) እንዲከፍት ወዲያው እናደርጋለን!
    openNextAvailableRound(roundId);

    // የጨዋታው ቆይታ (ለምሳሌ 30 ሰከንድ ቆይቶ እንዲያልቅ ከፈለጉ)
    setTimeout(() => {
        handleRoundCompletion(roundId);
    }, 30000); 
}

// ቀጣዩን ራውንድ አዲስ ጨዋታ እንዲሆን አድርጎ የሚከፍት ፋንክሽን
function openNextAvailableRound(currentRoundId) {
    let nextRoundId = currentRoundId + 1;
    if (nextRoundId > 3) nextRoundId = 1;

    const nextRound = rounds[nextRoundId];
    
    // ቀጣዩ ራውንድ idle ወይም ከዚህ ቀደም ጨርሶ ከነበረ አዲስ ራውንድ አድርገን እንከፍተዋለን
    nextRound.status = 'waiting';
    nextRound.timer = 30;
    nextRound.selectedNumbers = {};
    nextRound.players = [];

    startRoundTimer(nextRoundId);
    io.emit('newRoundOpened', { roundId: nextRoundId });
}

// ራውንድ ሲያልቅ (የ 3 ሰከንድ ባዶ ሆኖ የመቆየት ሂደት)
function handleRoundCompletion(finishedRoundId) {
    const round = rounds[finishedRoundId];
    round.status = 'clearing';
    round.selectedNumbers = {};
    round.players = [];

    io.emit('roundClearing', { 
        roundId: finishedRoundId, 
        message: `ራውንድ ${finishedRoundId} አልቋል፤ ቦርዱ ለ 3 ሰከንድ ባዶ ሆኖ ይቆያል...` 
    });

    setTimeout(() => {
        round.status = 'idle';
        io.emit('boardCleared', { roundId: finishedRoundId });
    }, 3000); 
}

// የሶኬት ግንኙነቶች
io.on('connection', (socket) => {
    console.log('አዲስ ተጠቃሚ ተገናኝቷል:', socket.id);

    // ተጠቃሚው ሲገባ ሁልጊዜ አሁን ክፍት ወደሆነው (Waiting) ራውንድ ይመደባል
    socket.on('joinGame', () => {
        let availableRound = Object.values(rounds).find(r => r.status === 'waiting');

        // ምንም waiting ራውንድ ከሌለ (ሁሉም እየተጫወቱ ወይም clearing ላይ ከሆኑ) 
        // የመጀመሪያውን ራውንድ ወይም idle የሆነውን አስገዳጅ በመክፈት አዲስ ጌም እንፈጥራለን
        if (!availableRound) {
            let idleRound = Object.values(rounds).find(r => r.status === 'idle');
            if (!idleRound) idleRound = rounds[1]; // ከጠፋ ወደ 1ኛ እናመራለን

            idleRound.status = 'waiting';
            idleRound.timer = 30;
            idleRound.selectedNumbers = {};
            startRoundTimer(idleRound.id);
            availableRound = idleRound;
            
            io.emit('newRoundOpened', { roundId: availableRound.id });
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

// ሰርቨሩ ሲጀምር የመጀመሪያውን ራውንድ መክፈት
rounds[1].status = 'waiting';
startRoundTimer(1);

server.listen(3000, () => {
    console.log('ሰርቨሩ በ 3000 ፖርት እየሰራ ነው...');
});
