try { require('dotenv').config(); } catch (e) {}
const http = require('http');
const { PaxtaBotApi } = require('./services/paxtaBotApi');
const { MessageHandler } = require('./handlers/messageHandler');
const { CallbackHandler } = require('./handlers/callbackHandler');
const { clockEngine } = require('./services/clockEngine');
const { RelayerPaymentWatcher } = require('./services/relayerPaymentWatcher');

const BOT_TOKEN = process.env.BOT_TOKEN;

if (!BOT_TOKEN) {
  console.error('❌ BOT_TOKEN belgilanmagan! Iltimos .env faylini tekshiring.');
  process.exit(1);
}

// Render Healthcheck Server
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('⏰ Paxta.online Soat Bot is running!');
}).listen(PORT, () => {
  console.log(`🌐 Healthcheck server running on port ${PORT}`);
});

// Render Free Tier uxlatib qo'ymasligi uchun har 8 daqiqada Self-Ping
const https = require('https');
const RENDER_URL = process.env.RENDER_EXTERNAL_URL || 'https://paxta-soat-bot.onrender.com';
setInterval(() => {
  https.get(RENDER_URL, res => {
    // Ping muvaffaqiyatli
  }).on('error', () => {});
}, 8 * 60 * 1000);

const bot = new PaxtaBotApi(BOT_TOKEN);
const messageHandler = new MessageHandler(bot);
const callbackHandler = new CallbackHandler(bot);
const paymentWatcher = new RelayerPaymentWatcher(bot);

let offset = 0;
let isPolling = false;

async function start() {
  console.log('\n╔════════════════════════════════════════╗');
  console.log('║   ⏰ Paxta.online Soat Bot v1.0        ║');
  console.log('╠════════════════════════════════════════╣');
  console.log('║   🤖 Bot: @Soat_bot                    ║');
  console.log('║   🌐 Platforma: paxta.online/bot       ║');
  console.log('╚════════════════════════════════════════╝\n');

  // Bot ma'lumotlarini tekshiramiz
  try {
    const me = await bot.getMe();
    console.log(`✅ Bot muvaffaqiyatli ulandi: @${me.username} (ID: ${me.id})`);
  } catch (err) {
    console.error(`⚠️  getMe xatolik: ${err.message}`);
  }

  // 1. Live Clock Engine ni ishga tushiramiz
  clockEngine.start();

  // 2. Relayer To'lov Kuzatuvchisini ishga tushiramiz
  paymentWatcher.start().catch(err => console.error('PaymentWatcher error:', err.message));

  // 3. Bot Polling ni ishga tushiramiz
  isPolling = true;
  poll();
}

async function poll() {
  while (isPolling) {
    try {
      const updates = await bot.getUpdates(offset, 100, 25);
      if (Array.isArray(updates)) {
        for (const upd of updates) {
          offset = upd.update_id + 1;
          handleUpdate(upd).catch(e => console.error('Update error:', e.message));
        }
      }
    } catch (err) {
      await new Promise(r => setTimeout(r, 4000));
    }
    await new Promise(r => setTimeout(r, 400));
  }
}

async function handleUpdate(update) {
  if (update.message) {
    await messageHandler.handle(update.message);
  } else if (update.callback_query) {
    await callbackHandler.handle(update.callback_query);
  }
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nTo\'xtatilmoqda...');
  isPolling = false;
  clockEngine.stop();
  process.exit(0);
});

start();
