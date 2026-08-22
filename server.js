const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const TelegramBot = require('node-telegram-bot-api');
const pool = require('./database');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static('public'));

// እርስዎ የሰጡዋቸው ቋሚ መረጃዎች
const TOKEN = '8957133551:AAGBPCGEzFLtJRXHRU0PfKJ2QXDf1AyvXec';
const ADMIN_CHAT_ID = '686733543';

let bot = null;
if (TOKEN) {
    bot = new TelegramBot(TOKEN, { polling: true });
    console.log('Telegram Bot started successfully!');
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
        await pool.query(
            'INSERT INTO transactions (tx_id, identifier, type, amount, handled) VALUES ($1, $2, $3, $4, FALSE)',
            [tx_id, identifier, type, amount]
        );
        res.json({ success: true, tx_id });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false });
    }
});

// --- TELEGRAM BOT COMMANDS & ADMIN PANEL ---
if (bot) {
    bot.onText(/\/start/, (msg) => {
        const chatId = msg.chat.id;
        const name = msg.from.first_name;
        
        let welcomeMessage = `ሰላም ${name}! ወደ ዋና ቢንጎ (Wana Bingo) እንኳን ደህና መጡ። 🎉\n\n` +
                             `📌 **ትዕዛዞች:**\n` +
                             `/balance - ቀሪ ገንዘብዎን ለማየት\n` +
                             `/deposit - የዲፖዚት መመሪያ ለማየት\n` +
                             `/withdraw - ገንዘብ ወጪ ለማድረግ`;

        if (chatId.toString() === ADMIN_CHAT_ID) {
            welcomeMessage += `\n\n👑 **የአድሚን ትዕዛዞች:**\n` +
                              `/admin - ዳሽቦርድ ለማየት\n` +
                              `/pending - ያልተረጋገጡ ጥያቄዎችን ለማየት`;
        }

        bot.sendMessage(chatId, welcomeMessage);
    });

    bot.onText(/\/deposit/, (msg) => {
        const chatId = msg.chat.id;
        bot.sendMessage(chatId, `💳 **የዲፖዚት መመሪያ**\n\nበቴሌብር ወይም በባንክ ገንዘብ ገቢ በማድረግ በዌብሳይቱ (App) በኩል የዲፖዚት ጥያቄ ይላኩ።`);
    });

    bot.onText(/\/withdraw/, (msg) => {
        const chatId = msg.chat.id;
        bot.sendMessage(chatId, `💸 **ገንዘብ ወጪ (Withdraw)**\n\nያሸነፉትን ገንዘብ ወጪ ለማድረግ እባክዎ ወደ ዌብሳይቱ በመግባት የ "Withdraw" ቅጹን ይሙሉ::`);
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

            bot.sendMessage(chatId, `👑 **የአድሚን ዳሽቦርድ**\n\n👥 ጠቅላላ ተጫዋቾች: ${totalUsers}\n💰 ጠቅላላ ባላንስ: ${totalBalance} ብር\n\nያልተረጋገጡ ጥያቄዎችን ለማየት /pending ይጠቀሙ።`);
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

            bot.sendMessage(chatId, `📋 **የሚጠብቁ ጥያቄዎች (${pendingRes.rows.length}):**`);

            for (let tx of pendingRes.rows) {
                let msgText = `🔔 የ ${tx.type} ጥያቄ\n` +
                              `🆔 TxID: ${tx.tx_id}\n` +
                              `👤 ስም: ${tx.name || 'Unknown'} (@${tx.username || 'none'})\n` +
                              `📱 ስልክ: ${tx.phone || 'N/A'}\n` +
                              `💰 መጠን: ${tx.amount} ብር`;

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
                        let newBal = parseFloat(userRes.rows[0].balance) - amount;
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
                bot.editMessageText(`❌ ጥያቄው ውድቅ ተደርጓል (Rejected)\n🆔 TxID: ${tx_id}`, {
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

// --- LOBBY & ROOM SOCKET MANAGEMENT ---
let activeRooms = {}; 

function createNewRoom() {
    const roomId = 'ROOM_' + Math.floor(1000 + Math.random() * 9000);
    activeRooms[roomId] = {
        roomId,
        status: 'waiting',
        players: new Set(),
        drawnNumbers: [],
        countdown: 30,
        timer: null,
        gameInterval: null
    };
    startLobbyCountdown(roomId);
    return roomId;
}

let currentActiveLobbyId = createNewRoom();

function startLobbyCountdown(roomId) {
    activeRooms[roomId].timer = setInterval(() => {
        let room = activeRooms[roomId];
        if (!room) return;

        room.countdown--;
        io.to(roomId).emit('countdownUpdate', { countdown: room.countdown });

        if (room.countdown <= 0) {
            clearInterval(room.timer);
            startRoomGame(roomId);
        }
    }, 1000);
}

function startRoomGame(roomId) {
    let room = activeRooms[roomId];
    if (!room) return;

    room.status = 'playing';
    io.to(roomId).emit('gameStarted', { message: 'ጨዋታው ተጀምሯል!' });

    if (currentActiveLobbyId === roomId) {
        currentActiveLobbyId = createNewRoom();
    }

    room.gameInterval = setInterval(() => {
        if (room.drawnNumbers.length >= 75) {
            clearInterval(room.gameInterval);
            io.to(roomId).emit('gameOver', { message: 'ጨዋታው አልቋል! አሸናፊ አልተገኘም።' });
            return;
        }

        let rand;
        do {
            rand = Math.floor(Math.random() * 75) + 1;
        } while (room.drawnNumbers.includes(rand));

        room.drawnNumbers.push(rand);
        io.to(roomId).emit('numberDrawn', { number: rand, drawnHistory: room.drawnNumbers });
    }, 3000);
}

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('joinLobby', () => {
        let roomId = currentActiveLobbyId;
        
        if (!activeRooms[roomId] || activeRooms[roomId].status !== 'waiting') {
            roomId = createNewRoom();
            currentActiveLobbyId = roomId;
        }

        socket.join(roomId);
        activeRooms[roomId].players.add(socket.id);

        socket.emit('assignedRoom', { 
            roomId, 
            countdown: activeRooms[roomId].countdown,
            status: activeRooms[roomId].status 
        });
    });

    socket.on('claimBingo', async (data) => {
        const { identifier, winAmount, roomId } = data;
        let room = activeRooms[roomId];
        
        if (room && room.status === 'playing') {
            room.status = 'ended';
            if (room.gameInterval) clearInterval(room.gameInterval);
            if (room.timer) clearInterval(room.timer);

            try {
                const userRes = await pool.query('SELECT balance FROM users WHERE identifier = $1', [identifier]);
                if (userRes.rows.length > 0) {
                    let newBal = parseFloat(userRes.rows[0].balance) + parseFloat(winAmount);
                    await pool.query('UPDATE users SET balance = $1 WHERE identifier = $2', [newBal, identifier]);
                    
                    io.to(roomId).emit('gameOver', { message: `🎉 ተጫዋች አሸንፏል! ${winAmount} ብር ወስዷል።` });
                }
            } catch (err) {
                console.error('Bingo claim error:', err);
            }
        }
    });

    socket.on('disconnect', () => {
        for (let roomId in activeRooms) {
            if (activeRooms[roomId].players.has(socket.id)) {
                activeRooms[roomId].players.delete(socket.id);
            }
        }
    });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
