const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static('public'));

// 1. የሞንጎዲቢ (MongoDB) ቻናል ግንኙነት
mongoose.connect('mongodb://localhost:27017/addis_bingo', {
    useNewUrlParser: true,
    useUnifiedTopology: true
}).then(() => console.log('MongoDB ከሰርቨር ጋር ተገናኝቷል!')).catch(err => console.error(err));

// 2. የተጠቃሚ (User) ስኬማ - አንድ ቴሌግራም ID አንዴ ብቻ እንዲመዝገብ (Unique)
const userSchema = new mongoose.Schema({
    telegramId: { type: String, required: true, unique: true },
    name: { type: String },
    balance: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now }
});
const User = mongoose.model('User', userSchema);

// 3. የዲፖዚት ጥያቄዎች ስኬማ (ለአድሚን ማረጋገጫ)
const depositSchema = new mongoose.Schema({
    telegramId: String,
    amount: Number,
    smsText: String,
    status: { type: String, default: 'pending' }, // pending, approved, rejected
    createdAt: { type: Date, default: Date.now }
});
const Deposit = mongoose.model('Deposit', depositSchema);

// ሪጅስትሬሽን ኤፒአይ (አንድ ተጠቃሚ አንዴ ብቻ ይመዝገባል፣ ካለ ኦሬዲ ያለውን ይመልሳል)
app.post('/api/register', async (req, res) => {
    try {
        const { telegramId, name } = req.body;
        let user = await User.findOne({ telegramId });
        
        if (!user) {
            user = new User({ telegramId, name, balance: 0 });
            await user.save();
        }
        res.status(200).json({ success: true, user });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// አድሚን የሚጠቀምበት የዲፖዚት ጥያቄዎችን ማሳያ ኤፒአይ
app.get('/api/admin/deposits', async (req, res) => {
    try {
        const pendingDeposits = await Deposit.find({ status: 'pending' });
        res.json(pendingDeposits);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// አድሚን ዲፖዚቱን አፕሩቭ (Approve) አድርጎ ብር ወደ ተጠቃሚው የሚጨምርበት ኤፒአይ
app.post('/api/admin/approve-deposit', async (req, res) => {
    try {
        const { depositId } = req.body;
        const dep = await Deposit.findById(depositId);
        if (!dep || dep.status !== 'pending') return res.status(400).json({ error: 'ጥያቄው አልተገኘም ወይም ቀደም ብሎ ተይዟል።' });

        dep.status = 'approved';
        await dep.save();

        // ተጠቃሚው ላይ ብሩን መጨመር
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

    // ተጠቃሚ የዲፖዚት ጥያቄ ሲልክ
    socket.on('requestDeposit', async (data) => {
        try {
            const newDep = new Deposit({
                telegramId: data.telegramId,
                amount: data.amount,
                smsText: data.smsText,
                status: 'pending'
            });
            await newDep.save();
        } catch (e) {
            console.error('Deposit Error:', e);
        }
    });

    // ጨዋታ ሲጀመር ቁጥሮችን ማውጣት (Live Numbers Call)
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
        }, 3000); // በየ 3 ሰከንዱ አንድ ቁጥር ይጠራል።
    });

    socket.on('disconnect', () => { console.log('ተጠቃሚ ወጥቷል:', socket.id); });
});

server.listen(3000, () => { console.log('ሰርቨሩ በፖርት 3000 እየሰራ ነው...'); });
