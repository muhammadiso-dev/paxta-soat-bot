const crypto = require('crypto');

// 32-baytli maxfiy shifrlash kaliti
const SECRET_KEY = crypto.createHash('sha256')
  .update(process.env.ENCRYPTION_KEY || process.env.BOT_TOKEN || 'soat-bot-secret-key-32b-seed')
  .digest();

const ALGORITHM = 'aes-256-cbc';
const IV_LENGTH = 16;

function encryptPassword(plainText) {
  if (!plainText) return '';
  // Agar allaqachon shifrlangan bo'lsa qaytaramiz
  if (plainText.startsWith('enc::')) return plainText;

  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, SECRET_KEY, iv);
  let encrypted = cipher.update(plainText, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  return `enc::${iv.toString('hex')}::${encrypted}`;
}

function decryptPassword(encryptedText) {
  if (!encryptedText) return '';
  if (!encryptedText.startsWith('enc::')) {
    // Shifrlanmagan eski parol bo'lsa o'zini qaytaradi
    return encryptedText;
  }

  try {
    const parts = encryptedText.split('::');
    if (parts.length !== 3) return encryptedText;

    const iv = Buffer.from(parts[1], 'hex');
    const encryptedData = parts[2];
    const decipher = crypto.createDecipheriv(ALGORITHM, SECRET_KEY, iv);
    let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (err) {
    console.error('[Crypto Decrypt Error]:', err.message);
    return encryptedText;
  }
}

module.exports = {
  encryptPassword,
  decryptPassword
};
