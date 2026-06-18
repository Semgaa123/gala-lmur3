const express = require('express');
const session = require('express-session');
const Database = require('better-sqlite3');
const path = require('path');
const multer = require('multer');
const bcrypt = require('bcrypt');
const saltRounds = 10;
const QRCode = require('qrcode');
const fs = require('fs');

// Создаём папку для загрузки фото, если её нет
if (!fs.existsSync('public/uploads')) {
    fs.mkdirSync('public/uploads', { recursive: true });
}

const app = express();
const PORT = process.env.PORT || 3000;

const db = new Database('gala.db');
db.pragma('journal_mode = WAL');

db.exec(`
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        full_name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        phone TEXT,
        password_hash TEXT NOT NULL,
        role TEXT DEFAULT 'user',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS dresses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        seller_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        price_per_day INTEGER NOT NULL,
        image_url TEXT,
        sizes TEXT NOT NULL,
        category TEXT DEFAULT 'wedding',
        status TEXT DEFAULT 'active',
        sort_order INTEGER DEFAULT 100,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (seller_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS bookings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        dress TEXT NOT NULL,
        size TEXT NOT NULL,
        date_start TEXT NOT NULL,
        date_end TEXT NOT NULL,
        days INTEGER NOT NULL,
        total TEXT NOT NULL,
        commission TEXT NOT NULL DEFAULT '0',
        status TEXT DEFAULT 'new',
        address TEXT,
        delivery_time TEXT,
        delivery_type TEXT DEFAULT 'delivery',
        return_status TEXT,
        return_reason TEXT,
        return_photo TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        user_name TEXT NOT NULL,
        user_email TEXT NOT NULL,
        message TEXT NOT NULL,
        admin_reply TEXT,
        status TEXT DEFAULT 'new',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS cart (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        dress_name TEXT NOT NULL,
        dress_price INTEGER NOT NULL,
        dress_image TEXT,
        dress_sizes TEXT,
        added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
`);

console.log('✅ База данных готова!');

app.use(express.json());
app.use(express.static('public'));
app.get('/', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'index.html')); });
app.use(session({ secret: 'gala-secret-key-2024', resave: false, saveUninitialized: false, cookie: { maxAge: 24 * 60 * 60 * 1000 } }));

const storage = multer.diskStorage({
    destination: function (req, file, cb) { cb(null, 'public/uploads/'); },
    filename: function (req, file, cb) { const uniqueName = Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname); cb(null, uniqueName); }
});
const upload = multer({ storage: storage });

// ========== РЕГИСТРАЦИЯ ==========
app.post('/api/register', async (req, res) => {
    const { full_name, email, phone, password } = req.body;
    if (!full_name || !email || !password) return res.json({ success: false, message: 'Заполните ФИО, Email и Пароль' });
    const userExists = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (userExists) return res.json({ success: false, message: 'Пользователь с таким email уже существует' });
    try {
        const hashedPassword = await bcrypt.hash(password, saltRounds);
        const result = db.prepare('INSERT INTO users (full_name, email, phone, password_hash) VALUES (?, ?, ?, ?)').run(full_name, email, phone || '', hashedPassword);
        req.session.userId = result.lastInsertRowid; req.session.userName = full_name;
        res.json({ success: true, message: 'Регистрация успешна!' });
    } catch (err) { res.json({ success: false, message: 'Ошибка сервера' }); }
});

// ========== ВХОД ==========
app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user) return res.json({ success: false, message: 'Неверный email или пароль' });
    try {
        const match = await bcrypt.compare(password, user.password_hash);
        if (!match) return res.json({ success: false, message: 'Неверный email или пароль' });
        req.session.userId = user.id; req.session.userName = user.full_name;
        res.json({ success: true, message: 'Вход выполнен!', user: { id: user.id, name: user.full_name } });
    } catch (err) { res.json({ success: false, message: 'Ошибка сервера' }); }
});

// ========== ПРОВЕРИТЬ АВТОРИЗАЦИЮ ==========
app.get('/api/me', (req, res) => {
    if (req.session.userId) {
        const user = db.prepare('SELECT role FROM users WHERE id = ?').get(req.session.userId);
        res.json({ loggedIn: true, user: { id: req.session.userId, name: req.session.userName, role: user ? user.role : 'user' } });
    } else res.json({ loggedIn: false });
});

// ========== ВЫХОД ==========
app.post('/api/logout', (req, res) => { req.session.destroy(); res.json({ success: true, message: 'Вы вышли' }); });

// ========== КОРЗИНА ==========
app.post('/api/cart', (req, res) => {
    if (!req.session.userId) return res.json({ success: false, message: 'Не авторизован' });
    const { dress_name, dress_price, dress_image, dress_sizes } = req.body;
    const exists = db.prepare('SELECT id FROM cart WHERE user_id = ? AND dress_name = ?').get(req.session.userId, dress_name);
    if (exists) return res.json({ success: false, message: 'Уже в корзине' });
    db.prepare('INSERT INTO cart (user_id, dress_name, dress_price, dress_image, dress_sizes) VALUES (?, ?, ?, ?, ?)').run(req.session.userId, dress_name, dress_price, dress_image || '', dress_sizes || '');
    res.json({ success: true, message: 'Добавлено в корзину!' });
});
app.get('/api/cart', (req, res) => {
    if (!req.session.userId) return res.json({ success: false, cart: [] });
    res.json({ success: true, cart: db.prepare('SELECT * FROM cart WHERE user_id = ? ORDER BY added_at DESC').all(req.session.userId) });
});
app.delete('/api/cart/:id', (req, res) => {
    if (!req.session.userId) return res.json({ success: false, message: 'Не авторизован' });
    db.prepare('DELETE FROM cart WHERE id = ? AND user_id = ?').run(req.params.id, req.session.userId);
    res.json({ success: true, message: 'Удалено из корзины' });
});

// ========== БРОНИРОВАНИЕ ==========
app.post('/api/bookings', (req, res) => {
    try {
        if (!req.session.userId) return res.json({ success: false, message: 'Нужно войти или зарегистрироваться' });
        const { dress, size, date_start, date_end, days, total, address, delivery_time, delivery_type } = req.body;

        const conflict = db.prepare("SELECT * FROM bookings WHERE dress = ? AND status IN ('new', 'paid') AND NOT (date_end <= ? OR date_start >= ?)").get(dress, date_start, date_end);
        if (conflict) return res.json({ success: false, message: 'Наряд уже забронирован на эти даты' });

        const totalNum = typeof total === 'string' ? parseInt(total.replace(/[^0-9]/g, '')) : total;
        if (!totalNum || totalNum <= 0) return res.json({ success: false, message: 'Некорректная сумма' });
        const commission = Math.round(totalNum * 0.15);
        const commissionStr = commission.toLocaleString('ru-RU') + ' ₽';
        const totalStr = totalNum.toLocaleString('ru-RU') + ' ₽';

        const result = db.prepare('INSERT INTO bookings (user_id, dress, size, date_start, date_end, days, total, commission, status, address, delivery_time, delivery_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
            .run(req.session.userId, dress, size, date_start, date_end, days, totalStr, commissionStr, 'paid', address || '', delivery_time || '', delivery_type || 'delivery');
        
        db.prepare('DELETE FROM cart WHERE user_id = ? AND dress_name = ?').run(req.session.userId, dress);
        db.prepare("UPDATE dresses SET status = 'hidden' WHERE title = ?").run(dress);
        
        console.log(`📦 Бронь #${result.lastInsertRowid}: ${dress} | Комиссия: ${commissionStr}`);
        res.json({ success: true, message: 'Оплачено!', bookingId: result.lastInsertRowid, commission: commissionStr });
    } catch(e) {
        console.error('❌ Ошибка бронирования:', e);
        res.json({ success: false, message: 'Ошибка сервера: ' + e.message });
    }
});

app.get('/api/bookings', (req, res) => {
    if (!req.session.userId) return res.json({ success: false, bookings: [] });
    res.json({ success: true, bookings: db.prepare('SELECT * FROM bookings WHERE user_id = ? ORDER BY created_at DESC').all(req.session.userId) });
});

app.get('/api/purchases', (req, res) => {
    if (!req.session.userId) return res.json({ success: false, purchases: [] });
    res.json({ success: true, purchases: db.prepare("SELECT * FROM bookings WHERE user_id = ? AND status IN ('paid','returned') ORDER BY created_at DESC").all(req.session.userId) });
});

app.delete('/api/bookings/:id', (req, res) => {
    if (!req.session.userId) return res.json({ success: false, message: 'Не авторизован' });
    db.prepare('DELETE FROM bookings WHERE id = ? AND user_id = ?').run(req.params.id, req.session.userId);
    res.json({ success: true, message: 'Бронирование удалено' });
});

// ========== ОПЛАТА ==========
app.post('/api/bookings/:id/pay', (req, res) => {
    if (!req.session.userId) return res.json({ success: false, message: 'Не авторизован' });
    const booking = db.prepare('SELECT * FROM bookings WHERE id = ? AND user_id = ?').get(req.params.id, req.session.userId);
    if (!booking) return res.json({ success: false, message: 'Бронирование не найдено' });
    if (booking.status === 'paid') return res.json({ success: false, message: 'Уже оплачено' });
    const { address, delivery_time, delivery_type } = req.body;
    db.prepare('UPDATE bookings SET status = ?, address = ?, delivery_time = ?, delivery_type = ? WHERE id = ?').run('paid', address || booking.address, delivery_time || booking.delivery_time, delivery_type || booking.delivery_type, req.params.id);
    db.prepare("UPDATE dresses SET status = 'hidden' WHERE title = ?").run(booking.dress);
    console.log(`💰 Бронь #${req.params.id} оплачена!`);
    res.json({ success: true, message: 'Оплата подтверждена!' });
});

// ========== QR ==========
app.get('/api/bookings/:id/qr', (req, res) => {
    if (!req.session.userId) return res.json({ success: false });
    const booking = db.prepare('SELECT * FROM bookings WHERE id = ? AND user_id = ?').get(req.params.id, req.session.userId);
    if (!booking) return res.json({ success: false });
    QRCode.toDataURL(`Заказ #${booking.id}\n${booking.dress}\nСумма: ${booking.total}`, { width: 250 }, (err, url) => {
        if (err) return res.json({ success: false });
        res.json({ success: true, qr: url });
    });
});

// ========== ВОЗВРАТ ==========
app.post('/api/bookings/:id/return', upload.single('return_photo'), (req, res) => {
    if (!req.session.userId) return res.json({ success: false, message: 'Не авторизован' });
    const booking = db.prepare('SELECT * FROM bookings WHERE id = ? AND user_id = ?').get(req.params.id, req.session.userId);
    if (!booking) return res.json({ success: false, message: 'Бронирование не найдено' });
    if (booking.status !== 'paid') return res.json({ success: false, message: 'Только оплаченные заказы' });
    db.prepare('UPDATE bookings SET return_status = ?, return_reason = ?, return_photo = ? WHERE id = ?').run('requested', req.body.return_reason || '', req.file ? '/uploads/' + req.file.filename : null, req.params.id);
    res.json({ success: true, message: 'Заявка на возврат отправлена' });
});

// ========== СООБЩЕНИЯ ==========
app.post('/api/messages', (req, res) => {
    const { user_name, user_email, message } = req.body;
    if (!user_name || !user_email || !message) return res.json({ success: false, message: 'Заполните все поля' });
    db.prepare('INSERT INTO messages (user_id, user_name, user_email, message) VALUES (?, ?, ?, ?)').run(req.session.userId || null, user_name, user_email, message);
    res.json({ success: true, message: 'Сообщение отправлено!' });
});

// ========== НАРЯДЫ ==========
app.post('/api/dresses', upload.array('images', 5), (req, res) => {
    if (!req.session.userId) return res.json({ success: false, message: 'Не авторизован' });
    const { title, description, price_per_day, sizes, category } = req.body;
    if (!title || !price_per_day || !sizes) return res.json({ success: false, message: 'Заполните название, цену и размеры' });
    const image_url = req.files ? req.files.map(f => '/uploads/' + f.filename).join(',') : null;
    db.prepare('INSERT INTO dresses (seller_id, title, description, price_per_day, image_url, sizes, category) VALUES (?, ?, ?, ?, ?, ?, ?)').run(req.session.userId, title, description || '', parseInt(price_per_day), image_url, sizes, category || 'wedding');
    res.json({ success: true, message: 'Наряд добавлен!' });
});

app.get('/api/my-dresses', (req, res) => {
    if (!req.session.userId) return res.json({ success: false, dresses: [] });
    res.json({ success: true, dresses: db.prepare('SELECT * FROM dresses WHERE seller_id = ? ORDER BY created_at DESC').all(req.session.userId) });
});

app.get('/api/dresses', (req, res) => {
    res.json(db.prepare("SELECT * FROM dresses WHERE status = 'active' ORDER BY sort_order, created_at DESC").all());
});

app.put('/api/dresses/:id', upload.array('images', 5), (req, res) => {
    if (!req.session.userId) return res.json({ success: false, message: 'Не авторизован' });
    const dress = db.prepare('SELECT * FROM dresses WHERE id = ? AND seller_id = ?').get(req.params.id, req.session.userId);
    if (!dress) return res.json({ success: false, message: 'Наряд не найден' });
    const { title, description, price_per_day, sizes, category } = req.body;
    if (!title || !price_per_day || !sizes) return res.json({ success: false, message: 'Заполните название, цену и размеры' });
    let image_url = dress.image_url;
    if (req.files && req.files.length > 0) image_url = req.files.map(f => '/uploads/' + f.filename).join(',');
    db.prepare('UPDATE dresses SET title = ?, description = ?, price_per_day = ?, image_url = ?, sizes = ?, category = ? WHERE id = ?').run(title, description || '', parseInt(price_per_day), image_url, sizes, category || 'wedding', req.params.id);
    res.json({ success: true, message: 'Наряд обновлён!' });
});

app.delete('/api/dresses/:id', (req, res) => {
    if (!req.session.userId) return res.json({ success: false, message: 'Не авторизован' });
    const dress = db.prepare('SELECT * FROM dresses WHERE id = ? AND seller_id = ?').get(req.params.id, req.session.userId);
    if (!dress) return res.json({ success: false, message: 'Наряд не найден' });
    db.prepare('DELETE FROM dresses WHERE id = ?').run(req.params.id);
    res.json({ success: true, message: 'Наряд удалён' });
});

// ========== АДМИН ==========
app.get('/api/admin/check', (req, res) => {
    if (!req.session.userId) return res.json({ admin: false });
    const user = db.prepare('SELECT role FROM users WHERE id = ?').get(req.session.userId);
    res.json({ admin: user && user.role === 'admin' });
});
app.get('/api/admin/users', (req, res) => {
    if (!req.session.userId) return res.json({ success: false });
    const user = db.prepare('SELECT role FROM users WHERE id = ?').get(req.session.userId);
    if (!user || user.role !== 'admin') return res.json({ success: false });
    res.json({ success: true, users: db.prepare('SELECT u.*, COUNT(b.id) as order_count FROM users u LEFT JOIN bookings b ON u.id = b.user_id GROUP BY u.id ORDER BY u.created_at DESC').all() });
});
app.get('/api/admin/bookings', (req, res) => {
    if (!req.session.userId) return res.json({ success: false });
    const user = db.prepare('SELECT role FROM users WHERE id = ?').get(req.session.userId);
    if (!user || user.role !== 'admin') return res.json({ success: false });
    const bookings = db.prepare('SELECT bookings.*, users.full_name, users.email FROM bookings JOIN users ON bookings.user_id = users.id ORDER BY bookings.created_at DESC').all();
    const stats = db.prepare("SELECT COUNT(*) as total, SUM(CASE WHEN status='new' THEN 1 ELSE 0 END) as new_count, SUM(CASE WHEN status='paid' THEN 1 ELSE 0 END) as paid_count, SUM(CASE WHEN status='returned' THEN 1 ELSE 0 END) as returned_count, SUM(CASE WHEN return_status='requested' THEN 1 ELSE 0 END) as return_requests FROM bookings").get();
    res.json({ success: true, bookings, stats });
});
app.put('/api/admin/bookings/:id/return', (req, res) => {
    if (!req.session.userId) return res.json({ success: false });
    const admin = db.prepare('SELECT role FROM users WHERE id = ?').get(req.session.userId);
    if (!admin || admin.role !== 'admin') return res.json({ success: false });
    const { action } = req.body;
    const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(req.params.id);
    if (!booking) return res.json({ success: false });
    if (action === 'confirm') { db.prepare("UPDATE bookings SET return_status='confirmed', status='returned' WHERE id=?").run(req.params.id); db.prepare("UPDATE dresses SET status='active' WHERE title=?").run(booking.dress); }
    else db.prepare("UPDATE bookings SET return_status='rejected' WHERE id=?").run(req.params.id);
    res.json({ success: true });
});
app.get('/api/admin/dresses', (req, res) => {
    if (!req.session.userId) return res.json({ success: false });
    const admin = db.prepare('SELECT role FROM users WHERE id = ?').get(req.session.userId);
    if (!admin || admin.role !== 'admin') return res.json({ success: false });
    res.json({ success: true, dresses: db.prepare('SELECT dresses.*, users.full_name as seller_name FROM dresses JOIN users ON dresses.seller_id = users.id ORDER BY dresses.created_at DESC').all() });
});
app.put('/api/admin/dresses/:id', (req, res) => {
    if (!req.session.userId) return res.json({ success: false });
    const admin = db.prepare('SELECT role FROM users WHERE id = ?').get(req.session.userId);
    if (!admin || admin.role !== 'admin') return res.json({ success: false });
    db.prepare('UPDATE dresses SET status = ? WHERE id = ?').run(req.body.status, req.params.id);
    res.json({ success: true });
});
app.get('/api/admin/messages', (req, res) => {
    if (!req.session.userId) return res.json({ success: false });
    const admin = db.prepare('SELECT role FROM users WHERE id = ?').get(req.session.userId);
    if (!admin || admin.role !== 'admin') return res.json({ success: false });
    res.json({ success: true, messages: db.prepare('SELECT * FROM messages ORDER BY created_at DESC').all() });
});
app.put('/api/admin/messages/:id', (req, res) => {
    if (!req.session.userId) return res.json({ success: false });
    const admin = db.prepare('SELECT role FROM users WHERE id = ?').get(req.session.userId);
    if (!admin || admin.role !== 'admin') return res.json({ success: false });
    db.prepare('UPDATE messages SET admin_reply = ?, status = ? WHERE id = ?').run(req.body.reply || '', 'answered', req.params.id);
    res.json({ success: true });
});
app.put('/api/admin/users/:id/role', (req, res) => {
    if (!req.session.userId) return res.json({ success: false });
    const admin = db.prepare('SELECT role FROM users WHERE id = ?').get(req.session.userId);
    if (!admin || admin.role !== 'admin') return res.json({ success: false });
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(req.body.role, req.params.id);
    res.json({ success: true });
});

// Временный эндпоинт
app.get('/api/make-admin/:email', (req, res) => {
    const result = db.prepare("UPDATE users SET role = 'admin' WHERE email = ?").run(req.params.email);
    res.json({ success: result.changes > 0, message: result.changes > 0 ? 'Админ готов!' : 'Не найден' });
});

app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Сервер запущен: http://localhost:${PORT}`));