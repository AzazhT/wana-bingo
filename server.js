const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const TelegramBot = require('node-telegram-bot-api');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const TELEGRAM_BOT_TOKEN = '8957133551:AAGBPCGEzFLtJRXHRU0PfKJ2QXDf1AyvXec'; 
const ADMIN_CHAT_ID = '686733543';

const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });

let usersDatabase = {};
let pendingTransactions = {};
// --- የጨዋታው Backend State ---
let gameActive = false;
let drawnNumbers = [];
let gameInterval = null;

// --- Backend Bingo Game Logic ---
function startBingoCycle() {
    if (gameActive) return;
    gameActive = true;
    drawnNumbers = [];
    
    // ጨዋታው በየ 3 ሰከንድ ቁጥር ያወጣል
    gameInterval = setInterval(() => {
        if (drawnNumbers.length >= 75) {
            clearInterval(gameInterval);
            gameActive = false;
            return;
        }
        let rand;
        do { rand = Math.floor(Math.random() * 75) + 1; } while (drawnNumbers.includes(rand));
        drawnNumbers.push(rand);
        
        io.emit('numberDrawn', { number: rand, drawnHistory: drawnNumbers });
    }, 3000);
}

// ቢንጎን በሰርቨር ማረጋገጥ (Server-side Verification)
function verifyBingo(userCard, drawnNumbers) {
    const checkWin = (card) => {
        const marked = card.map(row => row.map(cell => cell === '*' || drawnNumbers.includes(cell)));
        // Rows & Cols & Diagonals check...
        for(let i=0; i<5; i++) {
            if(marked[i].every(val => val)) return true;
            if(marked.every(row => row[i])) return true;
        }
        if([0,1,2,3,4].every(i => marked[i][i])) return true;
        if([0,1,2,3,4].every(i => marked[i][4-i])) return true;
        return false;
    };
    return checkWin(userCard);
}

io.on('connection', (socket) => {
    socket.on('joinGame', () => { if(!gameActive) startBingoCycle(); });

    socket.on('claimBingo', (data) => {
        const { identifier, card } = data;
        if (verifyBingo(card, drawnNumbers)) {
            // እዚህ አሸናፊውን እና ሽልማቱን መመዝገብ
            usersDatabase[identifier].balance += 500; // ለምሳሌ
            io.emit('winnerFound', { name: usersDatabase[identifier].name });
        }
    });
});

// --- API Endpoints ---
app.post('/api/get-user', (req, res) => {
    const { identifier, name } = req.body;
    if (!usersDatabase[identifier]) {
        usersDatabase[identifier] = { identifier, name, balance: 0, phone: 'አልተጋራም' };
    }
    res.json({ success: true, user: usersDatabase[identifier] });
});

app.post('/api/request-transaction', async (req, res) => {
    const { identifier, type, amount, details } = req.body;
    const txId = 'TX_' + Date.now();
    pendingTransactions[txId] = { identifier, type, amount, handled: false };
    
    // ለቴሌግራም አድሚን መላክ
    await bot.sendMessage(ADMIN_CHAT_ID, `አዲስ ጥያቄ: ${type} - ${amount} ETB\nተጠቃሚ: ${usersDatabase[identifier].name}`, {
        reply_markup: { inline_keyboard: [[{text: 'Approve', callback_data: `approve_${txId}`}, {text: 'Reject', callback_data: `reject_${txId}`}]] }
    });
    res.json({ success: true });
});

// አድሚን Approve ሲል የሚሰራ
bot.on('callback_query', (query) => {
    const [status, txId] = query.data.split('_');
    const tx = pendingTransactions[txId];
    if (status === 'approve' && tx) {
        usersDatabase[tx.identifier].balance += tx.amount;
        tx.handled = true;
        bot.sendMessage(ADMIN_CHAT_ID, "ተረጋግጧል!");
    }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
