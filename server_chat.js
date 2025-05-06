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

// รับการเปลี่ยนสถานะแอดมิน
  socket.on('admin_status_change', (data) => {
    console.log('Admin status change received:', data);

    const { room: sessionId, adminActive, adminId, adminName } = data;

    // ตรวจสอบความถูกต้องของข้อมูล
    if (!sessionId) {
      console.error('Invalid admin_status_change event: missing sessionId');
      return;
    }

    // อัปเดตข้อมูลการสนทนา
    if (conversations[sessionId]) {
      conversations[sessionId].adminActive = adminActive;
      conversations[sessionId].lastActivity = Date.now();

      // ถ้าแอดมินแอคทีฟ ให้อัปเดตสถานะเป็น answered
      if (adminActive) {
        conversations[sessionId].status = 'answered';
        conversations[sessionId].agentId = adminId;
      }
    }

    // อัปเดตข้อมูล session
    if (sessionData[sessionId]) {
      sessionData[sessionId].adminActive = adminActive;
    }

    // ส่งข้อมูลการเปลี่ยนสถานะไปยังทุกคนที่อยู่ในห้อง
    io.to(sessionId).emit('admin_status_change', data);
  });

  // รับเมื่อผู้ใช้ออกจากห้อง
  socket.on('leave', (roomId) => {
    console.log(`Client ${socket.id} left room: ${roomId}`);
    socket.leave(roomId);
  });

  // รับข้อความจากผู้ใช้หรือแอดมิน
  socket.on('new_message', (data) => {
      console.log('New message received via socket:', data);

      // เพิ่มการตรวจสอบว่าเป็นข้อความจากผู้ใช้หรือแอดมิน

        const isAdminActive = sessionData[data.room]?.adminActive === true ||
                              conversations[data.room]?.adminActive === true;
        if (isAdminActive === true) {

      if (data.sender === 'user' ) {
        // ส่งข้อความไปยังทุกคนที่อยู่ในห้องเดียวกัน (ยกเว้นผู้ส่ง)
        socket.to(data.room).emit('new_message', data);

        // บันทึกข้อความลงในประวัติการสนทนา
        if (conversations[data.room]) {
          conversations[data.room].messages.push({
            sender: data.sender,
            text: data.text,
            timestamp: data.timestamp,
            adminId: data.adminId,
            adminName: data.adminName
          });
          conversations[data.room].lastActivity = Date.now();
        }
      }

      // ไม่ส่งข้อความของบอทในกรณีที่แอดมินแอคทีฟ
      if (data.sender === 'bot') {
        // ตรวจสอบว่าแอดมินแอคทีฟหรือไม่

        // ส่งข้อความของบอทเฉพาะเมื่อแอดมินไม่แอคทีฟ
        if (!isAdminActive) {
          socket.to(data.room).emit('new_message', data);

          // บันทึกข้อความลงในประวัติการสนทนา
          if (conversations[data.room]) {
            conversations[data.room].messages.push({
              sender: data.sender,
              text: data.text,
              timestamp: data.timestamp,
              intent: data.intent
            });
            conversations[data.room].lastActivity = Date.now();
          }
        }
      }
      }
    });

  // รับการอัปเดตสถานะ
  socket.on('status_update', (data) => {
    console.log('Status update received:', data);
    socket.to(data.room).emit('status_update', data);
  });

  // รับการร้องขอค้นหาอสังหาริมทรัพย์
  socket.on('request_property_search', async (data) => {
    try {
      const { sessionId, searchData } = data;

      // เรียกใช้ API ค้นหา
      const response = await axios.get('https://ownwebdev1.livinginsider.com/api/v1/test_order');

      // ส่งผลลัพธ์กลับไปยังเฉพาะห้องที่ร้องขอ
      socket.to(sessionId).emit('property_search_results', {
        success: true,
        data: response.data
      });
    } catch (error) {
      console.error('Error processing property search:', error);
      socket.to(data.sessionId).emit('property_search_results', {
        success: false,
        message: 'เกิดข้อผิดพลาดในการค้นหา'
      });
    }
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
// ตรวจสอบว่ามีแอดมินแอคทีฟหรือไม่
    const isAdminActive = sessionData[currentSessionId]?.adminActive === true ||
                          conversations[currentSessionId]?.adminActive === true;

    // ถ้าแอดมินแอคทีฟ ให้ส่งข้อความแจ้งเตือนว่าแอดมินกำลังให้บริการ
    if (isAdminActive) {
          return res.json({
            success: true,
            message: 'แอดมินกำลังให้บริการคุณอยู่ กรุณารอสักครู่',
            sessionId: currentSessionId,
            adminActive: true
          });
        }
    // ตรวจสอบและสร้างข้อมูลสำหรับ session
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

    if (!sessionData[currentSessionId].propertySearch) {
      sessionData[currentSessionId].propertySearch = {
        province: null,         // จังหวัด (step 1)
        facilities: null,       // สิ่งอำนวยความสะดวก (step 2)
        price: null,            // ราคา (step 3)
        transactionType: null,  // เช่า, ซื้อ, ขาย, เซ้ง (step 4)
        location: null,         // ทำเลที่ตั้ง (step 5)
        propertyType: null      // ประเภทอสังหาริมทรัพย์ (step 6)
      };
    }

    // อัปเดตข้อมูลผู้ใช้
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
          languageCode: 'th-TH',
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
      timestamp: Date.now(),
      room: currentSessionId
    };

    // สร้างข้อมูลข้อความของบอท
    const botMessage = {
      sender: 'bot',
      text: result.fulfillmentText || 'ไม่เข้าใจคำถาม กรุณาลองใหม่อีกครั้ง',
      intent: detectedIntent,
      timestamp: Date.now(),
      room: currentSessionId
    };

    // บันทึกข้อความ
    conversations[currentSessionId].messages.push(userMessage);
    conversations[currentSessionId].messages.push(botMessage);

    // อัปเดตเวลากิจกรรมล่าสุด
    conversations[currentSessionId].lastActivity = Date.now();

    // ส่งข้อความทั้งหมดผ่าน Socket.IO
    io.to(currentSessionId).emit('new_message', userMessage);

    // เก็บข้อมูลตาม intent ที่ตรวจพบ
    if (detectedIntent === 'provide_user_info') {
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
      conversations[currentSessionId].status = 'waiting';
      io.emit('user_request_agent', {
        sessionId: currentSessionId,
        timestamp: Date.now()
      });
      console.log('User requested to speak with an agent. Session ID:', currentSessionId);
    }

    if (detectedIntent === 'step1') {
      // เก็บข้อมูลจังหวัด
      const parameters = result.parameters.fields;
      if (parameters && parameters.province) {
        sessionData[currentSessionId].propertySearch.province = parameters.province.stringValue || null;
      }
    } else if (detectedIntent === 'step2') {
      // เก็บข้อมูลสิ่งอำนวยความสะดวก
      const parameters = result.parameters.fields;
      if (parameters && parameters.facilities) {
        sessionData[currentSessionId].propertySearch.facilities = parameters.facilities.stringValue || null;
      }
    } else if (detectedIntent === 'step3') {
      // เก็บข้อมูลราคา
      const parameters = result.parameters.fields;
      if (parameters && parameters.price) {
        sessionData[currentSessionId].propertySearch.price = parameters.price.stringValue || null;
      }
    } else if (detectedIntent === 'step4') {
      // เก็บข้อมูลประเภทธุรกรรม
      const parameters = result.parameters.fields;
      if (parameters && parameters.transaction_type) {
        sessionData[currentSessionId].propertySearch.transactionType = parameters.transaction_type.stringValue || null;
      }
    } else if (detectedIntent === 'step5') {
      // เก็บข้อมูลทำเลที่ตั้ง
      const parameters = result.parameters.fields;
      if (parameters && parameters.location) {
        sessionData[currentSessionId].propertySearch.location = parameters.location.stringValue || null;
      }
    } else if (detectedIntent === 'step6') {
      // เก็บข้อมูลประเภทอสังหาริมทรัพย์
      const parameters = result.parameters.fields;
      if (parameters && parameters.property_type) {
        sessionData[currentSessionId].propertySearch.propertyType = parameters.property_type.stringValue || null;
      }

      // ถ้าครบทั้ง 6 steps แล้ว ให้เพิ่มสถานะการค้นหา
      const search = sessionData[currentSessionId].propertySearch;
      if (search.province && search.facilities && search.price &&
          search.transactionType && search.location && search.propertyType) {
        sessionData[currentSessionId].propertySearch.isComplete = true;

        // แจ้งเตือนแอดมินว่ามีการค้นหาใหม่
        io.emit('new_property_search', {
          sessionId: currentSessionId,
          searchData: sessionData[currentSessionId].propertySearch,
          timestamp: Date.now()
        });
      }
    }


    // สร้าง response กลับไปยัง Live Chat
    const responseData = {
      success: true,
      message: result.fulfillmentText || 'ไม่เข้าใจคำถาม กรุณาลองใหม่อีกครั้ง',
      intent: detectedIntent,
      confidence: result.intentDetectionConfidence,
      sessionId: currentSessionId,
      sessionData: sessionData[currentSessionId]
    };

    // ตรวจสอบ custom payload
    if (result.fulfillmentMessages && result.fulfillmentMessages.length > 0) {
      for (const message of result.fulfillmentMessages) {
        if (message.payload) {
          const payload = struct.decode(message.payload);
          responseData.payload = payload;

          // ส่ง payload ผ่าน Socket.IO
          io.to(currentSessionId).emit('new_message', {
            ...botMessage,
            payload: payload
          });

          break;
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
if (sessionData[sessionId] && !sessionData[sessionId].adminActive) {
      sessionData[sessionId].adminActive = true;

      // ส่งการแจ้งเตือนสถานะแอดมินผ่าน Socket.IO
      io.to(sessionId).emit('admin_status_change', {
        type: 'admin_status_change',
        adminActive: true,
        timestamp: Date.now(),
        room: sessionId,
        adminId,
        adminName
      });
    }

    if (conversations[sessionId]) {
      conversations[sessionId].adminActive = true;
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
      room: sessionId    ,
      type: messageData.sender // 'user', 'bot', หรือ 'admin'
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
// อัปเดตสถานะแอดมินถ้ามีการระบุ
  if (adminActive !== undefined) {
    if (sessionData[sessionId]) {
      sessionData[sessionId].adminActive = adminActive;
    }

    if (conversations[sessionId]) {
      conversations[sessionId].adminActive = adminActive;
    }

    // ส่งการแจ้งเตือนสถานะแอดมินผ่าน Socket.IO
    io.to(sessionId).emit('admin_status_change', {
      type: 'admin_status_change',
      adminActive: adminActive,
      timestamp: Date.now(),
      room: sessionId,
      adminId: adminId
    });
  }
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

app.post('/api/property/search', async (req, res) => {
  try {
    const { searchData } = req.body;

    // จำลองการเรียกใช้ API จริง
    const response = await axios.get('https://ownwebdev1.livinginsider.com/api/v1/test_order');

    // ส่งข้อมูลกลับไป
    res.json({
      success: true,
      data: response.data
    });
  } catch (error) {
    console.error('Error searching for properties:', error);
    res.status(500).json({
      success: false,
      message: 'เกิดข้อผิดพลาดในการค้นหาอสังหาริมทรัพย์'
    });
  }
});

/**
 * เพิ่ม API endpoint สำหรับการอัปเดตข้อมูลการค้นหา
 */
app.patch('/api/property/search/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  const { searchData } = req.body;

  if (!sessionData[sessionId]) {
    return res.status(404).json({
      success: false,
      message: 'ไม่พบข้อมูล session'
    });
  }

  // อัปเดตข้อมูลการค้นหา
  sessionData[sessionId].propertySearch = {
    ...sessionData[sessionId].propertySearch,
    ...searchData
  };

  res.json({
    success: true,
    message: 'อัปเดตข้อมูลการค้นหาสำเร็จ',
    data: sessionData[sessionId].propertySearch
  });
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
