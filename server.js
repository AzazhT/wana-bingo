const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const TelegramBot = require('node-telegram-bot-api');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// የቴሌግራም ቦት ቶከን
const TOKEN = '8957133551:AAGBPCGEzFLtJRXHRU0PfKJ2QXDf1AyvXec';
const bot = new TelegramBot(TOKEN, { polling: true });

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, '🎮 ወደ ዋና ቢንጎ (Wana Bingo) እንኳን በደህና መጡ! ጨዋታውን ለመጀመር እና አካውንትዎን ለማስተዳደር ከታች ያለውን በተን ይጫኑ:', {
    reply_markup: {
      inline_keyboard: [
        [{ text: '🎮 ቢንጎ ጨዋታውን ክፈት', web_app: { url: 'https://wana-bingo.onrender.com' } }],
        [
          { text: '💰 ዲፖዚት (Deposit)', callback_data: 'deposit' },
          { text: '💳 ዊዝድራው (Withdraw)', callback_data: 'withdraw' }
        ],
        [{ text: '🔄 ቦት ሪስታርት / Restart', callback_data: 'restart' }]
      ]
    }
  });
});

bot.on('callback_query', (query) => {
  const chatId = query.message.chat.id;
  if (query.data === 'deposit') {
    bot.sendMessage(chatId, '💰 የገንዘብ ማስገቢያ (Deposit) አማራጮች:\nእባክዎ በቴሌብር (Telebirr) ወይም በንግድ ባንክ (CBE) ወደሚከተለው አካውንት ያስገቡ:\n- 1000123456789 (ሮቤል)\nከዚያ ደረሰኙን ለዚህ ቦት ይላኩ።');
  } else if (query.data === 'withdraw') {
    bot.sendMessage(chatId, '💳 የገንዘብ ማውጫ (Withdraw):\nዝቅተኛ የማውጣት መጠን 100 ብር ነው። እባክዎ የባንክ ወይም የቴሌብር ቁጥርዎን ይላኩ።');
  } else if (query.data === 'restart') {
    bot.sendMessage(chatId, '🔄 ቦቱ እንደገና ተጀምሯል! /start በመጫን መጀመር ይችላሉ።');
  }
  bot.answerCallbackQuery(query.id);
});

// MongoDB ዳታቤዝ ማገናኛ
const dbURI = "mongodb+srv://robel:1252@cluster0.lkrow1p.mongodb.net/wana_bingo?retryWrites=true&w=majority";
mongoose.connect(dbURI)
  .then(() => console.log('🟢 MongoDB ዳታቤዝ በተሳካ ሁኔታ ተገናኝቷል!'))
  .catch((err) => console.error('🔴 የዳታቤዝ ግንኙነት ስህተት:', err));

const userSchema = new mongoose.Schema({
  username: { type: String, required: true },
  phone: { type: String, required: true, unique: true },
  balance: { type: Number, default: 0 }
});
const User = mongoose.model('User', userSchema);

app.post('/api/register', async (req, res) => {
  try {
    const { username, phone } = req.body;
    if (!phone) return res.status(400).json({ error: 'ስልክ ቁጥር ያስፈልጋል!' });
    let user = await User.findOne({ phone });
    if (user) return res.json({ message: 'እንኳን ደህና መጡ!', user });
    user = new User({ username: username || 'ተጫዋች', phone, balance: 0 });
    await user.save();
    res.status(201).json({ message: 'ምዝገባ ተሳክቷል!', user });
  } catch (err) {
    res.status(500).json({ error: 'የሰርቨር ስህተት' });
  }
});

// የጨዋታ ክፍሎች (በእርስዎ የተጠየቁት ትክክለኛ የብር መጠኖች: 20, 50, 100, 500, 1000)
const gameRooms = {
  20: { players: [], selectedNumbers: [], drawnNumbers: [], timer: 30, timerInterval: null, botInterval: null, isGameActive: true },
  50: { players: [], selectedNumbers: [], drawnNumbers: [], timer: 30, timerInterval: null, botInterval: null, isGameActive: true },
  100: { players: [], selectedNumbers: [], drawnNumbers: [], timer: 30, timerInterval: null, botInterval: null, isGameActive: true },
  500: { players: [], selectedNumbers: [], drawnNumbers: [], timer: 30, timerInterval: null, botInterval: null, isGameActive: true },
  1000: { players: [], selectedNumbers: [], drawnNumbers: [], timer: 30, timerInterval: null, botInterval: null, isGameActive: true }
};

io.on('connection', (socket) => {
  socket.on('joinRoom', ({ phone, amount }) => {
    if (gameRooms[amount]) {
      socket.join(amount.toString());
      if (!gameRooms[amount].players.includes(phone)) {
        gameRooms[amount].players.push(phone);
      }
      socket.emit('initRoomData', {
        timer: gameRooms[amount].timer,
        selectedNumbers: gameRooms[amount].selectedNumbers
      });
      startTimer(amount);
      startBots(amount);
    }
  });

  socket.on('selectNumber', ({ amount, number }) => {
    if (gameRooms[amount] && gameRooms[amount].isGameActive) {
      if (!gameRooms[amount].selectedNumbers.includes(number)) {
        gameRooms[amount].selectedNumbers.push(number);
        io.to(amount.toString()).emit('numberTaken', number);
      }
    }
  });

  socket.on('claimBingo', ({ amount, phone, username, selectedNumbers }) => {
    if (gameRooms[amount] && gameRooms[amount].isGameActive) {
      gameRooms[amount].isGameActive = false;
      if (gameRooms[amount].timerInterval) { clearInterval(gameRooms[amount].timerInterval); gameRooms[amount].timerInterval = null; }
      if (gameRooms[amount].botInterval) { clearInterval(gameRooms[amount].botInterval); gameRooms[amount].botInterval = null; }
      io.to(amount.toString()).emit('bingoWinner', { username: username || phone, winningNumbers: selectedNumbers });
    }
  });
});

function startTimer(amount) {
  if (gameRooms[amount].timerInterval) return;
  gameRooms[amount].timerInterval = setInterval(() => {
    if (!gameRooms[amount].isGameActive) return;
    gameRooms[amount].timer--;
    io.to(amount.toString()).emit('timerUpdate', gameRooms[amount].timer);
    if (gameRooms[amount].timer <= 0) {
      clearInterval(gameRooms[amount].timerInterval);
      gameRooms[amount].timerInterval = null;
      if (gameRooms[amount].botInterval) { clearInterval(gameRooms[amount].botInterval); gameRooms[amount].botInterval = null; }
      const luckyNumbers = [];
      while (luckyNumbers.length < 20) {
        const rand = Math.floor(Math.random() * 80) + 1;
        if (!luckyNumbers.includes(rand)) luckyNumbers.push(rand);
      }
      gameRooms[amount].drawnNumbers = luckyNumbers;
      io.to(amount.toString()).emit('drawResult', luckyNumbers);
      setTimeout(() => {
        gameRooms[amount].timer = 30;
        gameRooms[amount].selectedNumbers = [];
        gameRooms[amount].drawnNumbers = [];
        gameRooms[amount].isGameActive = true;
        io.to(amount.toString()).emit('resetBoard');
        startTimer(amount);
        startBots(amount);
      }, 5000);
    }
  }, 1000);
}

function startBots(amount) {
  if (gameRooms[amount].botInterval) return;
  gameRooms[amount].botInterval = setInterval(() => {
    if (!gameRooms[amount].isGameActive) return;
    const availableNumbers = [];
    for (let i = 1; i <= 80; i++) {
      if (!gameRooms[amount].selectedNumbers.includes(i)) availableNumbers.push(i);
    }
    if (gameRooms[amount].selectedNumbers.length < 45 && availableNumbers.length > 0) {
      const randomIndex = Math.floor(Math.random() * availableNumbers.length);
      const botNumber = availableNumbers[randomIndex];
      gameRooms[amount].selectedNumbers.push(botNumber);
      io.to(amount.toString()).emit('numberTaken', botNumber);
    }
  }, 500);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 ሰርቨሩ በ Port ${PORT} ላይ እየሰራ ይገኛል...`);
});
