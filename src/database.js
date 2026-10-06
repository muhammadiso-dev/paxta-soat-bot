const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'soat_db.json');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const defaultDb = {
  users: {},
  payments: [],
  logs: [],
  settings: {
    tariffs: {
      '1m': { name: '1 Oylik', price: 500, days: 30 },
      '6m': { name: '6 Oylik', price: 2400, days: 180 },
      '1y': { name: '1 Yillik VIP', price: 4200, days: 365 }
    }
  }
};

let db = { ...defaultDb };

function loadDb() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const data = fs.readFileSync(DB_FILE, 'utf8');
      db = { ...defaultDb, ...JSON.parse(data) };
      if (!db.settings) db.settings = { ...defaultDb.settings };
      if (!db.settings.tariffs) db.settings.tariffs = { ...defaultDb.settings.tariffs };
    } else {
      saveDb();
    }
  } catch (err) {
    console.error('Database load error:', err);
    db = { ...defaultDb };
  }
}

function saveDb() {
  try {
    const tmp = `${DB_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf8');
    fs.renameSync(tmp, DB_FILE);
  } catch (err) {
    console.error('Database save error:', err);
  }
}

loadDb();

const dbService = {
  getOrCreateUser(userId, data = {}) {
    const uid = String(userId);
    if (!db.users[uid]) {
      db.users[uid] = {
        id: uid,
        username: data.username || '',
        first_name: data.first_name || '',
        paxta_username: '',
        paxta_password: '',
        base_name: data.first_name || 'User',
        clock_style: 'style_1', // default: Name | ⏰ 15:45
        clock_active: false,
        sub_until: null,
        is_trial_used: false,
        cookies: '',
        last_error: null,
        last_updated_at: null,
        step: null, // login flow: 'await_login' | 'await_password' | 'await_basename'
        created_at: new Date().toISOString()
      };
      saveDb();
    } else {
      if (data.username) db.users[uid].username = data.username;
      if (data.first_name) db.users[uid].first_name = data.first_name;
    }
    return db.users[uid];
  },

  getUser(userId) {
    return db.users[String(userId)] || null;
  },

  updateUser(userId, updates) {
    const uid = String(userId);
    if (db.users[uid]) {
      Object.assign(db.users[uid], updates);
      saveDb();
      return db.users[uid];
    }
    return null;
  },

  getAllUsers() {
    return Object.values(db.users);
  },

  getActiveClockUsers() {
    const now = Date.now();
    return Object.values(db.users).filter(u => {
      if (!u.clock_active || !u.paxta_username || !u.paxta_password) return false;
      if (!u.sub_until) return false;
      return new Date(u.sub_until).getTime() > now;
    });
  },

  addSubscription(userId, days) {
    const user = this.getOrCreateUser(userId);
    const now = Date.now();
    let currentExpiry = user.sub_until ? new Date(user.sub_until).getTime() : now;
    if (currentExpiry < now) currentExpiry = now;

    const newExpiry = new Date(currentExpiry + days * 24 * 60 * 60 * 1000).toISOString();
    user.sub_until = newExpiry;
    user.clock_active = true;
    saveDb();
    return user;
  },

  activateTrial(userId, minutes = 30) {
    const user = this.getOrCreateUser(userId);
    if (user.is_trial_used) return false;

    const expiry = new Date(Date.now() + minutes * 60 * 1000).toISOString();
    user.sub_until = expiry;
    user.is_trial_used = true;
    user.clock_active = true;
    saveDb();
    return true;
  },

  isSubscribed(userId) {
    const user = this.getUser(userId);
    if (!user || !user.sub_until) return false;
    return new Date(user.sub_until).getTime() > Date.now();
  },

  getStats() {
    const users = Object.values(db.users);
    const now = Date.now();
    const activeSubs = users.filter(u => u.sub_until && new Date(u.sub_until).getTime() > now);
    const activeClocks = users.filter(u => u.clock_active && u.sub_until && new Date(u.sub_until).getTime() > now);

    return {
      totalUsers: users.length,
      activeSubs: activeSubs.length,
      activeClocks: activeClocks.length
    };
  },

  getTariffs() {
    if (!db.settings) db.settings = {};
    if (!db.settings.tariffs) {
      db.settings.tariffs = {
        '1m': { name: '1 Oylik', price: 500, days: 30 },
        '6m': { name: '6 Oylik', price: 2400, days: 180 },
        '1y': { name: '1 Yillik VIP', price: 4200, days: 365 }
      };
      saveDb();
    }
    return db.settings.tariffs;
  },

  setTariffPrice(plan, price) {
    const tariffs = this.getTariffs();
    if (tariffs[plan]) {
      tariffs[plan].price = parseInt(price);
      saveDb();
      return tariffs[plan];
    }
    return null;
  },

  // Bir martalik to'lov kodlari
  createPaymentCode(userId, plan = '1_month', price = 500, days = 30) {
    if (!db.paymentCodes) db.paymentCodes = {};
    const code = `SOAT-${Math.floor(1000 + Math.random() * 9000)}`;

    const payment = {
      code,
      user_id: String(userId),
      plan,
      price: parseInt(price),
      fee: Math.round(price * 0.15), // 15% komissiya
      days: parseInt(days),
      status: 'pending', // 'pending' | 'completed' | 'expired'
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString() // 60 daqiqa amal qiladi
    };

    db.paymentCodes[code] = payment;
    saveDb();
    return payment;
  },

  findPaymentCode(rawText) {
    if (!db.paymentCodes || !rawText) return null;
    const match = rawText.match(/SOAT-\d{4}/i);
    if (!match) return null;
    const code = match[0].toUpperCase();
    const payment = db.paymentCodes[code];
    if (payment && payment.status === 'pending') {
      return payment;
    }
    return null;
  },

  completePaymentCode(code, senderData = {}) {
    if (!db.paymentCodes || !db.paymentCodes[code]) return null;
    const payment = db.paymentCodes[code];
    if (payment.status !== 'pending') return null;

    payment.status = 'completed';
    payment.paid_at = new Date().toISOString();
    payment.sender = senderData;

    // Foydalanuvchiga obunani qo'shamiz
    const updatedUser = this.addSubscription(payment.user_id, payment.days);

    if (!db.payments) db.payments = [];
    db.payments.unshift(payment);

    saveDb();
    return { payment, user: updatedUser };
  },

  getAllPayments() {
    return db.payments || [];
  }
};

module.exports = { dbService };

