const { dbService } = require('../database');
const { sessionManager } = require('./userSessionManager');

// Soat shablonlari
const STYLES = {
  style_1: (name, time) => `${name} | ⏰ ${time}`,
  style_2: (name, time) => `${name} [${time}]`,
  style_3: (name, time) => `${name} • ${time}`,
  style_4: (name, time) => `⚡ ${name} ⚡ ${time}`,
  style_5: (name, time) => `💎 ${name} | ⌚ ${time}`,
  style_6: (name, time) => `${name} 🕒 ${time}`,
  style_7: (name, time) => `${name} ~ ${time}`
};

const STYLE_NAMES = {
  style_1: '⏰ Standart (Ism | ⏰ 15:45)',
  style_2: '🔲 Kvadrat (Ism [15:45])',
  style_3: '⚪ Nuqta (Ism • 15:45)',
  style_4: '⚡ Chaqaqmoq (⚡ Ism ⚡ 15:45)',
  style_5: '💎 Olmos (💎 Ism | ⌚ 15:45)',
  style_6: '🕒 Elegant (Ism 🕒 15:45)',
  style_7: '🌊 To\'lqin (Ism ~ 15:45)'
};

class ClockEngine {
  constructor() {
    this.isRunning = false;
    this.intervalId = null;
    this.batchSize = 10; // Parallel yangilanishlar soni
  }

  // Toshkent vaqtini olish (HH:MM) — 1 daqiqa kalibratsiya bilan
  getCurrentTime(addMinutes = 1) {
    const d = new Date(Date.now() + (addMinutes * 60000));
    // UTC+5 (Toshkent vaqti)
    const utc = d.getTime() + (d.getTimezoneOffset() * 60000);
    const uzTime = new Date(utc + (3600000 * 5));
    const h = String(uzTime.getHours()).padStart(2, '0');
    const m = String(uzTime.getMinutes()).padStart(2, '0');
    return `${h}:${m}`;
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log('⏰ Live Clock Engine ishga tushirildi (Sinxronlashtirilgan)!');

    // Birinchi marta darhol yangilaymiz
    this.tick();

    // Har daqiqaning 50-soniyasida (yangi daqiqaga 10 soniya qolganda) keyingi vaqtni yuborish
    const scheduleNextMinute = () => {
      const now = new Date();
      const currentSec = now.getSeconds();
      // 50-soniyani maqsad qilamiz
      let msToNext = ((50 - currentSec + 60) % 60) * 1000 - now.getMilliseconds();
      if (msToNext <= 500) msToNext += 60000;

      this.timeoutId = setTimeout(() => {
        if (!this.isRunning) return;
        this.tick();
        scheduleNextMinute();
      }, msToNext);
    };

    scheduleNextMinute();
  }

  stop() {
    this.isRunning = false;
    if (this.timeoutId) clearTimeout(this.timeoutId);
    if (this.intervalId) clearInterval(this.intervalId);
    console.log('⏹ Live Clock Engine to\'xtatildi');
  }

  async tick() {
    const time = this.getCurrentTime();
    const activeUsers = dbService.getActiveClockUsers();

    if (activeUsers.length === 0) return;
    console.log(`[Clock] Vaqt: ${time} — ${activeUsers.length} ta faol profil yangilanmoqda...`);

    // Batch tarzida parallel bajarish
    for (let i = 0; i < activeUsers.length; i += this.batchSize) {
      const batch = activeUsers.slice(i, i + this.batchSize);
      await Promise.all(batch.map(user => this.updateSingleUser(user, time)));
    }
  }

  async updateSingleUser(user, time) {
    try {
      const formatter = STYLES[user.clock_style] || STYLES.style_1;
      const baseName = user.base_name || 'User';
      const newName = formatter(baseName, time);

      // Agar cookie bo'lmasa, oldin login qilamiz
      let cookies = user.cookies;
      if (!cookies) {
        const loginRes = await sessionManager.login(user.paxta_username, user.paxta_password);
        if (!loginRes.ok) {
          dbService.updateUser(user.id, { last_error: loginRes.error });
          return;
        }
        cookies = loginRes.cookies;
        dbService.updateUser(user.id, { cookies });
      }

      // Ismni yangilash
      let res = await sessionManager.updateProfileName(cookies, newName);

      // Agar sessiya tugagan bo'lsa (401), qayta login qilib yangilaymiz
      if (!res.ok && res.needReLogin) {
        console.log(`[Clock] User ${user.paxta_username} uchun sessiya yangilanmoqda...`);
        const reLogin = await sessionManager.login(user.paxta_username, user.paxta_password);
        if (reLogin.ok) {
          cookies = reLogin.cookies;
          dbService.updateUser(user.id, { cookies });
          res = await sessionManager.updateProfileName(cookies, newName);
        }
      }

      if (res.ok) {
        dbService.updateUser(user.id, {
          last_updated_at: new Date().toISOString(),
          last_error: null
        });
      } else {
        dbService.updateUser(user.id, { last_error: res.error });
      }

    } catch (err) {
      console.error(`[Clock Error] User ${user.id}:`, err.message);
    }
  }
}

const clockEngine = new ClockEngine();
module.exports = { clockEngine, STYLES, STYLE_NAMES };
