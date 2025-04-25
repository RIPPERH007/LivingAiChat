/**
 * Node.js Backend Server
 * เชื่อมต่อระหว่าง Live Chat และ Dialogflow
 * รองรับการทำงานกับระบบแอดมินและใช้ Socket.IO สำหรับแชทแบบเรียลไทม์
 */
require('dotenv').config();

const cors = require('cors');
const { SessionsClient } = require('@google-cloud/dialogflow');
const { struct } = require('pb-util');
const uuid = require('uuid');
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const path = require('path');
const webhookController = require('./controllers/webhookController');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*", // อนุญาตให้เข้าถึงจากทุกโดเมน (ปรับแก้ตามความเหมาะสมในการใช้งานจริง)
    methods: ["GET", "POST"],
    allowedHeaders: ["my-custom-header"],
    credentials: true
  }
});

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cors());
app.use(express.json());

// Webhook Route
app.post('/webhook', webhookController.handleWebhook);

// ตั้งค่า Dialogflow
const sessionClient = new SessionsClient({
  keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
  projectId: process.env.DIALOGFLOW_PROJECT_ID,
});

// สร้างตัวแปรสำหรับเก็บข้อมูลแต่ละขั้นตอน โดยใช้ sessionId เป็น key
const sessionData = {};

// สร้างตัวแปรสำหรับเก็บข้อมูลการสนทนา
const conversations = {};

// Socket.IO Event Handlers
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  // รับการสมัครห้องแชท (เมื่อผู้ใช้หรือแอดมินเข้าร่วมห้อง)
  socket.on('join', (roomId) => {
    console.log(`Client ${socket.id} joined room: ${roomId}`);
    socket.join(roomId);
  });

  // รับเมื่อผู้ใช้ออกจากห้อง
  socket.on('leave', (roomId) => {
    console.log(`Client ${socket.id} left room: ${roomId}`);
    socket.leave(roomId);
  });

  // รับข้อความจากผู้ใช้หรือแอดมิน
  socket.on('new_message', (data) => {
    console.log('New message received via socket:', data);
    // ส่งข้อความไปยังทุกคนที่อยู่ในห้องเดียวกัน (ยกเว้นผู้ส่ง)
    socket.to(data.room).emit('new_message', data);
  });

  // รับการอัปเดตสถานะ
  socket.on('status_update', (data) => {
    console.log('Status update received:', data);
    socket.to(data.room).emit('status_update', data);
  });

  // ตัวจัดการเมื่อตัดการเชื่อมต่อ
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

/**
 * API สำหรับส่งข้อความไปยัง Dialogflow
 */
app.post('/api/dialogflow', async (req, res) => {
  try {
    const { query, sessionId, userInfo } = req.body;
    const currentSessionId = sessionId || uuid.v4();

   // ตรวจสอบและสร้างข้อมูลสำหรับ session นี้ถ้ายังไม่มี
   if (!sessionData[currentSessionId]) {
     sessionData[currentSessionId] = {
       userInfo: {
         name: null,
         email: null,
         phone: null,
         timestamp: Date.now()
       }
     };
   }

   // อัปเดตข้อมูลผู้ใช้ถ้ามีการส่งมา
   if (userInfo) {
     sessionData[currentSessionId].userInfo = {
       ...sessionData[currentSessionId].userInfo,
       ...userInfo,
       timestamp: sessionData[currentSessionId].userInfo.timestamp
     };
   }
    // สร้าง session path
    const sessionPath = sessionClient.projectAgentSessionPath(
      process.env.DIALOGFLOW_PROJECT_ID,
      currentSessionId
    );

    // สร้าง request สำหรับ Dialogflow
    const request = {
      session: sessionPath,
      queryInput: {
        text: {
          text: query,
          languageCode: 'th-TH', // ภาษาไทย (เปลี่ยนเป็น 'en-US' สำหรับภาษาอังกฤษ)
        },
      },
    };

    // ส่ง request ไปยัง Dialogflow
    const responses = await sessionClient.detectIntent(request);
    const result = responses[0].queryResult;
    const detectedIntent = result.intent ? result.intent.displayName : 'ไม่พบ intent';

    // บันทึกข้อความลงในประวัติการสนทนา
   if (!conversations[currentSessionId]) {
     conversations[currentSessionId] = {
       messages: [],
       status: 'waiting',
       lastActivity: Date.now()
     };
   }

   // สร้างข้อมูลข้อความของผู้ใช้
   const userMessage = {
     sender: 'user',
     text: query,
     timestamp: Date.now()
   };

   // บันทึกข้อความผู้ใช้
   conversations[currentSessionId].messages.push(userMessage);

   // ส่งข้อความผู้ใช้ผ่าน Socket.IO
   io.to(currentSessionId).emit('new_message', {
     ...userMessage,
     room: currentSessionId
   });

   // สร้างข้อมูลข้อความของบอท
   const botMessage = {
     sender: 'bot',
     text: result.fulfillmentText || 'ไม่เข้าใจคำถาม กรุณาลองใหม่อีกครั้ง',
     intent: detectedIntent,
     timestamp: Date.now()
   };

   // บันทึกข้อความบอท
   conversations[currentSessionId].messages.push(botMessage);

   // อัปเดตเวลากิจกรรมล่าสุด
   conversations[currentSessionId].lastActivity = Date.now();

    // แสดงข้อมูลดีบั๊กเพื่อช่วยในการพัฒนา
    console.log('Query:', query);
    console.log('Detected Intent:', detectedIntent);
    console.log('Confidence:', result.intentDetectionConfidence);

    // ส่งข้อความบอทผ่าน Socket.IO
    io.to(currentSessionId).emit('new_message', {
      ...botMessage,
      room: currentSessionId
    });

    // เก็บข้อมูลตาม intent ที่ตรวจพบ
   if (detectedIntent === 'provide_user_info') {
      // ถ้าเป็น intent ที่ผู้ใช้ให้ข้อมูลส่วนตัว
      // ตรวจสอบและดึงข้อมูลจากพารามิเตอร์ของ Dialogflow
      const parameters = result.parameters.fields;
      if (parameters) {
        if (parameters.name && parameters.name.stringValue) {
          sessionData[currentSessionId].userInfo.name = parameters.name.stringValue;
        }
        if (parameters.email && parameters.email.stringValue) {
          sessionData[currentSessionId].userInfo.email = parameters.email.stringValue;
        }
        if (parameters.phone && parameters.phone.stringValue) {
          sessionData[currentSessionId].userInfo.phone = parameters.phone.stringValue;
        }
      }
    } else if (detectedIntent === 'request_agent') {
      // ถ้าผู้ใช้ต้องการคุยกับเจ้าหน้าที่
      conversations[currentSessionId].status = 'waiting';
      // ส่งการแจ้งเตือนไปยังแอดมิน
      io.emit('user_request_agent', {
        sessionId: currentSessionId,
        timestamp: Date.now()
      });
      console.log('User requested to speak with an agent. Session ID:', currentSessionId);
    }

    // แสดงข้อมูลที่เก็บไว้ใน console
    console.log('Session Data:', sessionData[currentSessionId]);

    // สร้าง response กลับไปยัง Live Chat
    const responseData = {
      success: true,
      message: result.fulfillmentText || 'ไม่เข้าใจคำถาม กรุณาลองใหม่อีกครั้ง',
      intent: detectedIntent,
      confidence: result.intentDetectionConfidence,
      sessionId: currentSessionId,
      sessionData: sessionData[currentSessionId] // ส่งข้อมูล step ทั้งหมดกลับไปด้วย
    };

    // ตรวจสอบ custom payload และเพิ่มลงใน response
    if (result.fulfillmentMessages && result.fulfillmentMessages.length > 0) {
      for (const message of result.fulfillmentMessages) {
        // ตรวจสอบ payload fields ที่มาจาก Dialogflow
        if (message.payload) {
          const payload = struct.decode(message.payload);
          responseData.payload = payload;
          // เพิ่ม payload ลงในข้อความบอท
          botMessage.payload = payload;

          // ส่งข้อความบอทที่มี payload ผ่าน Socket.IO อีกครั้ง
          io.to(currentSessionId).emit('new_message', {
            ...botMessage,
            room: currentSessionId,
            payload: payload
          });

          break; // ใช้ payload แรกที่พบ
        }
      }
    }

    res.json(responseData);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({
      success: false,
      message: 'เกิดข้อผิดพลาดในการเชื่อมต่อกับ Dialogflow',
    });
  }
});

/**
 * API สำหรับส่งข้อความจากแอดมิน
 */
app.post('/api/admin/message', async (req, res) => {
  try {
    const { sessionId, message, adminId, adminName } = req.body;

    // ตรวจสอบว่ามี session นี้หรือไม่
    if (!sessionData[sessionId]) {
      return res.status(404).json({
        success: false,
        message: 'ไม่พบข้อมูล session'
      });
    }

    // ตรวจสอบว่ามีข้อมูลการสนทนาหรือไม่
    if (!conversations[sessionId]) {
      conversations[sessionId] = {
        messages: [],
        status: 'answered',
        lastActivity: Date.now(),
        agentId: adminId
      };
    }

    // สร้างข้อมูลข้อความ
    const messageData = {
      sender: 'admin',
      text: message,
      adminId,
      adminName,
      timestamp: Date.now()
    };

    // บันทึกข้อความจากแอดมินลงในประวัติการสนทนา
    conversations[sessionId].messages.push(messageData);

    // อัปเดตสถานะการสนทนา
    conversations[sessionId].status = 'answered';
    conversations[sessionId].lastActivity = Date.now();
    conversations[sessionId].agentId = adminId;

    // ส่งข้อความผ่าน Socket.IO
    io.to(sessionId).emit('new_message', {
      ...messageData,
      room: sessionId
    });

    // ส่งข้อมูลกลับไป
    res.json({
      success: true,
      message: 'ส่งข้อความสำเร็จ',
      conversation: {
        messages: conversations[sessionId].messages,
        status: conversations[sessionId].status
      }
    });
  } catch (error) {
    console.error('Error sending admin message:', error);
    res.status(500).json({
      success: false,
      message: 'เกิดข้อผิดพลาดในการส่งข้อความ'
    });
  }
});

/**
 * API สำหรับการดึงข้อมูล session
 */
app.get('/api/sessionData/:sessionId', (req, res) => {
  const { sessionId } = req.params;

  if (sessionData[sessionId]) {
    res.json({
      success: true,
      data: sessionData[sessionId]
    });
  } else {
    res.status(404).json({
      success: false,
      message: 'ไม่พบข้อมูล session'
    });
  }
});

/**
 * API สำหรับดึงประวัติการสนทนา
 */
app.get('/api/conversations/:sessionId', (req, res) => {
  const { sessionId } = req.params;

  if (conversations[sessionId]) {
    res.json({
      success: true,
      conversation: conversations[sessionId],
      sessionData: sessionData[sessionId] || {}
    });
  } else {
    res.status(404).json({
      success: false,
      message: 'ไม่พบข้อมูลการสนทนา'
    });
  }
});

/**
 * API สำหรับดึงรายการการสนทนาทั้งหมด
 */
app.get('/api/conversations', (req, res) => {
  const { status, limit = 50, skip = 0 } = req.query;

  try {
    // สร้างรายการการสนทนา
    const conversationList = Object.keys(conversations).map(sessionId => {
      const conversation = conversations[sessionId];
      const session = sessionData[sessionId] || {};

      // หาข้อความล่าสุด
      const lastMessage = conversation.messages && conversation.messages.length > 0
        ? conversation.messages[conversation.messages.length - 1]
        : null;

      return {
        sessionId,
        userInfo: session.userInfo || {},
        status: conversation.status,
        lastActivity: conversation.lastActivity,
        lastMessage: lastMessage ? {
          text: lastMessage.text,
          sender: lastMessage.sender,
          timestamp: lastMessage.timestamp
        } : null,
        messageCount: conversation.messages ? conversation.messages.length : 0
      };
    });

    // กรองตามสถานะ (ถ้ามีการระบุ)
    let filteredConversations = conversationList;
    if (status && status !== 'all') {
      filteredConversations = conversationList.filter(conv => conv.status === status);
    }

    // เรียงตามเวลากิจกรรมล่าสุด (ใหม่ -> เก่า)
    filteredConversations.sort((a, b) => b.lastActivity - a.lastActivity);

    // จำกัดจำนวนรายการตาม limit และ skip
    const paginatedConversations = filteredConversations.slice(
      parseInt(skip),
      parseInt(skip) + parseInt(limit)
    );

    res.json({
      success: true,
      total: filteredConversations.length,
      conversations: paginatedConversations
    });
  } catch (error) {
    console.error('Error fetching conversations:', error);
    res.status(500).json({
      success: false,
      message: 'เกิดข้อผิดพลาดในการดึงข้อมูลการสนทนา'
    });
  }
});

/**
 * API สำหรับอัปเดตสถานะการสนทนา
 */
app.patch('/api/conversations/:sessionId/status', (req, res) => {
  const { sessionId } = req.params;
  const { status, adminId } = req.body;

  if (!sessionData[sessionId]) {
    return res.status(404).json({
      success: false,
      message: 'ไม่พบข้อมูลการสนทนา'
    });
  }

  // ตรวจสอบว่ามีข้อมูลการสนทนาหรือไม่
  if (!conversations[sessionId]) {
    conversations[sessionId] = {
      messages: [],
      status: 'waiting',
      lastActivity: Date.now()
    };
  }

  // อัปเดตสถานะ
  conversations[sessionId].status = status;
  conversations[sessionId].lastActivity = Date.now();

  // อัปเดต adminId ถ้ามีการระบุ
  if (adminId) {
    conversations[sessionId].agentId = adminId;
  }

  // ส่งการแจ้งเตือนสถานะผ่าน Socket.IO
  io.to(sessionId).emit('status_update', {
    type: 'status_update',
    status: status,
    timestamp: Date.now(),
    room: sessionId
  });

  res.json({
    success: true,
    message: 'อัปเดตสถานะสำเร็จ',
    conversation: {
      sessionId,
      status: conversations[sessionId].status,
      lastActivity: conversations[sessionId].lastActivity,
      agentId: conversations[sessionId].agentId
    }
  });
});

/**
 * API สำหรับการลบข้อมูล session เมื่อจบการสนทนา
 */
app.delete('/api/sessionData/:sessionId', (req, res) => {
  const { sessionId } = req.params;

  if (sessionData[sessionId]) {
    // ลบข้อมูล session
    delete sessionData[sessionId];

    // ลบข้อมูลการสนทนา (ถ้ามี)
    if (conversations[sessionId]) {
      delete conversations[sessionId];
    }

    // ส่งการแจ้งเตือนการลบข้อมูลผ่าน Socket.IO
    io.to(sessionId).emit('session_deleted', {
      type: 'session_deleted',
      timestamp: Date.now(),
      room: sessionId
    });

    res.json({
      success: true,
      message: 'ลบข้อมูล session เรียบร้อยแล้ว'
    });
  } else {
    res.status(404).json({
      success: false,
      message: 'ไม่พบข้อมูล session'
    });
  }
});

/**
 * API สำหรับทดสอบการเชื่อมต่อ
 */
app.get('/api/test', (req, res) => {
  res.json({ message: 'Backend is running!' });
});

/**
 * API สำหรับทดสอบการเชื่อมต่อ Socket.IO
 */
app.get('/api/test/socket', (req, res) => {
  io.emit('test', { message: 'This is a test message', timestamp: Date.now() });
  res.json({ message: 'Socket.IO test message sent successfully!' });
});

/**
 * สร้าง static file server สำหรับไฟล์ HTML, CSS, JS
 */
app.use(express.static('public'));

/**
 * ตั้งค่า route สำหรับหน้า admin
 */
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin-dashboard.html'));
});

/**
 * เริ่มต้น server
 */
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server กำลังทำงานที่พอร์ต ${PORT}`);
});
