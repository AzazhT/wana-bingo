const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static('public'));

// 1. የሞንጎዲቢ ግንኙነት
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/addis_bingo';
mongoose.connect(MONGO_URI)
    .then(() => console.log('MongoDB ከሰርቨር ጋር በအောင်ኬት ተገናኝቷል!'))
    .catch(err => console.error('MongoDB Connection Error:', err));

// 2. የተጠቃሚ ስኬማ (በስልክ ቁጥር ወይም ቴሌግራም ID አንዴ ብቻ ይመዘገባል)
const userSchema = new mongoose.Schema({
    identifier: { type: String, required: true, unique: true }, // ስልክ ቁጥር ወይም ቴሌግራም ID
    name: { type: String },
    balance: { type: Number, default: 50 }, // ሲመዘገብ 50 ብር ቦነስ
    createdAt: { type: Date, default: Date.now }
});
const User = mongoose.model('User', userSchema);

// 3. የዲፖዚት (ብር ማስገባት) ጥያቄዎች ስኬማ
const depositSchema = new mongoose.Schema({
    identifier: String,
    amount: Number,
    smsText: String, // የባንክ ትራንዛክሽን መልእክት
    status: { type: String, default: 'pending' }, // pending, approved, rejected
    createdAt: { type: Date, default: Date.now }
});
const Deposit = mongoose.model('Deposit', depositSchema);

// --- 4. ኤፒአይዎች (APIs) ---

// ሪጅስትሬሽን እና 50 ብር ቦነስ
app.post('/api/register', async (req, res) => {
    try {
        const { identifier, name } = req.body;
        if (!identifier) return res.status(400).json({ success: false, error: 'ስልክ ቁጥር ወይም ቴሌግራም ID ያስፈልጋል' });

        let user = await User.findOne({ identifier });
        if (!user) {
            user = new User({ identifier, name: name || 'ተጫዋች', balance: 50 });
            await user.save();
        }
        res.status(200).json({ success: true, user });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// ተጠቃሚው የዲፖዚት ጥያቄ (ስካን/ኤስኤምኤስ) ሲልክ
app.post('/api/deposit', async (req, res) => {
    try {
        const { identifier, amount, smsText } = req.body;
        if (!identifier || !amount || !smsText) {
            return res.status(400).json({ success: false, error: 'ሁሉም መረጃዎች መሞላት አለባቸው' });
        }

        const newDep = new Deposit({ identifier, amount, smsText, status: 'pending' });
        await newDep.save();

        // ለአድሚኖች በ Socket.io ማሳወቂያ መላክ ይቻላል
        io.emit('newDepositAlert', { identifier, amount, smsText, depositId: newDep._id });

        res.status(200).json({ success: true, message: 'የዲፖዚት ጥያቄዎ ተልኳል! አድሚኑ ሲያረጋግጠው አካውንትዎ ላይ ይገባል።' });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// አድሚን የሚጠብቁ (Pending) የዲፖዚት ጥያቄዎችን ማየት
app.get('/api/admin/deposits', async (req, res) => {
    try {
        const pendingDeposits = await Deposit.find({ status: 'pending' });
        res.json(pendingDeposits);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// አድሚኑ ዲፖዚቱን ሲያጸድቅ (Approve ሲያደርግ) ብሩ ተጠቃሚው አካውንት ላይ ይገባል
app.post('/api/admin/approve-deposit', async (req, res) => {
    try {
        const { depositId } = req.body;
        const dep = await Deposit.findById(depositId);
        if (!dep || dep.status !== 'pending') {
            return res.status(400).json({ success: false, error: 'ጥያቄው አልተገኘም ወይም ቀድሞ ተይዟል።' });
        }

        dep.status = 'approved';
        await dep.save();

        let user = await User.findOne({ identifier: dep.identifier });
        if (user) {
            user.balance += dep.amount; // የተጠየቀው ብር ይጨመራል
            await user.save();
        }

        res.json({ success: true, message: 'ብር ተጠቃሚው አካውንት ላይ ገብቷል!' });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// --- 5. የሶኬት (Socket.io) የጨዋታ ሎጂክ ---
let gameInterval = null;
let drawnNumbersHistory = [];

io.on('connection', (socket) => {
    console.log('ተጠቃሚ ተገናኝቷል:', socket.id);

    // ጨዋታው ሲጀመር
    socket.on('startGame', () => {
        let numbers = Array.from({length: 75}, (_, i) => i + 1);
        numbers.sort(() => Math.random() - 0.5);
        drawnNumbersHistory = [];

        if (gameInterval) clearInterval(gameInterval);

        gameInterval = setInterval(() => {
            if (numbers.length === 0) {
                clearInterval(gameInterval);
                io.emit('gameOver', { message: 'ጨዋታው አልቋል!' });
                return;
            }
            let currentNum = numbers.pop();
            drawnNumbersHistory.push(currentNum);
            
            io.emit('numberDrawn', { number: currentNum, drawnHistory: drawnNumbersHistory });
        }, 3000);
    });

    socket.on('disconnect', () => {
        console.log('ተጠቃሚ ወጥቷል:', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`ሰርቨሩ በፖርት ${PORT} እየሰራ ነው...`);
});
