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

// Ảnh gửi trước, chưa tag — lưu tạm chờ tin nhắn tag gửi sau (tiện thao tác trên điện thoại,
// không cần vừa đính kèm ảnh vừa gõ tag trong cùng 1 lần gửi).
// key: "<chatId>:<senderId>" -> { photoUrl, messageId, sender, receivedAt }
const PENDING_PHOTO_TTL_MS = 15 * 60 * 1000; // 15 phút
const pendingPhotos = new Map();

function rememberPendingPhoto(chatId, senderId, data) {
  pendingPhotos.set(`${chatId}:${senderId}`, { ...data, receivedAt: Date.now() });
}

function takePendingPhoto(chatId, senderId) {
  const key = `${chatId}:${senderId}`;
  const entry = pendingPhotos.get(key);
  if (!entry) return null;
  pendingPhotos.delete(key);
  if (Date.now() - entry.receivedAt > PENDING_PHOTO_TTL_MS) return null; // đã hết hạn chờ
  return entry;
}

// Tài liệu Zalo ghi trường ảnh là "photo", nhưng thực tế trả về là "photo_url".
// Vẫn thử thêm vài tên trường phổ biến khác để phòng thay đổi trong tương lai.
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

// Khi người dùng dùng tính năng "Trả lời" (reply/quote) 1 tin nhắn ảnh trên Zalo, tin nhắn text
// nhận được có thể kèm theo dữ liệu tin nhắn được trả lời (tên trường chưa xác định chắc chắn -
// thử nhiều tên phổ biến, đồng thời log raw JSON để xác nhận khi cần).
function extractQuotedPhotoUrl(message) {
  const quote =
    message.quote ||
    message.reply_to_message ||
    message.replied_message ||
    message.quoted_message ||
    message.msg_reply ||
    message.reply ||
    message.reply_message ||
    null;
  if (!quote) return null;
  return extractPhotoUrl(quote);
}

/**
 * Xử lý 1 sự kiện tin nhắn nhận được từ Zalo (webhook hoặc polling).
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
  const senderId = message.from?.id;
  const sender = message.from?.display_name || "Không rõ";
  const photoUrl = extractPhotoUrl(message);

  if (!photoUrl) {
    console.error("[handler] Không tìm thấy link ảnh trong message:", JSON.stringify(message));
    return;
  }

  if (isBotTagged(message)) {
    // Ảnh + tag gửi chung 1 tin nhắn -> xử lý luôn
    await processBillPhoto({ chatId, sender, photoUrl, messageId: message.message_id });
  } else {
    // Chưa tag -> lưu chờ tin nhắn tag gửi sau (trong vòng 15 phút)
    rememberPendingPhoto(chatId, senderId, { photoUrl, messageId: message.message_id, sender });
    console.log(`[handler] Lưu ảnh chờ tag từ "${sender}" trong chat ${chatId}`);
  }
}

async function handleTextMessage(message) {
  if (!isBotTagged(message)) return;
  if (processedMessageIds.has(message.message_id)) return;
  processedMessageIds.add(message.message_id);

  // Log tạm để xác định tên trường chứa dữ liệu ảnh được "trả lời" (reply/quote), nếu có.
  console.log("[handler] DEBUG raw text message (đã tag bot):", JSON.stringify(message));

  const chatId = message.chat.id;
  const senderId = message.from?.id;
  const sender = message.from?.display_name || "Không rõ";

  // Ưu tiên 1: người dùng dùng tính năng "Trả lời" (reply) trực tiếp vào tin nhắn ảnh.
  const quotedPhotoUrl = extractQuotedPhotoUrl(message);
  if (quotedPhotoUrl) {
    await processBillPhoto({ chatId, sender, photoUrl: quotedPhotoUrl, messageId: message.message_id });
    return;
  }

  // Ưu tiên 2: ảnh gửi trước đó (không reply), tag gửi tách rời sau -> lấy từ bộ nhớ tạm.
  const pending = takePendingPhoto(chatId, senderId);
  if (!pending) {
    // Tag bot bằng text nhưng không có ảnh nào đang chờ xử lý -> bỏ qua, tránh trả lời tràn lan
    // cho các tin nhắn chit-chat có nhắc tên bot mà không liên quan tới hoá đơn.
    return;
  }

  await processBillPhoto({
    chatId,
    sender: pending.sender,
    photoUrl: pending.photoUrl,
    messageId: pending.messageId,
  });
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
