const { sendMessage, downloadPhoto } = require("./zaloClient");
const { extractBillData } = require("./ocrExtract");
const { appendExpenseRow } = require("./sheets");

// Các từ khoá coi là "tag bot" khi xuất hiện trong caption/text tin nhắn.
// Tên hiển thị thật của bot có thể khác với BOT_TOKEN name (vd: "Bot Thu - Chi Team 05"),
// nên liệt kê thêm biến thể nếu cần qua BOT_MENTION_KEYWORDS trong .env.
const BOT_MENTION_KEYWORDS = (
  process.env.BOT_MENTION_KEYWORDS ||
  "bot thu - chi team 05,bot thu chi team 05,@bot thu - chi team 05,@bot thu chi team 05"
)
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

// Chống xử lý trùng lặp (best-effort, chỉ tồn tại trong bộ nhớ khi app đang chạy)
const processedMessageIds = new Set();

// Tài liệu Zalo ghi trường ảnh là "photo", nhưng để phòng trường hợp thực tế trả về
// tên khác, thử lần lượt các tên trường phổ biến. Xem log "DEBUG raw message object"
// để biết chính xác tên trường thật và rút gọn lại danh sách này nếu cần.
function extractPhotoUrl(message) {
  return (
    message.photo ||
    message.photo_url ||
    message.image ||
    message.image_url ||
    message.file_url ||
    message.url ||
    message.attachment?.url ||
    message.attachments?.[0]?.url ||
    null
  );
}

function isBotTagged(message) {
  const text = (message.caption || message.text || "").toLowerCase();
  if (!text) return false;
  return BOT_MENTION_KEYWORDS.some((kw) => text.includes(kw));
}

/**
 * Xử lý 1 sự kiện tin nhắn nhận được từ Zalo (dùng chung cho cả webhook và polling).
 * @param {{event_name: string, message: object}} result
 */
async function handleIncomingMessage(result) {
  const eventName = result?.event_name;
  const message = result?.message;
  if (!message) return;

  console.log(
    `[handler] event=${eventName} chat_type=${message.chat?.chat_type} from=${message.from?.display_name} text=${message.text || message.caption || ""}`
  );

  if (eventName !== "message.image.received") return;

  // Debug: in toàn bộ object message để xác nhận đúng tên trường chứa link ảnh
  // (tài liệu ghi là "photo" nhưng thực tế trả về có thể khác — xem log này để đối chiếu).
  console.log("[handler] DEBUG raw message object:", JSON.stringify(message));

  if (processedMessageIds.has(message.message_id)) return;
  processedMessageIds.add(message.message_id);

  if (!isBotTagged(message)) {
    console.log("[handler] Ảnh không tag bot, bỏ qua.");
    return;
  }

  const chatId = message.chat.id;
  const sender = message.from?.display_name || "Không rõ";
  const photoUrl = extractPhotoUrl(message);

  if (!photoUrl) {
    console.error("[handler] Không tìm thấy link ảnh trong message. Xem DEBUG log ở trên để bổ sung tên trường vào extractPhotoUrl().");
    await sendMessage(chatId, `⚠️ @${sender} Mình nhận được ảnh nhưng chưa đọc được link ảnh (lỗi kỹ thuật), đang được khắc phục.`);
    return;
  }

  try {
    const { buffer, contentType } = await downloadPhoto(photoUrl);
    const billData = await extractBillData(buffer, contentType);

    if (billData.amount == null) {
      await sendMessage(
        chatId,
        `⚠️ @${sender} Mình không đọc được số tiền trên ảnh này. Vui lòng kiểm tra lại ảnh hoặc nhập tay vào sheet nhé.`
      );
      return;
    }

    await appendExpenseRow({
      sender,
      type: billData.type,
      amount: billData.amount,
      description: billData.description,
      merchant: billData.merchant,
      billDate: billData.date,
      photoUrl,
      confidence: billData.confidence,
      messageId: message.message_id,
    });

    const amountText = Number(billData.amount).toLocaleString("vi-VN");
    const confidenceNote =
      billData.confidence === "low" ? "\n⚠️ Độ tin cậy thấp, nhờ kiểm tra lại giúp mình." : "";
    await sendMessage(
      chatId,
      `✅ Đã ghi nhận **${billData.type === "thu" ? "khoản thu" : "khoản chi"}**\n` +
        `Số tiền: **${amountText}đ**\n` +
        `Nội dung: ${billData.description || "(không rõ)"}\n` +
        `Người gửi: ${sender}${confidenceNote}`
    );
  } catch (err) {
    console.error("[handler] Lỗi xử lý tin nhắn:", err);
  }
}

module.exports = { handleIncomingMessage, isBotTagged };