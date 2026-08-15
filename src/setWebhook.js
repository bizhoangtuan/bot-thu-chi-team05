// Script tiện ích: chạy `npm run set-webhook` để đăng ký Webhook URL với Zalo Bot Platform.
// Yêu cầu đã điền BOT_TOKEN, WEBHOOK_URL, WEBHOOK_SECRET_TOKEN trong file .env
require("dotenv").config();
const axios = require("axios");

const { BOT_TOKEN, WEBHOOK_URL, WEBHOOK_SECRET_TOKEN } = process.env;

async function main() {
  if (!BOT_TOKEN || !WEBHOOK_URL || !WEBHOOK_SECRET_TOKEN) {
    console.error("Thiếu BOT_TOKEN, WEBHOOK_URL hoặc WEBHOOK_SECRET_TOKEN trong .env");
    process.exit(1);
  }

  const entrypoint = `https://bot-api.zaloplatforms.com/bot${BOT_TOKEN}/setWebhook`;
  const res = await axios.post(entrypoint, {
    url: WEBHOOK_URL,
    secret_token: WEBHOOK_SECRET_TOKEN,
  });

  console.log("Kết quả setWebhook:", JSON.stringify(res.data, null, 2));
}

main().catch((err) => {
  console.error("Lỗi setWebhook:", err.response?.data || err.message);
  process.exit(1);
});
