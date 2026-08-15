require("dotenv").config();
const express = require("express");
const { startPolling } = require("./poller");
const { handleIncomingMessage } = require("./messageHandler");

const app = express();
const PORT = process.env.PORT || 3000;

// Endpoint sức khoẻ — dùng để uptime-pinger (UptimeRobot/cron-job.org) gọi định kỳ,
// giữ cho Render free tier không bị "ngủ" (spin down khi không có traffic).
app.get("/", (req, res) => {
  res.json({ ok: true, service: "bot-thu-chi-team05", mode: "polling" });
});

app.listen(PORT, () => {
  console.log(`Bot Thu Chi Team 05 (chế độ polling) đang chạy tại http://localhost:${PORT}`);

  startPolling(handleIncomingMessage).catch((err) => {
    console.error("[index] Vòng lặp polling dừng do lỗi nghiêm trọng:", err);
    process.exit(1);
  });
});
