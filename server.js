const express = require('express');
const mongoose = require('mongoose');
const TelegramBot = require('node-telegram-bot-api');

const app = express();
app.use(express.json());

// 📌 कॉन्ፊግሬሽን
const TOKEN = '8957133551:AAGBPCGEzFLtJRXHRU0PfKJ2QXDf1AyvXec';
const ADMIN_ID = '686733543';
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/addis_bingo';

const bot = new TelegramBot(TOKEN, { polling: true });

// 📌 ዳታቤዝ ሞዴሎች
const userSchema = new mongoose.Schema({
    identifier: { type: String, required: true, unique: true }, // Telegram ID
    balance: { type: Number, default: 50 }, // የዚህ ተጠቃሚ ብቻ ባላንስ
    name: String
});
const User = mongoose.model('User', userSchema);

const transactionSchema = new mongoose.Schema({
    identifier: String,
    type: String, // 'DEPOSIT' or 'WITHDRAW'
    amount: Number,
    details: String, // SMS ወይም የባንክ መረጃ
    status: { type: String, default: 'PENDING' } // PENDING, APPROVED, REJECTED
});
const Transaction = mongoose.model('Transaction', transactionSchema);

mongoose.connect(MONGO_URI).then(() => console.log('DB Connected'));

// 1. ተጠቃሚ ሲገባ (የነበረውን ባላንስ ለማግኘት)
app.post('/api/get-user', async (req, res) => {
    const { identifier, name } = req.body;
    let user = await User.findOne({ identifier });
    
    if (!user) {
        user = await User.create({ identifier, name, balance: 50 });
    }
    res.json({ success: true, user });
});

// 2. ጨዋታ ሲጀመር ብር ለመቀነስ
app.post('/api/place-bet', async (req, res) => {
    const { identifier, amount } = req.body;
    let user = await User.findOne({ identifier });
    
    if (user.balance < amount) return res.json({ success: false, message: 'በቂ ባላንስ የለዎትም' });
    
    user.balance -= amount;
    await user.save();
    res.json({ success: true, newBalance: user.balance });
});

// 3. ዴፖዚት ወይም ወጪ ጥያቄ ሲላክ
app.post('/api/request-transaction', async (req, res) => {
    const { identifier, type, amount, details } = req.body;
    const trans = await Transaction.create({ identifier, type, amount, details });
    
    // ለአድሚን በቴሌግራም መላክ
    const keyboard = {
        inline_keyboard: [[
            { text: "✅ አጽድቅ (Approve)", callback_data: `approve_${trans._id}` },
            { text: "❌ ውድቅ (Reject)", callback_data: `reject_${trans._id}` }
        ]]
    };
    
    bot.sendMessage(ADMIN_ID, `📥 **አዲስ ጥያቄ (${type})**\nተጠቃሚ: ${identifier}\nመጠን: ${amount} ብር\nመረጃ: ${details}`, { reply_markup: keyboard });
    res.json({ success: true });
});

// 4. አድሚን ሲያጸድቅ (Callback)
bot.on('callback_query', async (q) => {
    const [action, id] = q.data.split('_');
    const trans = await Transaction.findById(id);
    if (!trans) return;

    if (action === 'approve') {
        if (trans.type === 'DEPOSIT') {
            const user = await User.findOne({ identifier: trans.identifier });
            user.balance += trans.amount;
            await user.save();
        }
        trans.status = 'APPROVED';
        await trans.save();
        bot.sendMessage(trans.identifier, `🎉 የእርስዎ የ ${trans.amount} ብር ${trans.type} ጥያቄ ጸድቋል!`);
    } else {
        trans.status = 'REJECTED';
        await trans.save();
    }
    bot.editMessageText(`ጥያቄው ${action === 'approve' ? 'ጸድቋል' : 'ውድቅ ሆኗል'}`, { chat_id: ADMIN_ID, message_id: q.message.message_id });
});

app.listen(3000, () => console.log('Server running on 3000'));
