const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- 1. ዳታቤዝ ማዘጋጀት (SQLite) ---
const db = new sqlite3.Database('./bingo.db', (err) => {
    if (err) console.error('የዳታቤዝ ስህተት:', err.message);
    else console.log('ከ SQLite ዳታቤዝ ጋር ተገናኝቷል!');
});

// ቴብሎችን መፍጠር (ከተጠቃሚ ምዝገባ እስከ ዴፖዚት እና ዊዝድሮ)
db.serialize(() => {
    // የተጠቃሚዎች ቴብል (መጀመሪያ ሲመዘገቡ 50 ብር ቦነስ እንዲኖራቸው ይደረጋል)
    db.run(`CREATE TABLE IF NOT EXISTS users (
        telegramId TEXT PRIMARY KEY,
        name TEXT,
        balance REAL DEFAULT 50.0,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // የገቢ (Deposit) ጥያቄዎች ቴብል
    db.run(`CREATE TABLE IF NOT EXISTS deposits (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        telegramId TEXT,
        amount REAL,
        smsText TEXT,
        status TEXT DEFAULT 'pending',
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // የወጪ (Withdraw) ጥያቄዎች ቴብል
    db.run(`CREATE TABLE IF NOT EXISTS withdrawals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        telegramId TEXT,
        amount REAL,
        accountDetails TEXT,
        status TEXT DEFAULT 'pending',
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
});

// --- 2. የኤፒአይ (API) ክፍሎች ---

// ተጠቃሚን መመዝገብ ወይም መረጃውን ማምጣት (Register / Login)
app.post('/api/register', (req, res) => {
    const { telegramId, name } = req.body;
    if (!telegramId) return res.status(400).json({ success: false, error: 'Telegram ID ያስፈልጋል' });

    db.get(`SELECT * FROM users WHERE telegramId = ?`, [telegramId], (err, row) => {
        if (err) return res.status(500).json({ success: false, error: err.message });
        
        if (row) {
            // ተጠቃሚው ቀደም ብሎ ከነበረ υ መረጃውን እንመልሳለን
            res.json({ success: true, user: row });
        } else {
            // አዲስ ተጠቃሚ ሲመዘገብ 50 ብር ቦነስ እንሰጠዋለን
            db.run(`INSERT INTO users (telegramId, name, balance) VALUES (?, ?, ?)`, [telegramId, name || 'Player', 50.0], function(err) {
                if (err) return res.status(500).json({ success: false, error: err.message });
                res.json({ success: true, user: { telegramId, name, balance: 50.0 } });
            });
        }
    });
});

// --- 3. የሶኬት (Socket.io) ሎጅክ (ገቢ፣ ወጪ እና ጨዋታ) ---

io.on('connection', (socket) => {
    console.log('አዲስ ተጠቃሚ ተገናኝቷል:', socket.id);

    // 📥 1. የዲፖዚት (ገቢ ማስገባት) ጥያቄ መቀበል
    socket.on('requestDeposit', (data) => {
        const { telegramId, amount, smsText } = data;
        if (!telegramId || !amount || !smsText) return;

        db.run(`INSERT INTO deposits (telegramId, amount, smsText, status) VALUES (?, ?, ?, 'pending')`, 
            [telegramId, amount, smsText], (err) => {
                if (err) {
                    console.error('Deposit Error:', err.message);
                } else {
                    console.log(`📥 አዲስ የገቢ ጥያቄ ደርሷል፦ ተጠቃሚ ID: ${telegramId}, መጠን: ${amount} ብር`);
                    socket.emit('depositResponse', { success: true, message: 'የዲፖዚት ጥያቄዎ ለአድሚን ተልኳል!' });
                }
            }
        );
    });

    // 📤 2. የወጪ (Withdraw / ብር ማውጣት) ጥያቄ መቀበል
    socket.on('requestWithdraw', (data) => {
        const { telegramId, amount, accountDetails } = data;
        if (!telegramId || !amount || !accountDetails) return;

        // መጀመሪያ ተጠቃሚው በቂ ባላንስ እንዳለው እናረጋግጣለን
        db.get(`SELECT balance FROM users WHERE telegramId = ?`, [telegramId], (err, row) => {
            if (err || !row) {
                socket.emit('withdrawResponse', { success: false, message: 'ተጠቃሚው አልተገኘም!' });
                return;
            }

            if (row.balance >= amount) {
                // ከሂሳቡ ወዲያውኑ ገንዘቡን እንቀንሳለን (Pending እስኪሆን ድረስ)
                db.run(`UPDATE users SET balance = balance - ? WHERE telegramId = ?`, [amount, telegramId], (updateErr) => {
                    if (updateErr) {
                        socket.emit('withdrawResponse', { success: false, message: 'ስህተት ተፈጥሯል!' });
                        return;
                    }

                    // የዊዝድሮ ጥያቄውን በዳታቤዝ እንመዘግባለን
                    db.run(`INSERT INTO withdrawals (telegramId, amount, accountDetails, status) VALUES (?, ?, ?, 'pending')`, 
                        [telegramId, amount, accountDetails], () => {
                            console.log(`📤 አዲስ የወጪ ጥያቄ፦ ተጠቃሚ ID: ${telegramId}, መጠን: ${amount} ብር`);
                            socket.emit('withdrawResponse', { success: true, message: 'የወጪ ጥያቄዎ በተሳካ ሁኔታ ተልኳል!', newBalance: row.balance - amount });
                        }
                    );
                });
            } else {
                socket.emit('withdrawResponse', { success: false, message: 'በቂ የሂሳብ መጠን (Balance) የለዎትም!' });
            }
        });
    });

    // 🎮 የቢንጎ ጨዋታ ቆጣሪ እና ቁጥር ማውጣት ሂደት
    socket.on('startGame', () => {
        let drawnHistory = [];
        let interval = setInterval(() => {
            if (drawnHistory.length >= 75) {
                clearInterval(interval);
                return;
            }
            let randNum;
            do {
                randNum = Math.floor(Math.random() * 75) + 1;
            } while (drawnHistory.includes(randNum));

            drawnHistory.push(randNum);

            // ለሁሉም ተጫዋቾች የወጣውን ቁጥር በቅጽበት እንልካለን
            io.emit('numberDrawn', { number: randNum, drawnHistory });
        }, 3000);

        socket.on('disconnect', () => {
            clearInterval(interval);
        });
    });

    socket.on('disconnect', () => {
        console.log('ተጠቃሚው ከሰርቨር ወጥቷል:', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`የቢንጎ ሰርቨር በፖርት ${PORT} እየሰራ ይገኛል...`);
});
