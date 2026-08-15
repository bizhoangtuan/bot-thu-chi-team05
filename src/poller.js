const axios = require("axios");
const { BASE_URL } = require("./zaloClient");

const POLL_TIMEOUT_SEC = 30;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getUpdates() {
  const res = await axios.post(
    `${BASE_URL}/getUpdates`,
    { timeout: POLL_TIMEOUT_SEC },
    { timeout: (POLL_TIMEOUT_SEC + 15) * 1000 }
  );
  return res.data;
}

/**
 * Vòng lặp long-polling vô hạn: liên tục gọi getUpdates, xử lý tin nhắn mới nếu có.
 * Dùng thay cho webhook vì webhook hiện không nhận được event cho tin nhắn nhóm (đã xác minh).
 * @param {(result: object) => Promise<void>} onUpdate
 */
async function startPolling(onUpdate) {
  console.log("[poller] Bắt đầu polling (getUpdates)...");

  // Đảm bảo không còn webhook nào đang set (getUpdates sẽ lỗi 400 nếu còn webhook)
  while (true) {
    try {
      const data = await getUpdates();

      if (data?.ok && data.result?.message) {
        await onUpdate(data.result);
      } else if (!data?.ok && data?.error_code && data.error_code !== 408) {
        // 408 = request timeout do không có tin nhắn mới trong thời gian chờ -> bình thường, lặp lại ngay
        console.error("[poller] getUpdates trả lỗi:", data);
        await sleep(3000);
      }
    } catch (err) {
      console.error("[poller] Lỗi khi gọi getUpdates:", err.message);
      await sleep(5000);
    }
  }
}

module.exports = { startPolling };
