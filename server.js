const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const TelegramBot = require('node-telegram-bot-api');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static('public'));

// የቴሌግራም ቦት ቶከን
const TOKEN = '8957133551:AAGBPCGEzFLtJRXHRU0PfKJ2QXDf1AyvXec';
const bot = new TelegramBot(TOKEN, { polling: true });

// /start ሲሉ ዌብ አፑን የሚልክ ቦት ሎጂክ
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, 'ወደ ዋና ቢንጎ እንኳን በደህና መጡ! ጨዋታውን ለመጀመር ከታች ያለውን በተን ይጫኑ:', {
    reply_markup: {
      inline_keyboard: [
        [{ text: '🎮 ቢንጎ ጨዋታውን ክፈት', web_app: { url: 'https://wana-bingo.onrender.com' } }]
      ]
    }
  });
});

// MongoDB ዳታቤዝ ማገናኛ
const dbURI = "mongodb+srv://robel:1252@cluster0.lkrow1p.mongodb.net/wana_bingo?retryWrites=true&w=majority";

mongoose.connect(dbURI)
  .then(() => console.log('🟢 MongoDB ዳታቤዝ በተሳካ ሁኔታ ተገናኝቷል!'))
  .catch((err) => console.error('🔴 የዳታቤዝ ግንኙነት ስህተት:', err));

// የተጠቃሚ ሞዴል
const userSchema = new mongoose.Schema({
  username: { type: String, required: true },
  phone: { type: String, required: true, unique: true },
  balance: { type: Number, default: 0 }
});
const User = mongoose.model('User', userSchema);

// የምዝገባ API
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

// የጨዋታ ክፍሎች (50, 100, 150, 200 ብር)
const gameRooms = {
  50: { players: [], selectedNumbers: [], drawnNumbers: [], timer: 30, timerInterval: null, botInterval: null, isGameActive: true },
  100: { players: [], selectedNumbers: [], drawnNumbers: [], timer: 30, timerInterval: null, botInterval: null, isGameActive: true },
  150: { players: [], selectedNumbers: [], drawnNumbers: [], timer: 30, timerInterval: null, botInterval: null, isGameActive: true },
  200: { players: [], selectedNumbers: [], drawnNumbers: [], timer: 30, timerInterval: null, botInterval: null, isGameActive: true }
};

io.on('connection', (socket) => {
  console.log('⚡ ተጫዋች ተገናኝቷል:', socket.id);

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
      
      if (gameRooms[amount].timerInterval) {
        clearInterval(gameRooms[amount].timerInterval);
        gameRooms[amount].timerInterval = null;
      }
      if (gameRooms[amount].botInterval) {
        clearInterval(gameRooms[amount].botInterval);
        gameRooms[amount].botInterval = null;
      }

      io.to(amount.toString()).emit('bingoWinner', {
        username: username || phone,
        winningNumbers: selectedNumbers
      });
    }
  });

  socket.on('disconnect', () => {
    console.log('❌ ተጫዋች ወጥቷል:', socket.id);
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

      if (gameRooms[amount].botInterval) {
        clearInterval(gameRooms[amount].botInterval);
        gameRooms[amount].botInterval = null;
      }

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