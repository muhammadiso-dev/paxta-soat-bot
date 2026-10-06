const axios = require('axios');

class PaxtaBotApi {
  constructor(token) {
    this.token = token;
    this.baseUrl = `${process.env.PAXTA_API_BASE || 'https://paxta.online/bot'}${token}`;
    this.client = axios.create({
      baseURL: this.baseUrl,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'PaxtaSoatBot/1.0'
      }
    });

    this.client.interceptors.response.use(
      res => {
        if (res.data && !res.data.ok) {
          const desc = res.data.description || 'API Error';
          if (desc.includes('not modified')) return null;
          throw new Error(desc);
        }
        return res.data.result !== undefined ? res.data.result : res.data;
      },
      err => {
        const msg = err.response?.data?.description || err.message;
        if (msg && msg.includes('not modified')) return null;
        console.error(`[PaxtaBotApi] ${err.response?.status || 'Error'}: ${msg}`);
        throw new Error(msg);
      }
    );
  }

  async getMe() {
    return this.client.get('/getMe');
  }

  async getUpdates(offset = 0, limit = 100, timeout = 30) {
    return this.client.post('/getUpdates', { offset, limit, timeout });
  }

  async sendMessage(chatId, text, options = {}) {
    return this.client.post('/sendMessage', {
      chat_id: chatId,
      text,
      parse_mode: options.parseMode || 'Markdown',
      reply_markup: options.replyMarkup || undefined,
      disable_web_page_preview: true,
      ...options
    });
  }

  async editMessageText(chatId, messageId, text, options = {}) {
    return this.client.post('/editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: options.parseMode || 'Markdown',
      reply_markup: options.replyMarkup || undefined,
      disable_web_page_preview: true
    });
  }

  async answerCallbackQuery(callbackQueryId, text = '', showAlert = false) {
    try {
      return await this.client.post('/answerCallbackQuery', {
        callback_query_id: callbackQueryId,
        text,
        show_alert: showAlert
      });
    } catch (e) {
      return null;
    }
  }
}

module.exports = { PaxtaBotApi };
