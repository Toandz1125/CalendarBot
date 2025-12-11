// client.js
import { HubConnectionBuilder, LogLevel } from '@microsoft/signalr';
import { v4 as uuidv4 } from 'uuid'; // nếu muốn UUID (npm i uuid)

// Nếu server yêu cầu token JWT để map UserIdentifier thì thêm hàm accessTokenFactory.
// Giả sử bạn đã có token ở biến sessionToken.
const sessionToken = sessionStorage.getItem("sessionToken");

const hubUrl = 'http://localhost:5246/hubs/notifications'; // hoặc wss://... nếu HTTPS

const connection = new HubConnectionBuilder()
  .withUrl(hubUrl, {
    accessTokenFactory: () => sessionToken // nếu backend đọc từ bearer token
  })
  .withAutomaticReconnect()
  .configureLogging(LogLevel.Information)
  .build();

// Lắng nghe notification
connection.on('notification', raw => {
  // Server hiện có thể gửi chuỗi JSON (ack/processed/greeting) hoặc plain text Hello
  let obj = raw;
  try {
    if (typeof raw === 'string' && raw.trim().startsWith('{')) {
      obj = JSON.parse(raw);
    }
  } catch {
    // giữ nguyên raw nếu parse lỗi
  }

  if (typeof obj === 'object' && obj.type) {
    switch (obj.type) {
      case 'greeting':
        console.log('[greeting]', obj.message ?? raw);
        break;
      case 'ack':
        console.log(`[ack] messageId=${obj.messageId}`);
        break;
      case 'processed':
        console.log(`[processed] messageId=${obj.messageId}`);
        // payload có thể là JSON string => thử parse
        if (obj.payload && typeof obj.payload === 'string') {
          try {
            const payloadObj = JSON.parse(obj.payload);
            console.log('  upper:', payloadObj.upper);
            console.log('  length:', payloadObj.length);
          } catch {
            console.log('  raw payload:', obj.payload);
          }
        }
        break;
      default:
        console.log('[notification] (unknown type)', obj);
    }
  } else {
    // plain text (ví dụ Hello <ConnectionId>)
    console.log('[notification]', raw);
  }
});

connection.on('echo', msg => {
  console.log('[echo]', msg);
});

// Kết nối
async function start() {
  try {
    await connection.start();
    console.log('Connected!');
  } catch (err) {
    console.error('Connect error:', err);
    setTimeout(start, 2000);
  }
}

start();

// Hàm gửi message để xử lý hai pha
async function sendProcessMessage(content) {
  const messageId = uuidv4(); // hoặc tự sinh Date.now()
  console.log('Gửi xử lý messageId=', messageId);
  try {
    await connection.invoke('ProcessMessage', content, messageId);
  } catch (err) {
    console.error('Invoke ProcessMessage lỗi:', err);
  }
}

// Hàm test echo
async function sendEcho(content) {
  try {
    await connection.invoke('Echo', content);
  } catch (err) {
    console.error('Invoke Echo lỗi:', err);
  }
}

// Ví dụ: gửi sau 2s
setTimeout(() => sendProcessMessage('Xin chào server'), 2000);
setTimeout(() => sendEcho('!Test echo'), 3000);