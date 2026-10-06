const { dbService } = require('../database');
const { clockEngine, STYLES, STYLE_NAMES } = require('../services/clockEngine');

const GUARANTOR = process.env.GUARANTOR || '@umar';

class CallbackHandler {
  constructor(bot) {
    this.bot = bot;
  }

  async handle(cb) {
    const callbackId = cb.id;
    const data = cb.data;
    const msg = cb.message;
    const chatId = msg?.chat?.id;
    const messageId = msg?.message_id;
    const userId = cb.from?.id;

    const user = dbService.getOrCreateUser(userId, {
      first_name: cb.from?.first_name || '',
      username: cb.from?.username || ''
    });

    await this.bot.answerCallbackQuery(callbackId);

    // 1. Soatni sozlash
    if (data === 'menu:setup') {
      return this.sendSetupMenu(chatId, messageId, user);
    }

    if (data === 'setup:start') {
      dbService.updateUser(user.id, { step: 'await_login' });
      return this.bot.sendMessage(chatId,
        `📝 **1-Qadam: Paxta.online loginini yuboring**\n\n` +
        `Saytdagi usernameingizni yozib yuboring (Masalan: **muham**):\n` +
        `__(Bekor qilish uchun /cancel deb yozing)__`
      );
    }

    if (data === 'clock:toggle') {
      const isSub = dbService.isSubscribed(user.id);
      if (!isSub) {
        return this.bot.sendMessage(chatId, '❌ Soatni yoqish uchun avval obunani faollashtiring yoki bepul sinov oling.');
      }
      const newStatus = !user.clock_active;
      dbService.updateUser(user.id, { clock_active: newStatus });
      if (newStatus) {
        await clockEngine.updateSingleUser(user, clockEngine.getCurrentTime());
      }
      return this.sendSetupMenu(chatId, messageId, dbService.getUser(user.id));
    }

    // 2. Tariflar va Obuna
    if (data === 'menu:tariffs') {
      return this.sendTariffs(chatId, messageId, user);
    }

    if (data.startsWith('buy:plan:')) {
      const planType = data.replace('buy:plan:', '');
      return this.generatePaymentInvoice(chatId, messageId, user, planType);
    }

    // 3. Soat uslublari
    if (data === 'menu:styles') {
      return this.sendStyles(chatId, messageId, user);
    }

    if (data.startsWith('style:set:')) {
      const styleId = data.replace('style:set:', '');
      dbService.updateUser(user.id, { clock_style: styleId });
      if (user.clock_active && dbService.isSubscribed(user.id)) {
        await clockEngine.updateSingleUser(user, clockEngine.getCurrentTime());
      }
      return this.sendStyles(chatId, messageId, dbService.getUser(user.id), `✅ Uslub o'zgartirildi!`);
    }

    // 4. Bepul sinov
    if (data === 'menu:trial') {
      if (user.is_trial_used) {
        return this.bot.sendMessage(chatId, 'ℹ️ Siz allaqachon bepul sinov muddatidan foydalangansiz.');
      }
      if (!user.paxta_username || !user.paxta_password) {
        return this.bot.sendMessage(chatId,
          '⚠️ Bepul sinovni faollashtirishdan oldin **"Soatni Ulash"** bo\'limida login va parolingizni kiriting.'
        );
      }

      dbService.activateTrial(user.id, parseInt(process.env.TRIAL_MINUTES) || 30);
      await clockEngine.updateSingleUser(dbService.getUser(user.id), clockEngine.getCurrentTime());

      return this.bot.sendMessage(chatId,
        `🎉 **30 Daqiqalik Bepul Sinov Faollashdi!**\n\n` +
        `Profilingizdagi ism hozirgina soat bilan yangilandi. Saytga kirib tekshirib ko'ring!\n\n` +
        `Xizmat yoqsa, davom ettirish uchun obuna sotib olishingiz mumkin.`
      );
    }

    // 5. Kafolat va Xavfsizlik
    if (data === 'menu:guarantee') {
      return this.sendGuarantee(chatId, messageId);
    }

    // 6. Mening profilim
    if (data === 'menu:my') {
      return this.sendMyProfile(chatId, messageId, user);
    }

    // 7. Bosh menyuga qaytish
    if (data === 'menu:back') {
      const { MessageHandler } = require('./messageHandler');
      const mh = new MessageHandler(this.bot);
      return mh.sendStart(chatId, user);
    }
  }

  // Soat boshqaruvi
  async sendSetupMenu(chatId, messageId, user) {
    const isSub = dbService.isSubscribed(user.id);

    let status = '🔴 O\'chirilgan';
    if (user.clock_active && isSub) status = '🟢 Ishlamoqda';
    else if (!isSub) status = '🟡 Obuna yo\'q';

    const text =
      `⚙️ **Soat Boshqaruvi**\n\n` +
      `Holat: **${status}**\n` +
      `Login: **${user.paxta_username ? '@' + user.paxta_username : 'Ulanmagan'}**\n` +
      `Asl ism: **${user.base_name || 'Kiritilmagan'}**\n` +
      `Uslub: **${STYLE_NAMES[user.clock_style] || 'Standart'}**\n\n` +
      `Joriy namuna: **${STYLES[user.clock_style](user.base_name, clockEngine.getCurrentTime())}**\n\n` +
      `${user.last_error ? `⚠️ __Oxirgi xatolik: ${user.last_error}__\n\n` : ''}` +
      `Tugmalar orqali sozlang:`;

    const keyboard = [
      [{ text: user.clock_active ? '⏸️ Soatni To\'xtatish' : '▶️ Soatni Yoqish', callback_data: 'clock:toggle' }],
      [{ text: '🔄 Login/Parolni Qayta Kiritish', callback_data: 'setup:start' }],
      [{ text: '🎨 Uslubni O\'zgartirish', callback_data: 'menu:styles' }],
      [{ text: '⬅️ Asosiy Menyu', callback_data: 'menu:back' }]
    ];

    await this.bot.editMessageText(chatId, messageId, text, {
      replyMarkup: { inline_keyboard: keyboard }
    });
  }

  // Tariflar
  async sendTariffs(chatId, messageId, user) {
    const tariffs = dbService.getTariffs();
    const p1 = tariffs['1m']?.price || 500;
    const p6 = tariffs['6m']?.price || 2400;
    const p12 = tariffs['1y']?.price || 4200;

    const text =
      `💎 **Soat Xizmati Obuna Tariflari**\n\n` +
      `Doimiy 24/7 profilingizda soat uzluksiz ishlab turishi uchun tarifni tanlang:\n\n` +
      `⭐ **1 Oylik:** \`${p1} Stars\` (Sinov va muntazam foydalanish)\n` +
      `🔥 **6 Oylik:** \`${p6} Stars\` (20% chegirma — oyiga ${Math.round(p6 / 6)}⭐)\n` +
      `👑 **1 Yillik VIP:** \`${p12} Stars\` (30% chegirma — oyiga ${Math.round(p12 / 12)}⭐)\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `⚡ **Avtomatik To'lov Tizimi:**\n` +
      `Tarifni tanlang, bot sizga maxsus kod beradi. O'sha kodni **@relayer** ga yuborganingiz zahoti obunangiz **avtomatik faollashadi!**`;

    const keyboard = [
      [{ text: `⭐ 1 Oylik Sotib Olish (${p1} ⭐)`, callback_data: 'buy:plan:1m' }],
      [{ text: `🔥 6 Oylik Sotib Olish (${p6} ⭐)`, callback_data: 'buy:plan:6m' }],
      [{ text: `👑 1 Yillik VIP Sotib Olish (${p12} ⭐)`, callback_data: 'buy:plan:1y' }],
      [{ text: '⬅️ Asosiy Menyu', callback_data: 'menu:back' }]
    ];

    await this.bot.editMessageText(chatId, messageId, text, {
      replyMarkup: { inline_keyboard: keyboard }
    });
  }

  // To'lov hisobini generatsiya qilish
  async generatePaymentInvoice(chatId, messageId, user, planType) {
    const tariffs = dbService.getTariffs();
    const tariff = tariffs[planType] || tariffs['1m'] || { name: '1 Oylik', price: 500, days: 30 };
    const days = tariff.days;
    const price = tariff.price;
    const planName = tariff.name;

    // Bir martalik kod yaratamiz
    const payment = dbService.createPaymentCode(user.id, planType, price, days);

    const text =
      `💳 **Obuna uchun To'lov Qilish — ${planName}**\n\n` +
      `Sizning bir martalik maxsus to'lov kodingiz:\n` +
      `👉 \`${payment.code}\` 👈\n` +
      `__(Nusxa olish uchun kod ustiga bosing)__\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `📌 **QANDAY TO'LANADI (3 QADAM):**\n` +
      `1. [@relayer](https://paxta.online/u/relayer) profiliga shaxsiy xabar (DM) oching.\n` +
      `2. Xabarga yuqoridagi \`${payment.code}\` kodini yozib yuboring.\n` +
      `3. @relayer ga xabar yuborish narxi — ${price} Stars. Xabar ketishi bilanoq hisobingizdan yechiladi va bizning tizim to'lovni avtomatik tasdiqlaydi!\n\n` +
      `✅ **Natija:** To'lov tushishi bilan sizning **${days} kunlik** Soat obunangiz bir necha soniyada avtomatik faollashadi!\n\n` +
      `⏳ __Kod 60 daqiqa davomida amal qiladi.__`;

    const keyboard = [
      [{ text: '🚀 @relayer ga O\'tish va Yozish', url: 'https://paxta.online/u/relayer' }],
      [{ text: '🔄 Boshqa Tarif Tanlash', callback_data: 'menu:tariffs' }],
      [{ text: '⬅️ Asosiy Menyu', callback_data: 'menu:back' }]
    ];

    await this.bot.editMessageText(chatId, messageId, text, {
      replyMarkup: { inline_keyboard: keyboard }
    });
  }

  // Uslublar
  async sendStyles(chatId, messageId, user, alert = '') {
    const currentTime = clockEngine.getCurrentTime();
    const name = user.base_name || 'Muham';

    let text = `${alert ? alert + '\n\n' : ''}` +
      `🎨 **Soat Uslubini Tanlang**\n\n` +
      `Profilingizda soat qanday ko'rinishda bo'lishini xohlaysiz? Quyidagi variantlardan birini bosing:\n\n`;

    Object.keys(STYLES).forEach((key, idx) => {
      const activeMark = user.clock_style === key ? ' ✅' : '';
      text += `**${idx + 1}.** ${STYLES[key](name, currentTime)}${activeMark}\n`;
    });

    const keyboard = [
      [
        { text: `1. ⏰ Standart ${user.clock_style === 'style_1' ? '✅' : ''}`, callback_data: 'style:set:style_1' },
        { text: `2. 🔲 Kvadrat ${user.clock_style === 'style_2' ? '✅' : ''}`, callback_data: 'style:set:style_2' }
      ],
      [
        { text: `3. ⚪ Nuqta ${user.clock_style === 'style_3' ? '✅' : ''}`, callback_data: 'style:set:style_3' },
        { text: `4. ⚡ Chaqaqmoq ${user.clock_style === 'style_4' ? '✅' : ''}`, callback_data: 'style:set:style_4' }
      ],
      [
        { text: `5. 💎 Olmos ${user.clock_style === 'style_5' ? '✅' : ''}`, callback_data: 'style:set:style_5' },
        { text: `6. 🕒 Elegant ${user.clock_style === 'style_6' ? '✅' : ''}`, callback_data: 'style:set:style_6' }
      ],
      [
        { text: `7. 🌊 To'lqin ${user.clock_style === 'style_7' ? '✅' : ''}`, callback_data: 'style:set:style_7' }
      ],
      [{ text: '⬅️ Orqaga', callback_data: 'menu:setup' }]
    ];

    await this.bot.editMessageText(chatId, messageId, text, {
      replyMarkup: { inline_keyboard: keyboard }
    });
  }

  // Kafolat
  async sendGuarantee(chatId, messageId) {
    const text =
      `🛡️ **XAVFSIZLIK VA 2 BARAVAR KAFOLAT**\n\n` +
      `Biz sizning profilingiz xavfsizligini 100% ta'minlaymiz:\n\n` +
      `1. 🔐 **Shifrlangan ma'lumotlar:** Siz kiritgan parol faqat va faqat har daqiqada profil nomini yangilash uchun ishlatiladi.\n` +
      `2. 🚫 **Hech qanday boshqa amallar:** Bot sizning xabarlaringiz, giftlaringiz yoki shaxsiy yozishmalaringizga aslo kirmaydi va teginmaydi.\n` +
      `3. ⚖️ **RASMIY KAFOLAT:**\n` +
      `Agar biz tomonimizdan profilingizdan biron narsa o'g'irlansa yoki zarar yetsa, **${GUARANTOR}** orqali **2 BARAVAR QILIB QAYTARIB BERILADI!**\n\n` +
      `Bu rasmiy va'da va kafolatdir. Bemalol xizmatdan ishonch bilan foydalanishingiz mumkin!`;

    const keyboard = [
      [{ text: '⬅️ Asosiy Menyu', callback_data: 'menu:back' }]
    ];

    await this.bot.editMessageText(chatId, messageId, text, {
      replyMarkup: { inline_keyboard: keyboard }
    });
  }

  // Mening hisobim
  async sendMyProfile(chatId, messageId, user) {
    const isSub = dbService.isSubscribed(user.id);
    const text =
      `👤 **Mening Ma'lumotlarim**\n\n` +
      `• **Telegram/Paxta ID:** \`${user.id}\`\n` +
      `• **Paxta Login:** ${user.paxta_username ? '@' + user.paxta_username : 'Kiritilmagan'}\n` +
      `• **Asl Ism:** ${user.base_name || 'Yo\'q'}\n` +
      `• **Soat Holati:** ${user.clock_active && isSub ? '🟢 Faol' : '🔴 O\'chiq'}\n` +
      `• **Tanlangan Uslub:** ${STYLE_NAMES[user.clock_style] || 'Standart'}\n` +
      `• **Obuna Muddati:** ${user.sub_until ? (user.id === '100' ? 'VIP Cheksiz' : new Date(user.sub_until).toLocaleString()) : 'Obuna yo\'q'}\n` +
      `• **Sinovdan Foydalanilgan:** ${user.is_trial_used ? 'Ha' : 'Yo\'q'}\n` +
      `• **Oxirgi Yangilanish:** ${user.last_updated_at ? new Date(user.last_updated_at).toLocaleTimeString() : 'Hali yangilanmagan'}`;

    const keyboard = [
      [{ text: '⬅️ Asosiy Menyu', callback_data: 'menu:back' }]
    ];

    await this.bot.editMessageText(chatId, messageId, text, {
      replyMarkup: { inline_keyboard: keyboard }
    });
  }
}

module.exports = { CallbackHandler };
