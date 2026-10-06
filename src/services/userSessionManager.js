const https = require('https');

class UserSessionManager {
  constructor() {
    this.hostname = 'paxta.online';
    this.userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) PaxtaSoatBot/1.0';
  }

  // 1. CSRF Token & Cookies olish
  async getCsrf() {
    return new Promise((resolve, reject) => {
      const req = https.get({
        hostname: this.hostname,
        path: '/sanctum/csrf-cookie',
        headers: {
          'Accept': 'application/json',
          'Origin': `https://${this.hostname}`,
          'Referer': `https://${this.hostname}/`,
          'User-Agent': this.userAgent
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
      req.setTimeout(8000, () => { req.destroy(); reject(new Error('CSRF ulanish vaqti tugadi')); });
    });
  }

  // 2. Foydalanuvchi hisobiga kirish
  async login(username, password) {
    const { xsrf, cookies: initialCookies } = await this.getCsrf();

    const body = JSON.stringify({
      username: username.trim(),
      password: password
    });

    return new Promise((resolve, reject) => {
      const req = https.request({
        hostname: this.hostname,
        path: '/api/auth/login',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'X-XSRF-TOKEN': xsrf,
          'Cookie': initialCookies,
          'Origin': `https://${this.hostname}`,
          'Referer': `https://${this.hostname}/`,
          'User-Agent': this.userAgent,
          'Content-Length': Buffer.byteLength(body)
        }
      }, res => {
        let data = '';
        let currentCookies = initialCookies;
        const newCookies = res.headers['set-cookie'] || [];

        newCookies.forEach(c => {
          const part = c.split(';')[0];
          const key = part.split('=')[0];
          if (!currentCookies.includes(key)) {
            currentCookies += '; ' + part;
          } else {
            currentCookies = currentCookies.replace(new RegExp(key + '=[^;]*'), part);
          }
        });

        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (res.statusCode === 200 && json.user) {
              resolve({
                ok: true,
                user: json.user,
                cookies: currentCookies,
                xsrfToken: xsrf
              });
            } else {
              resolve({
                ok: false,
                error: json.message || 'Login yoki parol noto\'g\'ri'
              });
            }
          } catch (e) {
            resolve({ ok: false, error: 'Server javobida xatolik' });
          }
        });
      });

      req.on('error', err => resolve({ ok: false, error: err.message }));
      req.setTimeout(10000, () => { req.destroy(); resolve({ ok: false, error: 'Login timeout' }); });
      req.write(body);
      req.end();
    });
  }

  // 3. Profil ismini yangilash (PATCH /api/me)
  async updateProfileName(cookies, newName) {
    // XSRF tokenni cookies dan ajratib olamiz
    let xsrf = '';
    const parts = cookies.split(';');
    for (const p of parts) {
      if (p.trim().startsWith('XSRF-TOKEN=')) {
        xsrf = decodeURIComponent(p.trim().split('=')[1]);
        break;
      }
    }

    const body = JSON.stringify({ name: newName });

    return new Promise((resolve) => {
      const req = https.request({
        hostname: this.hostname,
        path: '/api/me',
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'X-XSRF-TOKEN': xsrf,
          'Cookie': cookies,
          'Origin': `https://${this.hostname}`,
          'Referer': `https://${this.hostname}/`,
          'User-Agent': this.userAgent,
          'Content-Length': Buffer.byteLength(body)
        }
      }, res => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (res.statusCode === 200 && json.user) {
              resolve({ ok: true, user: json.user });
            } else if (res.statusCode === 401) {
              resolve({ ok: false, needReLogin: true });
            } else {
              resolve({ ok: false, error: json.message || `Status: ${res.statusCode}` });
            }
          } catch (e) {
            resolve({ ok: false, error: 'Parse xatolik' });
          }
        });
      });

      req.on('error', err => resolve({ ok: false, error: err.message }));
      req.setTimeout(8000, () => { req.destroy(); resolve({ ok: false, error: 'Update timeout' }); });
      req.write(body);
      req.end();
    });
  }
}

const sessionManager = new UserSessionManager();
module.exports = { sessionManager };
