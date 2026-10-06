const { dbService } = require('../database');
const { sessionManager } = require('../services/userSessionManager');
const { clockEngine, STYLES, STYLE_NAMES } = require('../services/clockEngine');

const ADMIN_IDS = (process.env.ADMIN_IDS || '100').split(',').map(s => s.trim());
const GUARANTOR = process.env.GUARANTOR || '@umar';

class MessageHandler {
  constructor(bot) {
    this.bot = bot;
  }

  async handle(msg) {
    const chatId = msg.chat?.id || msg.from?.id;
    const userId = msg.from?.id;
    const text = msg.text ? msg.text.trim() : '';
    const name = msg.from?.first_name || 'Foydalanuvchi';
    const username = msg.from?.username || '';

    const user = dbService.getOrCreateUser(userId, {
      first_name: name,
      username: username
    });

    // 1. Agar foydalanuvchi ma'lumot kiritish bosqichida bo'lsa
    if (user.step) {
      return this.handleStep(chatId, user, text);
    }

    // 2. Buyruqlar
    if (text.startsWith('/start')) {
      return this.sendStart(chatId, user);
    }

    if (text === '/admin' && ADMIN_IDS.includes(String(userId))) {
      return this.sendAdminPanel(chatId);
    }

    if (text.startsWith('/addsub') && ADMIN_IDS.includes(String(userId))) {
      return this.handleAddSub(chatId, text);
    }

    if (text.startsWith('/setprice') && ADMIN_IDS.includes(String(userId))) {
      return this.handleSetPrice(chatId, text);
    }

    if (text.startsWith('/payments') && ADMIN_IDS.includes(String(userId))) {
      return this.handlePayments(chatId);
    }

    if (text.startsWith('/broadcast') && ADMIN_IDS.includes(String(userId))) {
      return this.handleBroadcast(chatId, text);
    }

    // Noma'lum xabar bo'lsa bosh menyuga qaytaramiz
    return this.sendStart(chatId, user);
  }

  // Bosh menyu
  async sendStart(chatId, user) {
    const isSub = dbService.isSubscribed(user.id);
    const hasCreds = !!(user.paxta_username && user.paxta_password);

    let statusText = '⚪ **Soat holati:** Ulanmagan';
    if (user.clock_active && isSub) {
      statusText = '🟢 **Soat holati:** ISHLAMOQDA ⏰';
    } else if (hasCreds && !isSub) {
      statusText = '🟡 **Soat holati:** Obuna tugagan';
    }

    const text =
      `⏰ **Paxta.online Jonli Soat Botiga xush kelibsiz!**\n\n` +
      `Ushbu bot orqali sizning **paxta.online** profilingizdagi ismingiz har daqiqada avtomatik soat bilan yangilanib turadi!\n` +
      `__Namuna: ${user.base_name || user.first_name} | ⏰ ${clockEngine.getCurrentTime()}__\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `${statusText}\n` +
      `👤 **Paxta login:** ${user.paxta_username ? '@' + user.paxta_username : 'Kiritilmagan'}\n` +
      `📅 **Obuna:** ${isSub ? (ADMIN_IDS.includes(String(user.id)) ? 'VIP Cheksiz' : new Date(user.sub_until).toLocaleDateString()) : 'Faol emas'}\n` +
      `━━━━━━━━━━━━━━━━━━━━\n\n` +
      `🛡️ **RASMIY KAFOLAT:**\n` +
      `Biz tomondan profilingizga biron zarar yetsa yoki narsa yo'qolsa, **${GUARANTOR}** orqali **2 BARAVAR QILIB QAYTARIB BERILADI!**\n\n` +
      `👇 __Kerakli bo'limni tanlang:__`;

    const keyboard = [
      [{ text: hasCreds ? '⚙️ Soatni Boshqarish' : '🚀 Soatni Ulash (Login kiritish)', callback_data: 'menu:setup' }],
      [{ text: '💎 Obuna Olish (Tariflar)', callback_data: 'menu:tariffs' }],
      [{ text: '🎨 Soat Uslublari', callback_data: 'menu:styles' }],
      [{ text: '🎁 30 Daqiqa Bepul Sinov', callback_data: 'menu:trial' }],
      [{ text: '🛡️ Xavfsizlik & Kafolat', callback_data: 'menu:guarantee' }],
      [{ text: '📊 Mening Ma\'lumotlarim', callback_data: 'menu:my' }]
    ];

    if (ADMIN_IDS.includes(String(user.id))) {
      keyboard.push([{ text: '👑 Admin Panel', callback_data: 'admin:panel' }]);
    }

    await this.bot.sendMessage(chatId, text, {
      replyMarkup: { inline_keyboard: keyboard }
    });
  }

  // Kiritish qadamlari
  async handleStep(chatId, user, text) {
    if (text === '/cancel') {
      dbService.updateUser(user.id, { step: null });
      await this.bot.sendMessage(chatId, '❌ Bekor qilindi.');
      return this.sendStart(chatId, user);
    }

    // 1-qadam: Username
    if (user.step === 'await_login') {
      const cleanLogin = text.replace('@', '').trim();
      dbService.updateUser(user.id, {
        paxta_username: cleanLogin,
        step: 'await_password'
      });

      return this.bot.sendMessage(chatId,
        `✅ Login saqlandi: **@${cleanLogin}**\n\n` +
        `🔑 Endi **paxta.online** parolingizni yuboring:\n` +
        `__(Parol faqat soatni avtomatik yangilash uchun xavfsiz saqlanadi. Bekor qilish: /cancel)__`
      );
    }

    // 2-qadam: Parol
    if (user.step === 'await_password') {
      const password = text.trim();
      await this.bot.sendMessage(chatId, '⏳ Hisobingiz tekshirilmoqda, iltimos kuting...');

      // Darhol login qilib tekshirib ko'ramiz
      const loginRes = await sessionManager.login(user.paxta_username, password);

      if (!loginRes.ok) {
        return this.bot.sendMessage(chatId,
          `❌ **Ulanish amalga oshmadi!**\n` +
          `Xatolik: ${loginRes.error}\n\n` +
          `Iltimos parolni qaytadan to'g'ri kiriting yoki /cancel bosing:`
        );
      }

      dbService.updateUser(user.id, {
        paxta_password: password,
        cookies: loginRes.cookies,
        base_name: loginRes.user.name || user.first_name,
        step: 'await_basename'
      });

      return this.bot.sendMessage(chatId,
        `🎉 **Ajoyib! Hisobingiz muvaffaqiyatli ulandi!**\n\n` +
        `👤 Ismingiz saytda: **${loginRes.user.name}**\n\n` +
        `Soat qanday ism bilan ko'rinishini xohlaysiz?\n` +
        `Asl ismingizni yozib yuboring (Masalan: **${loginRes.user.name || 'Muham'}**):`
      );
    }

    // 3-qadam: Asl ism
    if (user.step === 'await_basename') {
      const baseName = text.trim();
      dbService.updateUser(user.id, {
        base_name: baseName,
        step: null
      });

      await this.bot.sendMessage(chatId,
        `✅ Ism belgilandi: **${baseName}**\n\n` +
        `Soat ko'rinishi: **${baseName} | ⏰ ${clockEngine.getCurrentTime()}**\n\n` +
        `Endi obunani faollashtiring yoki bepul sinovdan foydalaning!`
      );

      // Agar obunasi bo'lsa darhol yangilab beramiz
      if (dbService.isSubscribed(user.id)) {
        dbService.updateUser(user.id, { clock_active: true });
        await clockEngine.updateSingleUser(user, clockEngine.getCurrentTime());
      }

      return this.sendStart(chatId, user);
    }
  }

  // Admin panel
  async sendAdminPanel(chatId) {
    const stats = dbService.getStats();
    const tariffs = dbService.getTariffs();

    const text =
      `👑 **Admin Panel — Soat Bot**\n\n` +
      `📊 **Statistika:**\n` +
      `• Jami foydalanuvchilar: **${stats.totalUsers} ta**\n` +
      `• Faol obunachilar: **${stats.activeSubs} ta**\n` +
      `• Faol soatlar: **${stats.activeClocks} ta**\n\n` +
      `💰 **Joriy Obuna Narxlari:**\n` +
      `• 1 Oylik (\`1m\`): **${tariffs['1m']?.price || 500} Stars**\n` +
      `• 6 Oylik (\`6m\`): **${tariffs['6m']?.price || 2400} Stars**\n` +
      `• 1 Yillik VIP (\`1y\`): **${tariffs['1y']?.price || 4200} Stars**\n\n` +
      `⚙️ **Admin Buyruqlari:**\n` +
      `• \`/setprice <tarif> <narx>\` — Tarif narxini o'zgartirish\n` +
      `  __Misol:__ \`/setprice 1m 300\` yoki \`/setprice 6m 1800\`\n` +
      `• \`/addsub <user_id> <kunlar>\` — Bepul obuna qo'shish\n` +
      `  __Misol:__ \`/addsub 100 30\`\n` +
      `• \`/payments\` — Oxirgi qabul qilingan to'lovlar\n` +
      `• \`/broadcast <matn>\` — Barcha userlarga xabar yuborish`;

    await this.bot.sendMessage(chatId, text);
  }

  async handleSetPrice(chatId, text) {
    const parts = text.split(' ').filter(Boolean);
    if (parts.length < 3) {
      return this.bot.sendMessage(chatId,
        `❌ **Format noto'g'ri!**\n\n` +
        `Foydalanish: \`/setprice <tarif> <narx>\`\n\n` +
        `Tarif nomlari:\n` +
        `• \`1m\` — 1 Oylik\n` +
        `• \`6m\` — 6 Oylik\n` +
        `• \`1y\` — 1 Yillik VIP\n\n` +
        `__Misol:__ \`/setprice 1m 400\``
      );
    }

    const plan = parts[1].toLowerCase();
    const newPrice = parseInt(parts[2]);

    if (!['1m', '6m', '1y'].includes(plan)) {
      return this.bot.sendMessage(chatId, '❌ Noto\'g\'ri tarif! Faqat `1m`, `6m` yoki `1y` kiritish mumkin.');
    }

    if (isNaN(newPrice) || newPrice <= 0) {
      return this.bot.sendMessage(chatId, '❌ Narx musbat son bo\'lishi kerak (Stars miqdori).');
    }

    const updated = dbService.setTariffPrice(plan, newPrice);
    if (!updated) {
      return this.bot.sendMessage(chatId, '❌ Narxni o\'zgartirishda xatolik yuz berdi.');
    }

    await this.bot.sendMessage(chatId,
      `✅ **Tarif narxi yangilandi!**\n\n` +
      `• Tarif: **${updated.name}** (\`${plan}\`)\n` +
      `• Yangi narx: **${updated.price} Stars**\n\n` +
      `Endi barcha yangi to'lov hisoblari ushbu narxda yaratiladi!`
    );
  }

  async handlePayments(chatId) {
    const payments = dbService.getAllPayments ? dbService.getAllPayments() : [];
    if (!payments.length) {
      return this.bot.sendMessage(chatId, 'ℹ️ Hozircha to\'lovlar mavjud emas.');
    }

    let text = `💳 **Oxirgi To'lovlar Ro'yxati (Jami: ${payments.length} ta):**\n\n`;
    const last10 = payments.slice(0, 10);

    last10.forEach((p, idx) => {
      const date = new Date(p.paid_at || p.created_at).toLocaleString();
      text += `${idx + 1}. **${p.code}** — ${p.price} Stars (${p.days} kun)\n`;
      text += `   👤 User: \`${p.user_id}\` | Kimdan: @${p.sender?.sender_username || 'noma\'lum'}\n`;
      text += `   🕒 ${date}\n\n`;
    });

    await this.bot.sendMessage(chatId, text);
  }

  async handleAddSub(chatId, text) {
    const parts = text.split(' ');
    if (parts.length < 3) {
      return this.bot.sendMessage(chatId, '❌ Format: `/addsub <user_id> <kunlar>`');
    }
    const targetId = parts[1];
    const days = parseInt(parts[2]);
    const updated = dbService.addSubscription(targetId, days);

    await this.bot.sendMessage(chatId, `✅ User ${targetId} ga ${days} kun obuna berildi. Tugash vaqti: ${updated.sub_until}`);
    await this.bot.sendMessage(targetId, `🎉 Sizga administrator tomonidan **${days} kunlik** soat obunasi sovg'a qilindi!`);
  }

  async handleBroadcast(chatId, text) {
    const msg = text.replace('/broadcast', '').trim();
    if (!msg) return this.bot.sendMessage(chatId, '❌ Xabar matnini kiriting.');

    const users = dbService.getAllUsers();
    let sent = 0;
    for (const u of users) {
      try {
        await this.bot.sendMessage(u.id, `📢 **E'lon:**\n\n${msg}`);
        sent++;
      } catch (e) {}
    }
    await this.bot.sendMessage(chatId, `✅ Xabar ${sent} ta foydalanuvchiga yetkazildi.`);
  }
}

module.exports = { MessageHandler };
