const axios = require("axios");

const BOT_TOKEN = process.env.BOT_TOKEN;
const BASE_URL = `https://bot-api.zaloplatforms.com/bot${BOT_TOKEN}`;

/**
 * Gửi tin nhắn văn bản tới một cuộc trò chuyện (nhóm hoặc cá nhân).
 * @param {string} chatId
 * @param {string} text
 */
async function sendMessage(chatId, text) {
  try {
    const res = await axios.post(`${BASE_URL}/sendMessage`, {
      chat_id: chatId,
      text,
      parse_mode: "markdown",
    });
    return res.data;
  } catch (err) {
    console.error("[zaloClient] sendMessage lỗi:", err.response?.data || err.message);
    throw err;
  }
}

/**
 * Tải ảnh hoá đơn về dạng Buffer để đưa cho OpenAI Vision xử lý.
 * @param {string} photoUrl
 */
async function downloadPhoto(photoUrl) {
  const res = await axios.get(photoUrl, { responseType: "arraybuffer" });
  const contentType = res.headers["content-type"] || "image/jpeg";
  return { buffer: Buffer.from(res.data), contentType };
}

module.exports = { sendMessage, downloadPhoto, BASE_URL };
