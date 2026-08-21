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

// MongoDB ዳታቤዝ ግንኙነት
const dbURI = "mongodb+srv://robel:1252@cluster0.lkrow1p.mongodb.net/wana_bingo?retryWrites=true&w=majority";
mongoose.connect(dbURI)
  .then(() => console.log('🟢 MongoDB ዳታቤዝ በተሳካ ሁኔታ ተገናኝቷል!'))
  .catch((err) => console.error('🔴 የዳታቤዝ ግንኙነት ስህተት:', err));

const userSchema = new mongoose.Schema({
  chatId: { type: String, unique: true },
  username: String,
  phone: { type: String, unique: true },
  balance: { type: Number, default: 0 }
});
const User = mongoose.model('User', userSchema);

// የቦት ጅምር (Start)
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, "🎮 ወደ ዋና ቢንጎ (Wana Bingo) እንኳን በደህና መጡ! ለመጫወት መጀመሪያ መመዝገብ አለብዎት።", {
    reply_markup: {
      inline_keyboard: [
        [{ text: '👤 Register (መመዝገብ)', callback_data: 'register' }]
      ]
    }
  });
});

bot.on('callback_query', (query) => {
  const chatId = query.message.chat.id;
  if (query.data === 'register') {
    bot.sendMessage(chatId, "እባክዎ ምዝገባዎን ለመጨረስ ከታች ያለውን 'Share Phone Number' በተን ይጫኑ።", {
      reply_markup: {
        keyboard: [[{ text: '📞 Share Phone Number', request_contact: true }]],
        one_time_keyboard: true,
        resize_keyboard: true
      }
    });
  }
});

// ስልክ ቁጥር ሲያካፍል በዳታቤዝ መመዝገብ
bot.on('contact', async (msg) => {
  const chatId = msg.chat.id;
  const phone = msg.contact.phone_number;
  const username = msg.from.first_name || 'ተጫዋች';

  try {
    let user = await User.findOne({ phone });
    if (!user) {
      user = new User({ chatId, username, phone, balance: 0 });
      await user.save();
    } else {
      user.chatId = chatId;
      await user.save();
    }

    bot.sendMessage(chatId, "✅ You have been successfully registered! Click below to play.", {
      reply_markup: {
        inline_keyboard: [
          [{ text: '🎮 Play Now (ሚኒ አፕ ክፈት)', web_app: { url: 'https://wana-bingo.onrender.com' } }]
        ]
      }
    });
  } catch (err) {
    bot.sendMessage(chatId, "⚠️ በምዝገባ ወቅት ስህተት ተፈጥሯል፣ እባክዎ እንደገና ይሞክሩ።");
  }
});

// ተጠቃሚውን በስልክ ቁጥር ከዳታቤዝ መፈለጊያ API
app.get('/api/user/:phone', async (req, res) => {
  try {
    const user = await User.findOne({ phone: req.params.phone });
    if (!user) return res.status(404).json({ error: 'ተጠቃሚው አልተገኘም' });
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: 'የሰርቨር ስህተት' });
  }
});

// ለእያንዳንዱ የክፍል መጠን (Room) የተያዙ ቁጥሮች መቆጣጠሪያ
const roomStates = {
  20: { takenNumbers: new Set() },
  50: { takenNumbers: new Set() },
  100: { takenNumbers: new Set() },
  500: { takenNumbers: new Set() },
  1000: { takenNumbers: new Set() }
};

io.on('connection', (socket) => {
  socket.on('joinRoom', ({ amount }) => {
    socket.join(amount.toString());
    if (roomStates[amount]) {
      socket.emit('syncTakenNumbers', Array.from(roomStates[amount].takenNumbers));
    }
  });

  socket.on('selectNumber', ({ amount, number }) => {
    if (roomStates[amount] && !roomStates[amount].takenNumbers.has(number)) {
      roomStates[amount].takenNumbers.add(number);
      io.to(amount.toString()).emit('numberTaken', number);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 ሰርቨሩ በ Port ${PORT} ላይ እየሰራ ይገኛል...`);
});
