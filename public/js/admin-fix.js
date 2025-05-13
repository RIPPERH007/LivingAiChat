// admin-fix.js - แก้ไขปัญหาการแสดงแชทฝั่ง admin
(function() {
  console.log('Admin Fix loaded - v1.0');

  // รอให้ DOM โหลดเสร็จ
  document.addEventListener('DOMContentLoaded', function() {
    // เพิ่ม CSS ที่จำเป็น
    const style = document.createElement('style');
    style.textContent = `
      .message.user { margin-left: auto; background-color: #e7f0ff; border-radius: 15px; padding: 10px; margin-bottom: 10px; max-width: 80%; }
      .message.bot { margin-right: auto; background-color: #f0f0f0; border-radius: 15px; padding: 10px; margin-bottom: 10px; max-width: 80%; }
      .message.admin { margin-right: auto; background-color: #e3f8e8; border-radius: 15px; padding: 10px; margin-bottom: 10px; max-width: 80%; }
    `;
    document.head.appendChild(style);

    // ให้แน่ใจว่ามีการเชื่อมต่อ Socket.IO
    const attemptSocketConnect = setInterval(function() {
      if (window.io) {
        clearInterval(attemptSocketConnect);
        setupSocketConnection();
      }
    }, 500);
  });

  // ตั้งค่าการเชื่อมต่อ Socket.IO ใหม่
  function setupSocketConnection() {
    const chatMessages = document.getElementById('adminChatMessages');
    if (!chatMessages) {
      console.error('Chat messages container not found!');
      return;
    }

    console.log('Setting up direct socket connection');

    // สร้างการเชื่อมต่อ Socket.IO ตรง
    const directSocket = io();

    // เก็บ reference ของ socket ในตัวแปร global
    window.directSocket = directSocket;

    // ลงทะเบียนเพื่อรับข้อความ
    directSocket.on('new_message', function(data) {
      console.log('Direct message received:', data);
      displayMessage(data);
    });

    // เปิดรับทุกข้อความจากทุกห้อง
    directSocket.on('connect', function() {
      console.log('Direct socket connected:', directSocket.id);

      // ให้ admin เข้าร่วมทุกห้อง (hack ชั่วคราว)
      directSocket.emit('join_all_rooms');
    });

    // ติด override เข้าไปในฟังก์ชันเดิม
    attachOpenChatSessionOverride();
  }

  // แสดงข้อความใน chat panel
  function displayMessage(data) {
    const chatMessages = document.getElementById('adminChatMessages');
    if (!chatMessages) return;

    // รับ current session ID
    let currentSessionId = '';
    if (window.state && window.state.currentSessionId) {
      currentSessionId = window.state.currentSessionId;
    }

    // ตรวจสอบว่าเป็นข้อความในห้องที่กำลังดูอยู่หรือไม่
    if (data.room && data.room !== currentSessionId) {
      console.log('Message is for a different room. Current:', currentSessionId, 'Message room:', data.room);

      // ถ้าไม่ใช่ห้องปัจจุบัน แค่แสดง notification
      if (data.sender === 'user') {
        showNotification(`มีข้อความใหม่จากห้อง ${data.room}`);

        // รีโหลดรายการการสนทนา
        if (typeof window.loadConversations === 'function') {
          window.loadConversations();
        }
      }
      return;
    }

    // ตรวจสอบว่ามีข้อความนี้แสดงอยู่แล้วหรือไม่
    const existingMessage = document.querySelector(`.message[data-message-id="${data.timestamp}"]`);
    if (existingMessage) {
      console.log('Message already displayed');
      return;
    }

    // สร้าง message element
    const messageEl = document.createElement('div');
    messageEl.className = `message ${data.sender}`;
    messageEl.setAttribute('data-message-id', data.timestamp);

    // สร้างเนื้อหาข้อความ
    let messageContent = `<p>${data.text || ''}</p>`;

    // ถ้ามี payload จาก bot
    if (data.sender === 'bot' && data.payload) {
      messageContent += `<div class="payload-content">${JSON.stringify(data.payload)}</div>`;
    }

    // ใส่เนื้อหาลงใน message element
    messageEl.innerHTML = messageContent;

    // เพิ่มข้อความลงในพื้นที่แชท
    chatMessages.appendChild(messageEl);

    // เลื่อนไปล่างสุด
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  // override ฟังก์ชัน openChatSession
  function attachOpenChatSessionOverride() {
    console.log('Attempting to override openChatSession');

    // บันทึกฟังก์ชันเดิม (ถ้ามี)
    if (typeof window.openChatSession === 'function') {
      const originalOpenChatSession = window.openChatSession;

      window.openChatSession = function(sessionId) {
        console.log('Intercepted openChatSession call for session:', sessionId);

        // เรียกฟังก์ชันเดิม
        originalOpenChatSession.call(this, sessionId);

        // เพิ่มการเข้าร่วมห้องแชทผ่าน direct socket
        if (window.directSocket) {
          console.log('Joining room via direct socket:', sessionId);
          window.directSocket.emit('join', sessionId);
        }

        // โหลดประวัติการสนทนาใหม่
        setTimeout(function() {
          fetchAndDisplayChatHistory(sessionId);
        }, 1000);
      };

      console.log('Successfully overrode openChatSession');
    } else {
      console.warn('Could not find openChatSession function to override');
    }
  }

  // เรียกดูประวัติการสนทนาโดยตรงจาก API
  function fetchAndDisplayChatHistory(sessionId) {
    console.log('Fetching chat history for session:', sessionId);

    fetch(`/api/conversations/${sessionId}`)
      .then(response => response.json())
      .then(data => {
        console.log('Fetched conversation history:', data);

        if (data.success && data.conversation && data.conversation.messages) {
          const chatMessages = document.getElementById('adminChatMessages');

          // ล้างข้อความเก่า
          chatMessages.innerHTML = '';

          // แสดงข้อความใหม่
          data.conversation.messages.forEach(msg => {
            displayMessage({
              sender: msg.sender,
              text: msg.text,
              timestamp: msg.timestamp,
              room: sessionId,
              payload: msg.payload
            });
          });

          console.log('Successfully displayed chat history');
        } else {
          console.error('Invalid or empty chat history data');
        }
      })
      .catch(error => {
        console.error('Error fetching chat history:', error);
      });
  }

  // ฟังก์ชันแสดงการแจ้งเตือน
  function showNotification(message) {
    // ตรวจสอบว่ามีฟังก์ชัน showNotification อยู่แล้วหรือไม่
    if (typeof window.showNotification === 'function') {
      window.showNotification(message);
      return;
    }

    // สร้างการแจ้งเตือนเองถ้ายังไม่มีฟังก์ชัน
    const notification = document.createElement('div');
    notification.className = 'admin-notification';
    notification.textContent = message;

    // จัดรูปแบบการแจ้งเตือน
    notification.style.position = 'fixed';
    notification.style.top = '20px';
    notification.style.right = '20px';
    notification.style.backgroundColor = 'rgba(94, 53, 177, 0.9)';
    notification.style.color = 'white';
    notification.style.padding = '12px 20px';
    notification.style.borderRadius = '5px';
    notification.style.boxShadow = '0 4px 8px rgba(0, 0, 0, 0.2)';
    notification.style.zIndex = '9999';

    // เพิ่มลงในหน้าเว็บ
    document.body.appendChild(notification);

    // ซ่อนการแจ้งเตือนหลังจาก 5 วินาที
    setTimeout(() => {
      notification.style.opacity = '0';
      notification.style.transition = 'opacity 0.5s';

      setTimeout(() => {
        document.body.removeChild(notification);
      }, 500);
    }, 5000);
  }
})();
