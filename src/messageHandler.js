const { sendMessage, downloadPhoto } = require("./zaloClient");
const { extractBillData } = require("./ocrExtract");
const { appendExpenseRow } = require("./sheets");

// Các từ khoá coi là "tag bot" khi xuất hiện trong tin nhắn TEXT (không kèm ảnh).
const BOT_MENTION_KEYWORDS = (
  process.env.BOT_MENTION_KEYWORDS ||
  "bot thu - chi team 05,bot thu chi team 05,@bot thu - chi team 05,@bot thu chi team 05"
)
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

// Chống xử lý trùng lặp (best-effort, chỉ tồn tại trong bộ nhớ khi app đang chạy)
const processedMessageIds = new Set();

// QUAN TRỌNG (đã xác nhận qua kiểm thử thực tế): Zalo Bot Platform KHÔNG đẩy sự kiện
// "message.image.received" qua getUpdates nếu ảnh gửi không kèm theo chữ (caption) nào.
// Vì vậy bot không có cách nào biết được có ảnh "gửi trước, chưa tag" đang chờ — nên không thể
// làm luồng "gửi ảnh trước, tag sau bằng tin nhắn riêng". Ảnh luôn phải kèm ít nhất 1 chữ mới
// tới được bot. Do đó: hễ ảnh có kèm chữ (bất kỳ nội dung gì) là xử lý luôn, không bắt buộc phải
// đúng tên bot nữa (gõ đúng tên bot lúc này chỉ gây thêm thao tác thừa).
function extractPhotoUrl(message) {
  return (
    message.photo_url ||
    message.photo ||
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
 * Xử lý 1 sự kiện tin nhắn nhận được từ Zalo (qua polling getUpdates).
 * @param {{event_name: string, message: object}} result
 */
async function handleIncomingMessage(result) {
  const eventName = result?.event_name;
  const message = result?.message;
  if (!message) return;

  console.log(
    `[handler] event=${eventName} chat_type=${message.chat?.chat_type} from=${message.from?.display_name} text=${message.text || message.caption || ""}`
  );

  if (eventName === "message.image.received") {
    await handleImageMessage(message);
  } else if (eventName === "message.text.received") {
    await handleTextMessage(message);
  }
}

async function handleImageMessage(message) {
  if (processedMessageIds.has(message.message_id)) return;
  processedMessageIds.add(message.message_id);

  const chatId = message.chat.id;
  const sender = message.from?.display_name || "Không rõ";
  const photoUrl = extractPhotoUrl(message);
  const caption = (message.caption || message.text || "").trim();

  if (!photoUrl) {
    console.error("[handler] Không tìm thấy link ảnh trong message:", JSON.stringify(message));
    return;
  }

  if (!caption) {
    // Trên lý thuyết trường hợp này hiếm khi xảy ra (ảnh không chữ thường không tới được bot),
    // nhưng phòng khi Zalo thay đổi hành vi, log lại để biết.
    console.log("[handler] Ảnh không kèm chữ, bỏ qua:", message.message_id);
    return;
  }

  // Ảnh có kèm bất kỳ chữ gì -> coi như yêu cầu ghi nhận hoá đơn, xử lý luôn.
  await processBillPhoto({ chatId, sender, photoUrl, messageId: message.message_id });
}

async function handleTextMessage(message) {
  if (!isBotTagged(message)) return;
  if (processedMessageIds.has(message.message_id)) return;
  processedMessageIds.add(message.message_id);

  const chatId = message.chat.id;

  // Tag bot bằng tin nhắn text thuần (không có ảnh) -> nhắc lại cách dùng đúng, tránh gây
  // hiểu lầm rằng bot đã "chờ sẵn" 1 ảnh nào đó từ trước (Zalo không cho phép làm vậy).
  await sendMessage(
    chatId,
    `👋 Để ghi nhận hoá đơn, gửi ảnh hoá đơn kèm theo vài chữ bất kỳ trong CÙNG 1 tin nhắn nhé (ví dụ gõ "chi ăn trưa" rồi đính kèm ảnh, gửi chung 1 lần). Ảnh gửi riêng không kèm chữ mình sẽ không nhận được.`
  );
}

/**
 * Tải ảnh, gọi OpenAI đọc hoá đơn, ghi vào Sheet, trả lời xác nhận trong chat.
 */
async function processBillPhoto({ chatId, sender, photoUrl, messageId }) {
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
      messageId,
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
    console.error("[handler] Lỗi xử lý ảnh hoá đơn:", err);
  }
}

module.exports = { handleIncomingMessage, isBotTagged };
