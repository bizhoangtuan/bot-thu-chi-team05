// Script tiện ích: chạy `npm run remove-webhook` để gỡ Webhook, bắt buộc trước khi dùng
// chế độ polling (getUpdates), vì 2 cơ chế này loại trừ lẫn nhau.
require("dotenv").config();
const axios = require("axios");

const { BOT_TOKEN } = process.env;

async function main() {
  if (!BOT_TOKEN) {
    console.error("Thiếu BOT_TOKEN trong .env");
    process.exit(1);
  }

  const entrypoint = `https://bot-api.zaloplatforms.com/bot${BOT_TOKEN}/deleteWebhook`;
  const res = await axios.post(entrypoint, {});

  console.log("Kết quả deleteWebhook:", JSON.stringify(res.data, null, 2));
}

main().catch((err) => {
  console.error("Lỗi deleteWebhook:", err.response?.data || err.message);
  process.exit(1);
});
