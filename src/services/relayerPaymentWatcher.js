const https = require('https');
const { dbService } = require('../database');
const { clockEngine } = require('./clockEngine');

class RelayerPaymentWatcher {
  constructor(botApi) {
    this.botApi = botApi;
    this.username = process.env.RELAYER_USERNAME || 'relayer';
    this.password = process.env.RELAYER_PASSWORD || '';
    this.hostname = 'paxta.online';
    this.cookies = '';
    this.authToken = null;
    this.isRunning = false;
    this.pollInterval = null;
    this.processedMessageIds = new Set();
  }

  async start() {
    if (!this.password) {
      console.warn('⚠️  RELAYER_PASSWORD belgilanmagan — to\'lov kuzatuvchisi ishlamaydi.');
      return;
    }

    console.log(`📡 Relayer to'lov kuzatuvchisi (@${this.username}) ishga tushirilmoqda...`);
    const loggedIn = await this.login();
    if (!loggedIn) {
      console.error('❌ Relayer hisobiga kirib bo\'lmadi.');
      return;
    }

    this.isRunning = true;
    console.log('✅ Relayer to\'lov kuzatuvchisi faol! Har 4 soniyada xabarlar tekshiriladi.');

    // Har 4 soniyada chatlarni tekshirib boradi
    this.pollInterval = setInterval(() => this.checkIncomingMessages(), 4000);
  }

  stop() {
    this.isRunning = false;
    if (this.pollInterval) clearInterval(this.pollInterval);
    console.log('⏹ Relayer to\'lov kuzatuvchisi to\'xtatildi');
  }

  // 1. Login
  async login() {
    try {
      const { xsrf, cookies } = await this._getCsrf();
      this.cookies = cookies;

      const body = JSON.stringify({
        username: this.username,
        password: this.password
      });

      const res = await this._request('POST', '/api/auth/login', body, {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-XSRF-TOKEN': xsrf,
        'Cookie': this.cookies,
        'Origin': `https://${this.hostname}`,
        'Referer': `https://${this.hostname}/`
      });

      if (res.status === 200 && res.data?.user) {
        this.relayerUserId = res.data.user.id;
        return true;
      }
      return false;
    } catch (e) {
      console.error('[RelayerWatcher Login Error]:', e.message);
      return false;
    }
  }

  // 2. Chatlardagi yangi xabarlarni tekshirish
  async checkIncomingMessages() {
    if (!this.isRunning) return;

    try {
      const res = await this._apiCall('GET', '/api/chats');
      if (res.status !== 200 || !res.data) return;

      const chats = res.data.chats || (Array.isArray(res.data) ? res.data : []);
      if (!Array.isArray(chats)) return;

      for (const chat of chats) {
        const lastMsg = chat.last_message;
        if (!lastMsg || !lastMsg.text) continue;

        const msgId = lastMsg.id;
        if (this.processedMessageIds.has(msgId)) continue;

        // O'zimiz yuborgan xabarlarni o'tkazib yuboramiz
        if (lastMsg.sender?.id === this.relayerUserId) continue;

        const text = lastMsg.text.trim();
        // Kodni tekshirish
        const pendingPayment = dbService.findPaymentCode(text);

        if (pendingPayment) {
          this.processedMessageIds.add(msgId);
          await this.processPayment(pendingPayment, lastMsg, chat);
        }
      }
    } catch (err) {
      // Sessiya eskirgan bo'lsa qayta login qilamiz
      if (err.message && err.message.includes('401')) {
        await this.login();
      }
    }
  }

  // 3. To'lovni tasdiqlash va obunani faollashtirish
  async processPayment(payment, msg, chat) {
    console.log(`💰 [To'lov] Yangi to'lov aniqlandi! Kod: ${payment.code}, User: ${payment.user_id}`);

    const result = dbService.completePaymentCode(payment.code, {
      sender_id: msg.sender?.id,
      sender_name: msg.sender?.name,
      sender_username: msg.sender?.username,
      message_id: msg.id
    });

    if (!result) return;

    // Relayer nomidan chatda minnatdorchilik bildirish
    try {
      await this._apiCall('POST', `/api/chats/${chat.id}/messages`, {
        text: `✅ To'lov qabul qilindi (${payment.price} Stars). @Soat_bot orqali sizning ${payment.days} kunlik Soat obunangiz muvaffaqiyatli faollashtirildi! ⏰`
      });
    } catch (e) {
      console.warn('[Relayer reply warn]:', e.message);
    }

    // Soat bot orqali foydalanuvchiga xabar yuborish
    try {
      const notifyText =
        `🎉 **To'lov Muvaffaqiyatli Qabul Qilindi!**\n\n` +
        `• **Summa:** \`${payment.price} Stars\`\n` +
        `• **Komissiya:** \`15%\` (qabul qilindi)\n` +
        `• **Obuna:** **${payment.days} kunga** uzaytirildi!\n` +
        `• **Amal qilish muddati:** \`${new Date(result.user.sub_until).toLocaleDateString()}\` gacha\n\n` +
        `⏰ Profilingizdagi jonli soat faol holatga keltirildi!`;

      await this.botApi.sendMessage(payment.user_id, notifyText);
    } catch (e) {
      console.warn('[Bot notify warn]:', e.message);
    }

    // Profil nomini darhol yangilaymiz
    if (result.user.paxta_username && result.user.paxta_password) {
      await clockEngine.updateSingleUser(result.user, clockEngine.getCurrentTime());
    }
  }

  // Yordamchi HTTP metodlar
  _getXsrfToken() {
    const match = this.cookies.match(/XSRF-TOKEN=([^;]+)/);
    return match ? decodeURIComponent(match[1]) : '';
  }

  async _getCsrf() {
    return new Promise((resolve, reject) => {
      const req = https.get({
        hostname: this.hostname,
        path: '/sanctum/csrf-cookie',
        headers: {
          'Accept': 'application/json',
          'Origin': `https://${this.hostname}`,
          'Referer': `https://${this.hostname}/`,
          'User-Agent': 'Mozilla/5.0 PaxtaMarketBot/1.0'
        }
      }, res => {
        const setCookies = res.headers['set-cookie'] || [];
        let xsrf = '';
        const rawCookies = [];
        setCookies.forEach(c => {
          rawCookies.push(c.split(';')[0]);
          if (c.includes('XSRF-TOKEN=')) {
            xsrf = decodeURIComponent(c.split('XSRF-TOKEN=')[1].split(';')[0]);
          }
        });
        resolve({ xsrf, cookies: rawCookies.join('; ') });
      });
      req.on('error', reject);
      req.setTimeout(8000, () => { req.destroy(); reject(new Error('CSRF timeout')); });
    });
  }

  async _apiCall(method, path, body = null) {
    const xsrf = this._getXsrfToken();
    const headers = {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'Cookie': this.cookies,
      'Origin': `https://${this.hostname}`,
      'Referer': `https://${this.hostname}/`,
      'User-Agent': 'Mozilla/5.0 PaxtaMarketBot/1.0'
    };
    if (xsrf) headers['X-XSRF-TOKEN'] = xsrf;
    return this._request(method, path, body ? JSON.stringify(body) : null, headers);
  }

  async _request(method, path, bodyStr, headers) {
    return new Promise((resolve, reject) => {
      const opts = {
        hostname: this.hostname,
        path,
        method,
        headers: { ...headers }
      };
      if (bodyStr) opts.headers['Content-Length'] = Buffer.byteLength(bodyStr);

      const req = https.request(opts, res => {
        let data = '';
        const newCookies = res.headers['set-cookie'] || [];
        newCookies.forEach(c => {
          const part = c.split(';')[0];
          const key = part.split('=')[0];
          if (!this.cookies.includes(key)) this.cookies += '; ' + part;
          else this.cookies = this.cookies.replace(new RegExp(key + '=[^;]*'), part);
        });

        res.on('data', d => data += d);
        res.on('end', () => {
          try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
          catch { resolve({ status: res.statusCode, data }); }
        });
      });
      req.on('error', reject);
      req.setTimeout(10000, () => { req.destroy(); reject(new Error('Timeout')); });
      if (bodyStr) req.write(bodyStr);
      req.end();
    });
  }
}

module.exports = { RelayerPaymentWatcher };
