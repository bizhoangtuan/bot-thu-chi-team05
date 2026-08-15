const { google } = require("googleapis");

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const SHEET_NAME = process.env.GOOGLE_SHEET_NAME || "ThuChi";

// Thứ tự cột trong Google Sheet — xem README để biết ý nghĩa từng cột
const HEADER_ROW = [
  "Thời gian ghi nhận",
  "Người gửi",
  "Loại (Thu/Chi)",
  "Số tiền (VNĐ)",
  "Nội dung",
  "Đơn vị/Merchant",
  "Ngày trên hoá đơn",
  "Link ảnh hoá đơn",
  "Độ tin cậy OCR",
  "Message ID",
];

let sheetsClientPromise = null;

function getSheetsClient() {
  if (!sheetsClientPromise) {
    const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
    sheetsClientPromise = google.sheets({ version: "v4", auth });
  }
  return sheetsClientPromise;
}

/**
 * Đảm bảo sheet đã có dòng tiêu đề. Chỉ cần chạy 1 lần, nhưng gọi lại cũng an toàn.
 */
async function ensureHeader() {
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_NAME}!A1:J1`,
  });
  if (!res.data.values || res.data.values.length === 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_NAME}!A1:J1`,
      valueInputOption: "RAW",
      requestBody: { values: [HEADER_ROW] },
    });
  }
}

/**
 * Ghi một dòng thu/chi mới vào cuối sheet.
 * @param {object} row
 * @param {string} row.sender - display_name người gửi trên Zalo
 * @param {"thu"|"chi"} row.type
 * @param {number|null} row.amount
 * @param {string|null} row.description
 * @param {string|null} row.merchant
 * @param {string|null} row.billDate
 * @param {string} row.photoUrl
 * @param {"high"|"medium"|"low"} row.confidence
 * @param {string} row.messageId
 */
async function appendExpenseRow(row) {
  const sheets = getSheetsClient();
  await ensureHeader();

  const values = [[
    new Date().toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }),
    row.sender,
    row.type === "thu" ? "Thu" : "Chi",
    row.amount ?? "",
    row.description ?? "",
    row.merchant ?? "",
    row.billDate ?? "",
    row.photoUrl,
    row.confidence ?? "",
    row.messageId,
  ]];

  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_NAME}!A:J`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values },
  });
}

module.exports = { appendExpenseRow, ensureHeader };
