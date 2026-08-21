const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static('public'));

// የሞንጎዲቢ (MongoDB) ቻናል ግንኙነት (Render ላይ ለምትጠቀሙት Mongo URI መቀየር ትችላላችሁ)
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/addis_bingo';
mongoose.connect(MONGO_URI)
    .then(() => console.log('MongoDB ከሰርቨር ጋር ተገናኝቷል!'))
    .catch(err => console.error('MongoDB Connection Error:', err));

// የተጠቃሚ (User) ስኬማ - አንድ ቴሌግራም ID አንዴ ብቻ ይመዝገባል
const userSchema = new mongoose.Schema({
    telegramId: { type: String, required: true, unique: true },
    name: { type: String },
    balance: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now }
});
const User = mongoose.model('User', userSchema);

// የዲፖዚት ጥያቄዎች ስኬማ
const depositSchema = new mongoose.Schema({
    telegramId: String,
    amount: Number,
    smsText: String,
    status: { type: String, default: 'pending' }, 
    createdAt: { type: Date, default: Date.now }
});
const Deposit = mongoose.model('Deposit', depositSchema);

// ሪጅስትሬሽን ኤፒአይ (አንዴ ከተመዘገበ ሁለተኛ ዳታቤዝ ላይ አዲስ አይፈጥርም፣ ያለውን ይመልሳል)
app.post('/api/register', async (req, res) => {
    try {
        const { telegramId, name } = req.body;
        if (!telegramId) return res.status(400).json({ success: false, error: 'Telegram ID ያስፈልጋል' });

        let user = await User.findOne({ telegramId });
        if (!user) {
            user = new User({ telegramId, name: name || 'Player', balance: 0 });
            await user.save();
        }
        res.status(200).json({ success: true, user });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// አድሚን የሚጠቀምበት የዲፖዚት ጥያቄዎች ማሳያ
app.get('/api/admin/deposits', async (req, res) => {
    try {
        const pendingDeposits = await Deposit.find({ status: 'pending' });
        res.json(pendingDeposits);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// አድሚን ዲፖዚቱን አፕሩቭ ሲያደርግ
app.post('/api/admin/approve-deposit', async (req, res) => {
    try {
        const { depositId } = req.body;
        const dep = await Deposit.findById(depositId);
        if (!dep || dep.status !== 'pending') return res.status(400).json({ error: 'ጥያቄው አልተገኘም ወይም ተይዟል።' });

        dep.status = 'approved';
        await dep.save();

        let user = await User.findOne({ telegramId: dep.telegramId });
        if (user) {
            user.balance += dep.amount;
            await user.save();
        }

        res.json({ success: true, message: 'ብር ተጠቃሚው አካውንት ላይ ገብቷል!' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Socket.io ሎጂክ
io.on('connection', (socket) => {
    console.log('ተጠቃሚ ተገናኝቷል:', socket.id);

    socket.on('requestDeposit', async (data) => {
        try {
            if (!data.telegramId) return;
            const newDep = new Deposit({
                telegramId: data.telegramId,
                amount: data.amount,
                smsText: data.smsText,
                status: 'pending'
            });
            await newDep.save();
            console.log('አዲስ የዲፖዚት ጥያቄ ደርሷል ከ:', data.telegramId);
        } catch (e) {
            console.error('Deposit Error:', e);
        }
    });

    socket.on('startGame', () => {
        let numbers = Array.from({length: 75}, (_, i) => i + 1);
        numbers.sort(() => Math.random() - 0.5);
        let drawnHistory = [];
        
        let interval = setInterval(() => {
            if (numbers.length === 0) {
                clearInterval(interval);
                io.emit('gameOver', { message: 'ጨዋታው አልቋል!' });
                return;
            }
            let currentNum = numbers.pop();
            drawnHistory.push(currentNum);
            io.emit('numberDrawn', { number: currentNum, drawnHistory });
        }, 3000);
    });

    socket.on('disconnect', () => { console.log('ተጠቃሚ ወጥቷል:', socket.id); });
});

// Render ፖርቱን በራስ ሰር እንዲወስድ (PORT 3000 ሃርድኮድ ሳያደርግ)
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => { console.log(`ሰርቨሩ በፖርት ${PORT} እየሰራ ነው...`); });
