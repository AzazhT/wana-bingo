const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const TelegramBot = require('node-telegram-bot-api');
const pool = require('./database');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

app.use(express.json());
app.use(express.static('public'));

const TOKEN = '8957133551:AAGBPCGEzFLtJRXHRU0PfKJ2QXDf1AyvXec';
const ADMIN_CHAT_ID = '686733543';
const WEB_APP_URL = 'https://wana-bingo.onrender.com';

let bot = null;
if (TOKEN) {
    try {
        bot = new TelegramBot(TOKEN, {  
            polling: {
                interval: 300,
                autoStart: true,
                params: { timeout: 10 }
            } 
        });
        console.log('Telegram Bot started successfully!');
        bot.on('polling_error', (error) => {
            console.log(`Telegram Polling Error: ${error.code} - ${error.message}`);
        });
    } catch (err) {
        console.error('Telegram Bot initialization error:', err);
    }
} else {
    console.error('ERROR: Telegram Bot Token not provided!');
}

// REST APIs for User & Wallet
app.post('/api/get-user', async (req, res) => {
    const { identifier, name, username } = req.body;
    try {
        let userRes = await pool.query('SELECT * FROM users WHERE identifier = $1', [identifier]);
        let user;
        if (userRes.rows.length === 0) {
            const insertRes = await pool.query(
                'INSERT INTO users (identifier, name, username, balance) VALUES ($1, $2, $3, $4) RETURNING *',
                [identifier, name || 'Player', username || '', 0.00]
            );
            user = insertRes.rows[0];
        } else {
            user = userRes.rows[0];
        }
        res.json({ success: true, user });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.post('/api/update-phone', async (req, res) => {
    const { identifier, phone } = req.body;
    try {
        await pool.query('UPDATE users SET phone = $1 WHERE identifier = $2', [phone, identifier]);
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false });
    }
});

app.post('/api/place-bet', async (req, res) => {
    const { identifier, amount } = req.body;
    try {
        const userRes = await pool.query('SELECT balance FROM users WHERE identifier = $1', [identifier]);
        if (userRes.rows.length === 0) return res.json({ success: false, message: 'User not found' });
        
        let balance = parseFloat(userRes.rows[0].balance);
        if (balance < amount) return res.json({ success: false, message: 'በቂ ባላንስ የለዎትም!' });

        let newBalance = balance - amount;
        await pool.query('UPDATE users SET balance = $1 WHERE identifier = $2', [newBalance, identifier]);
        res.json({ success: true, newBalance });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.post('/api/request-transaction', async (req, res) => {
    const { identifier, type, amount, details } = req.body;
    const tx_id = 'TX' + Math.floor(100000 + Math.random() * 900000);
    
    try {
        if (type === 'WITHDRAW') {
            const userRes = await pool.query('SELECT balance FROM users WHERE identifier = $1', [identifier]);
            if (userRes.rows.length === 0) {
                return res.json({ success: false, message: 'ተጠቃሚው አልተገኘም' });
            }
            let currentBalance = parseFloat(userRes.rows[0].balance);
            if (currentBalance < parseFloat(amount)) {
                return res.json({ success: false, message: 'በዋሌትዎ ውስጥ ያለው ብር በቂ አይደለም!' });
            }
        }

        await pool.query(
            'INSERT INTO transactions (tx_id, identifier, type, amount, details, handled) VALUES ($1, $2, $3, $4, $5, FALSE)',
            [tx_id, identifier, type, amount, details || '']
        );

        const userRes = await pool.query('SELECT name, username, phone FROM users WHERE identifier = $1', [identifier]);
        const user = userRes.rows[0] || {};

        if (bot && ADMIN_CHAT_ID) {
            let adminMsg = `🔔 **አዲስ የ ${type} ጥያቄ መጥቷል!**\n\n` +
                           `🆔 TxID: ${tx_id}\n` +
                           `👤 ስም: ${user.name || 'Unknown'} (@${user.username || 'none'})\n` +
                           `📱 ስልክ: ${user.phone || 'N/A'}\n` +
                           `💰 መጠን: ${amount} ብር\n` +
                           `📝 መረጃ/ኤስኤምኤስ: ${details || 'N/A'}`;

            bot.sendMessage(ADMIN_CHAT_ID, adminMsg, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: '✅ አረጋግጥ (Approve)', callback_data: `approve_${tx_id}_${identifier}_${amount}` },
                            { text: '❌ ሰርዝ (Reject)', callback_data: `reject_${tx_id}` }
                        ]
                    ]
                }
            }).catch(err => console.error('Admin notify error:', err));
        }

        res.json({ success: true, tx_id });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'ሰርቨር ላይ ስህተት ተፈጥሯል' });
    }
});

// --- TELEGRAM BOT COMMANDS & ADMIN PANEL ---
if (bot) {
    bot.setMyCommands([
        { command: 'start', description: 'ቦቱን ለመጀመር' },
        { command: 'play', description: '🎮 Play Bingo (ጨዋታውን ክፈት)' },
        { command: 'balance', description: '💰 ቀሪ ሂሳብዎን ለማየት' },
        { command: 'deposit', description: '💳 የዲፖዚት መመሪያ' },
        { command: 'withdraw', description: '💸 ገንዘብ ወጪ ለማድረግ' }
    ]);

    bot.onText(/\/start/, (msg) => {
        const chatId = msg.chat.id;
        const name = msg.from.first_name;
        
        let welcomeMessage = `✨ **እንኳን ደህና መጡ!** ✨\n\n` +
                            `ሰላም **${name}**! ወደ 🏆 **ዋና ቢንጎ (Wana Bingo)** በሰላም መጡ。\n\n` +
                            `─────────────────────\n` +
                            `📌 **የቦቱ አገልግሎቶች እና ትዕዛዞች፡**\n\n` +
                            `🎮 /play - 🎲 ቢንጎን በቀጥታ ለመጫወት (Web App)\n` +
                            `💰 /balance - 💵 ቀሪ ሂሳብዎን ለማየት\n` +
                            `💳 /deposit - 📥 የዲፖዚት መመሪያዎችን ለማግኘት\n` +
                            `💸 /withdraw - 📤 ያሸነፉትን ገንዘብ ወጪ ለማድረግ\n` +
                            `─────────────────────`;

        if (chatId.toString() === ADMIN_CHAT_ID) {
            welcomeMessage += `\n\n👑 **የአድሚን መቆጣጠሪያ ፓነል፡**\n` +
                              `📊 /admin - አጠቃላይ ድምር መረጃዎችን ለማየት\n` +
                              `📋 /pending - የሚጠብቁ የገንዘብ ጥያቄዎችን ለማጽደቅ`;
        }

        bot.sendMessage(chatId, welcomeMessage, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🚀 ዋናውን ቢንጎ ጨዋታ ጀምር (Play Bingo) 🎮', web_app: { url: WEB_APP_URL } }]
                ]
            }
        });
    });

    bot.onText(/\/play/, (msg) => {
        const chatId = msg.chat.id;
        bot.sendMessage(chatId, `🎮 የቢንጎ ጨዋታውን ለመጀመር ከታች ያለውን ቁልፍ ይጫኑ፡`, {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🚀 Play Bingo Web App 🎮', web_app: { url: WEB_APP_URL } }]
                ]
            }
        });
    });

    bot.onText(/\/deposit/, (msg) => {
        const chatId = msg.chat.id;
        bot.sendMessage(chatId, `💳 **የዲፖዚት መመሪያ**\n\nበቴሌብር ወይም በባንክ ገንዘብ ገቢ በማድረግ በዌብሳይቱ (App) በኩል የዲፖዚት ጥያቄ ይላኩ።`, { parse_mode: 'Markdown' });
    });

    bot.onText(/\/withdraw/, (msg) => {
        const chatId = msg.chat.id;
        bot.sendMessage(chatId, `💸 **ገንዘብ ወጪ (Withdraw)**\n\nያሸነፉትን ገንዘብ ወጪ ለማድረግ እባክዎ ወደ ዌብሳይቱ በመግባት የ "Withdraw" ቅጹን ይሙሉ::`, { parse_mode: 'Markdown' });
    });

    bot.onText(/\/balance/, async (msg) => {
        const chatId = msg.chat.id;
        const username = msg.from.username || '';
        
        try {
            const userRes = await pool.query('SELECT balance, name FROM users WHERE username = $1 OR identifier = $2', [username, chatId.toString()]);
            if (userRes.rows.length > 0) {
                let user = userRes.rows[0];
                bot.sendMessage(chatId, `👤 ስም: ${user.name}\n💰 ቀሪ ባላንስዎ: ${user.balance} ብር`);
            } else {
                bot.sendMessage(chatId, `እባክዎ መጀመሪያ ዌብሳይቱ ላይ በመግባት አካውንት ይክፈቱ!`);
            }
        } catch (err) {
            console.error(err);
            bot.sendMessage(chatId, 'የሰርቨር ስህተት አጋጥሟል።');
        }
    });

    bot.onText(/\/admin/, async (msg) => {
        const chatId = msg.chat.id;
        if (chatId.toString() !== ADMIN_CHAT_ID) return bot.sendMessage(chatId, 'ይህንን ትዕዛዝ መጠቀም የሚችሉት አድሚኖች ብቻ ናቸው!');

        try {
            const usersRes = await pool.query('SELECT COUNT(*) FROM users');
            const totalUsers = usersRes.rows[0].count;

            const balanceRes = await pool.query('SELECT SUM(balance) FROM users');
            const totalBalance = balanceRes.rows[0].sum || 0;

            bot.sendMessage(chatId, `👑 **የአድሚን ዳሽቦርድ**\n\n👥 ጠቅላላ ተጫዋቾች: ${totalUsers}\n💰 ጠቅላላ ባላንስ: ${totalBalance} ብር\n\nያልተረጋገጡ ጥያቄዎችን ለማየት /pending ይጠቀሙ።`, { parse_mode: 'Markdown' });
        } catch (err) {
            console.error(err);
        }
    });

    bot.onText(/\/pending/, async (msg) => {
        const chatId = msg.chat.id;
        if (chatId.toString() !== ADMIN_CHAT_ID) return;

        try {
            const pendingRes = await pool.query(`
                SELECT t.*, u.name, u.username, u.phone 
                FROM transactions t 
                LEFT JOIN users u ON t.identifier = u.identifier 
                WHERE t.handled = FALSE 
                ORDER BY t.id DESC LIMIT 10
            `);

            if (pendingRes.rows.length === 0) {
                return bot.sendMessage(chatId, '✅ ምንም ያልተረጋገጠ (Pending) የዲፖዚት ወይም ዊዝድሮው ጥያቄ የለም!');
            }

            bot.sendMessage(chatId, `📋 **የሚጠብቁ ጥያቄዎች (${pendingRes.rows.length}):**`, { parse_mode: 'Markdown' });

            for (let tx of pendingRes.rows) {
                let msgText = `🔔 የ ${tx.type} ጥያቄ\n` +
                            `🆔 TxID: ${tx.tx_id}\n` +
                            `👤 ስም: ${tx.name || 'Unknown'} (@${tx.username || 'none'})\n` +
                            `📱 ስልክ: ${tx.phone || 'N/A'}\n` +
                            `💰 መጠን: ${tx.amount} ብር\n` +
                            `📝 መረጃ: ${tx.details || 'N/A'}`;

                bot.sendMessage(chatId, msgText, {
                    reply_markup: {
                        inline_keyboard: [
                            [
                                { text: '✅ አረጋግጥ (Approve)', callback_data: `approve_${tx.tx_id}_${tx.identifier}_${tx.amount}` },
                                { text: '❌ ሰርዝ (Reject)', callback_data: `reject_${tx.tx_id}` }
                            ]
                        ]
                    }
                });
            }
        } catch (err) {
            console.error(err);
            bot.sendMessage(chatId, 'መረጃዎችን ማምጣት አልተቻለም።');
        }
    });

    bot.on('callback_query', async (query) => {
        const data = query.data;
        const parts = data.split('_');
        const action = parts[0];
        const tx_id = parts[1];

        try {
            if (action === 'approve') {
                const identifier = parts[2];
                const amount = parseFloat(parts[3]);

                const txRes = await pool.query('SELECT handled, type FROM transactions WHERE tx_id = $1', [tx_id]);
                if (txRes.rows.length > 0 && txRes.rows[0].handled) {
                    bot.answerCallbackQuery(query.id, { text: 'ይህ ጥያቄ ቀድሞ ተረጋግጧል!' });
                    return;
                }

                let txType = txRes.rows[0]?.type;

                if (txType === 'DEPOSIT') {
                    const userRes = await pool.query('SELECT balance FROM users WHERE identifier = $1', [identifier]);
                    if (userRes.rows.length > 0) {
                        let newBal = parseFloat(userRes.rows[0].balance) + amount;
                        await pool.query('UPDATE users SET balance = $1 WHERE identifier = $2', [newBal, identifier]);
                    }
                } else if (txType === 'WITHDRAW') {
                    const userRes = await pool.query('SELECT balance FROM users WHERE identifier = $1', [identifier]);
                    if (userRes.rows.length > 0) {
                        let currentBal = parseFloat(userRes.rows[0].balance);
                        let newBal = currentBal - amount;
                        await pool.query('UPDATE users SET balance = $1 WHERE identifier = $2', [newBal >= 0 ? newBal : 0, identifier]);
                    }
                }

                await pool.query('UPDATE transactions SET handled = TRUE WHERE tx_id = $1', [tx_id]);

                bot.editMessageText(`✅ ጥያቄው ተረጋግጧል (Approved)!\n🆔 TxID: ${tx_id}`, {
                    chat_id: query.message.chat.id,
                    message_id: query.message.message_id
                });
                bot.answerCallbackQuery(query.id, { text: 'በအောင်မြင်ነት ተረጋግጧል!' });

            } else if (action === 'reject') {
                await pool.query('UPDATE transactions SET handled = TRUE WHERE tx_id = $1', [tx_id]);
                bot.editMessageText(`❌ ጥያቄው ውድቅ ተደረጓል (Rejected)\n🆔 TxID: ${tx_id}`, {
                    chat_id: query.message.chat.id,
                    message_id: query.message.message_id
                });
                bot.answerCallbackQuery(query.id, { text: 'ጥያቄው ውድቅ ተደረገ' });
            }
        } catch (err) {
            console.error('Callback error:', err);
        }
    });
}

// --- MULTI-ROOM & CONTINUOUS ROUND MANAGEMENT ---
let activeRooms = {}; 

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
    let realCount = activeSocketIds.size;
    return realCount;
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

function startRoomGame(roomId) {
    let room = activeRooms[roomId];
    if (!room) return;

    room.status = 'playing';
    if (room.timer) clearInterval(room.timer);
    
    let finalPrizePool = calculatePrizePool(room);
    io.to(roomId).emit('gameStarted', { 
        message: 'ጨዋታው ተጀምሯል!',
        prizePool: finalPrizePool
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
                getOrCreateLobby(room.betAmount);
            }, 3000);
            return;
        }

        let rand;
        do {
            rand = Math.floor(Math.random() * 75) + 1;
        } while (room.drawnNumbers.includes(rand));

        room.drawnNumbers.push(rand);
        io.to(roomId).emit('numberDrawn', { number: rand, drawnHistory: room.drawnNumbers });

        for (let botId in roomBotCards) {
            let botData = roomBotCards[botId];
            let winningLine = findWinningLine(botData.card, room.drawnNumbers);
            if (winningLine) {
                clearInterval(room.gameInterval);
                if (room.timer) clearInterval(room.timer);
                room.status = 'ended';

                let botWinAmount = finalPrizePool;
                let botName = room.playerNames[botId] || "Kenbo-Bot";

                io.to(roomId).emit('gameOver', { 
                    subtitle: '1 player has won the game',
                    winnerName: botName,
                    boardNumber: botData.boardNumber,
                    winAmount: botWinAmount,
                    winningLine: winningLine
                });

                setTimeout(() => {
                    getOrCreateLobby(room.betAmount);
                }, 3000);
                return;
            }
        }
    }, 3000);
}

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('joinLobby', (data) => {
        const betAmount = data && data.betAmount ? data.betAmount : '20';
        let room = getOrCreateLobby(betAmount);

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
            prizePool: currentPrizePool
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
        }
    });

    socket.on('claimBingo', async (data) => {
        const { identifier, name, winAmount, roomId, boardNumber, winningLine } = data;
        let room = activeRooms[roomId];
        
        if (room && room.status === 'playing') {
            room.status = 'ended';
            if (room.gameInterval) clearInterval(room.gameInterval);
            if (room.timer) clearInterval(room.timer);

            let finalWinAmount = calculatePrizePool(room) || winAmount;

            try {
                const userRes = await pool.query('SELECT balance FROM users WHERE identifier = $1', [identifier]);
                if (userRes.rows.length > 0) {
                    let newBal = parseFloat(userRes.rows[0].balance) + parseFloat(finalWinAmount);
                    await pool.query('UPDATE users SET balance = $1 WHERE identifier = $2', [newBal, identifier]);
                    
                    io.to(roomId).emit('gameOver', { 
                        subtitle: '1 player has won the game',
                        winnerName: name || room.playerNames[socket.id] || 'Winner',
                        boardNumber: boardNumber,
                        winAmount: finalWinAmount,
                        winningLine: winningLine
                    });

                    setTimeout(() => {
                        getOrCreateLobby(room.betAmount);
                    }, 3000);
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
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
