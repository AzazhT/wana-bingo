const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// የሁሉም ተጠቃሚዎች የባንክ ሂሳብ (Database)
let usersDatabase = {};

// 1. የተጠቃሚውን መረጃ እና ባላንስ ማምጫ API
app.post('/api/get-user', (req, res) => {
    const { identifier, name, username } = req.body;
    if (!identifier) return res.status(400).json({ success: false, message: 'Invalid ID' });

    if (!usersDatabase[identifier]) {
        usersDatabase[identifier] = {
            identifier,
            name: name || 'Player',
            username: username || '',
            balance: 0.00, // አዲስ ተጠቃሚ ከሆነ ባላንሱ 0 ነው
            phone: ''
        };
    }

    res.json({ success: true, user: usersDatabase[identifier] });
});

// 2. ጨዋታ ሲጀመር ብር መቀነሻ API
app.post('/api/place-bet', (req, res) => {
    const { identifier, amount } = req.body;
    const user = usersDatabase[identifier];

    if (!user) return res.status(404).json({ success: false, message: 'ተጠቃሚው አልተገኘም' });
    if (user.balance < amount) {
        return res.json({ success: false, message: 'በቂ ባላንስ የለዎትም! እባክዎን አስቀድመው ዲፖዚት ያድርጉ።' });
    }

    user.balance -= amount; // ብር መቀነስ
    res.json({ success: true, newBalance: user.balance });
});

// 3. የዲፖዚት እና ዊዝድሮው ጥያቄ ማቀበያ API
app.post('/api/request-transaction', (req, res) => {
    const { identifier, type, amount, details } = req.body;
    const user = usersDatabase[identifier];

    if (!user) return res.status(404).json({ success: false, message: 'ተጠቃሚው አልተገኘም' });

    if (type === 'WITHDRAW' && user.balance < amount) {
        return res.json({ success: false, message: 'ያለዎት ባላንስ ከጠየቁት የብር መጠን ያንሳል!' });
    }

    // ለአድሚን ጥያቄ መላክ (እዚህ ላይ ወደ Telegram Admin Bot መላክ ይቻላል)
    console.log(`[ADMIN NOTIFICATION] አዲስ የ${type} ጥያቄ፡ User: ${user.name} (${identifier}), Amount: ${amount} ETB, Details: ${details}`);

    res.json({ 
        success: true, 
        message: type === 'DEPOSIT' 
            ? 'የዲፖዚት ጥያቄዎ ለአድሚን ተልኳል! አድሚኑ አፕሩቭ ሲያደርገው ባላንስዎ ላይ ይደመራል።' 
            : 'የወጪ ጥያቄዎ ለአድሚን ተልኳል።' 
    });
});

// 4. አድሚን ዲፖዚትን «Approve» ሲያደርግ ብር የሚጨምር API (ለAdmin Panel)
app.post('/api/admin/approve-deposit', (req, res) => {
    const { identifier, amount } = req.body;
    if (usersDatabase[identifier]) {
        usersDatabase[identifier].balance += parseFloat(amount);
        res.json({ success: true, newBalance: usersDatabase[identifier].balance });
    } else {
        res.status(404).json({ success: false, message: 'ተጠቃሚው አልተገኘም' });
    }
});

// Real-time Socket.io Game Logic
io.on('connection', (socket) => {
    socket.on('startGame', () => {
        let drawnNumbers = [];
        let interval = setInterval(() => {
            if (drawnNumbers.length >= 75) {
                clearInterval(interval);
                return;
            }
            let rand;
            do {
                rand = Math.floor(Math.random() * 75) + 1;
            } while (drawnNumbers.includes(rand));

            drawnNumbers.push(rand);
            io.emit('numberDrawn', { number: rand, drawnHistory: drawnNumbers });
        }, 3000);
    });

    // አሸናፊ ሲኖር ያሸነፈውን ብር አካውንቱ ላይ መደመር
    socket.on('claimBingo', (data) => {
        const { identifier, winAmount } = data;
        if (usersDatabase[identifier]) {
            usersDatabase[identifier].balance += parseFloat(winAmount);
            io.emit('gameOver', { message: `ተጫዋች ${usersDatabase[identifier].name} አሸንፏል!` });
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
