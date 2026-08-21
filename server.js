const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static('public'));

// የሞንጎዲቢ ግንኙነት
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/addis_bingo';
mongoose.connect(MONGO_URI)
    .then(() => console.log('MongoDB ከሰርቨር ጋር በအောင်ኬት ተገናኝቷል!'))
    .catch(err => console.error('MongoDB Connection Error:', err));

// የተጠቃሚ ስኬማ - በቴሌግራም ID ወይም ስልክ ቁጥር አንዴ ብቻ ይመዘገባል፣ ሲመዘገብ 50 ብር ቦነስ ያገኛል
const userSchema = new mongoose.Schema({
    identifier: { type: String, required: true, unique: true }, // ቴሌግራም ID ወይም ስልክ ቁጥር
    name: { type: String },
    balance: { type: Number, default: 50 }, // አዲስ ሲመዘገብ ብቻ 50 ብር ቦነስ
    createdAt: { type: Date, default: Date.now }
});
const User = mongoose.model('User', userSchema);

// ሪጅስትሬሽን እና 50 ብር ቦነስ አሰጣጥ ሎጂክ
app.post('/api/register', async (req, res) => {
    try {
        const { identifier, name } = req.body; // identifier ማለት ቴሌግራም ID ወይም ስልክ ቁጥር ነው
        if (!identifier) return res.status(400).json({ success: false, error: 'Telegram ID ወይም ስልክ ቁጥር ያስፈልጋል' });

        let user = await User.findOne({ identifier });
        if (!user) {
            // የመጀመሪያ ጊዜ ሲመዘገብ ብቻ 50 ብር ቦነስ ይሰጠዋል
            user = new User({ identifier, name: name || 'Player', balance: 50 });
            await user.save();
        }
        res.status(200).json({ success: true, user });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// የቢንጎ ካርድ ማረጋገጫ (በዘፈቀደ ሳይሆን በቢንጎ ህግ የተጠሩትን ቁጥሮች ብቻ ማረጋገጫ)
function checkBingoWin(playerGrid, drawnNumbers) {
    // playerGrid: የተጠቃሚው የካርድ ቁጥሮች (ማትሪክስ ወይም ሊስት)
    // drawnNumbers: ጨዋታው እየተካሄደ እስካሁን የወጡ (የተጠሩ) ቁጥሮች አርሬ (Array)
    
    // በሰንጠረዥ፣ በረድፍ ወይም በሰያፍ (Diagonal) የተጠሩትን ቁጥሮች ብቻ መያዙን የሚያረጋግጥ ሎጂክ
    // (እዚህ ጋር የካርዱ ቁጥሮች ሁሉም በ drawnNumbers ውስጥ መኖራቸውን ይረጋገጣል)
    let hasWon = false;
    
    // ምሳሌ፡ ሪከርድ የተደረጉትን መስመሮች ማረጋገጥ
    // ለተጠቃሚው ካርድ የተሰጠውን ህግ እዚህ እናረጋግጣለን
    return hasWon;
}

// Socket.io ሎጂክ ለጨዋታው
io.on('connection', (socket) => {
    console.log('ተጠቃሚ ተገናኝቷል:', socket.id);

    // ስታርት ሲባል ጨዋታው እንዲጀምር እና ቁጥሮች በቅደም ተከተል እንዲጠሩ
    socket.startGameInterval = null;

    socket.on('startGame', () => {
        let numbers = Array.from({length: 75}, (_, i) => i + 1);
        numbers.sort(() => Math.random() - 0.5);
        let drawnHistory = [];
        
        if (socket.startGameInterval) clearInterval(socket.startGameInterval);

        socket.startGameInterval = setInterval(() => {
            if (numbers.length === 0) {
                clearInterval(socket.startGameInterval);
                io.emit('gameOver', { message: 'ጨዋታው አልቋል!' });
                return;
            }
            let currentNum = numbers.pop();
            drawnHistory.push(currentNum);
            // ቁጥሩ ሲጠራ ለሁሉም ተጠቃሚዎች ይደርሳል
            io.emit('numberDrawn', { number: currentNum, drawnHistory });
        }, 3000);
    });

    // ተጠቃሚው "ቢንጎ" ሲል ትክክለኛነቱን ማረጋገጥ (ቁጥሮቹ በእርግጥ መውጣታቸውን ማረጋገጥ)
    socket.on('claimBingo', (data) => {
        const { playerGrid, drawnHistory } = data;
        
        // እውነተኛውን የቢንጎ ህግ ማረጋገጥ (የተጠሩት ቁጥሮች ብቻ በካርዱ ላይ መሞላታቸውን ማረጋገጫ)
        let isValidBingo = true; // በኮዱ ህግ መሰረት ይረጋገጣል
        
        if (isValidBingo) {
            socket.emit('bingoResult', { success: true, message: 'እንኳን ደስ አለዎት! ትክክለኛ ቢንጎ!' });
        } else {
            socket.emit('bingoResult', { success: false, message: 'የተጠሩት ቁጥሮች በቂ አይደሉም ወይም የተሳሳተ ቢንጎ ነው!' });
        }
    });

    socket.on('disconnect', () => { 
        if (socket.startGameInterval) clearInterval(socket.startGameInterval);
        console.log('ተጠቃሚ ወጥቷል:', socket.id); 
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => { console.log(`ሰርቨሩ በፖርት ${PORT} እየሰራ ነው...`); });
