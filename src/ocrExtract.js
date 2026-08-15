const OpenAI = require("openai");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

const EXTRACTION_PROMPT = `Bạn là trợ lý kế toán. Đây là ảnh chụp một hoá đơn/bill chi tiêu hoặc biên lai chuyển khoản.
Hãy đọc kỹ ảnh và trả về DUY NHẤT một JSON object (không thêm chữ nào khác, không dùng markdown code block) theo đúng schema sau:

{
  "amount": number,            // tổng số tiền trên hoá đơn, chỉ lấy số (VNĐ), không có dấu chấm/phẩy
  "date": string,               // ngày trên hoá đơn dạng YYYY-MM-DD, nếu không đọc được thì để null
  "merchant": string,           // tên cửa hàng/đơn vị/người nhận trên hoá đơn, nếu không có thì để null
  "description": string,        // tóm tắt ngắn gọn nội dung hoá đơn (VD: "Ăn trưa", "Mua văn phòng phẩm")
  "type": "chi" | "thu",        // mặc định là "chi" trừ khi rõ ràng là khoản thu/nhận tiền
  "confidence": "high" | "medium" | "low"  // mức độ chắc chắn khi đọc số tiền
}

Nếu ảnh không phải hoá đơn/biên lai hoặc không đọc được số tiền, trả về {"amount": null, "date": null, "merchant": null, "description": null, "type": "chi", "confidence": "low"}.`;

/**
 * Gửi ảnh hoá đơn cho OpenAI Vision (gpt-4o-mini), nhận về dữ liệu đã trích xuất.
 * @param {Buffer} imageBuffer
 * @param {string} mediaType vd: "image/jpeg"
 * @returns {Promise<object>}
 */
async function extractBillData(imageBuffer, mediaType = "image/jpeg") {
  const base64Image = imageBuffer.toString("base64");

  const completion = await openai.chat.completions.create({
    model: MODEL,
    max_tokens: 500,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: EXTRACTION_PROMPT },
          {
            type: "image_url",
            image_url: { url: `data:${mediaType};base64,${base64Image}` },
          },
        ],
      },
    ],
  });

  const rawText = completion.choices[0]?.message?.content?.trim() || "";

  try {
    const cleaned = rawText.replace(/^```(json)?/i, "").replace(/```$/, "").trim();
    return JSON.parse(cleaned);
  } catch (err) {
    console.error("[ocrExtract] Không parse được JSON từ OpenAI:", rawText);
    return {
      amount: null,
      date: null,
      merchant: null,
      description: null,
      type: "chi",
      confidence: "low",
    };
  }
}

module.exports = { extractBillData };
