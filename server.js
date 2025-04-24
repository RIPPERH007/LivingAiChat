/**
 * Node.js Backend Server
 * เชื่อมต่อระหว่าง Live Chat และ Dialogflow
 * รองรับการทำงานกับระบบแอดมิน
 */
require('dotenv').config();

const cors = require('cors');
const { SessionsClient } = require('@google-cloud/dialogflow');
const { struct } = require('pb-util');
const uuid = require('uuid');
const express = require('express');
const bodyParser = require('body-parser');
const webhookController = require('./controllers/webhookController');

const app = express();

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

/**
 * API สำหรับส่งข้อความไปยัง Dialogflow
 */
app.post('/api/dialogflow', async (req, res) => {
  try {
    const { query, sessionId, userInfo } = req.body;
    const currentSessionId = sessionId || uuid.v4();

    // ตรวจสอบและสร้างข้อมูลสำหรับ session นี้ถ้ายังไม่มี
    if (!sessionData[currentSessionId]) {
      // สร้างข้อมูล session ใหม่
      sessionData[currentSessionId] = {
        step1: null,
        step2: null,
        step3: null,
        step4: null,
        currentStep: null,
        userInfo: {
          name: null,
          email: null,
          phone: null,
          timestamp: Date.now()
        }
      };

      // สร้างข้อมูลการสนทนาใหม่
      conversations[currentSessionId] = {
        messages: [],
        status: 'waiting', // waiting, answered, closed
        lastActivity: Date.now(),
        agentId: null // ID ของแอดมินที่กำลังตอบ (ถ้ามี)
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
    conversations[currentSessionId].messages.push({
      sender: 'user',
      text: query,
      timestamp: Date.now()
    });

    conversations[currentSessionId].messages.push({
      sender: 'bot',
      text: result.fulfillmentText || 'ไม่เข้าใจคำถาม กรุณาลองใหม่อีกครั้ง',
      intent: detectedIntent,
      confidence: result.intentDetectionConfidence,
      timestamp: Date.now()
    });

    // อัปเดตเวลากิจกรรมล่าสุด
    conversations[currentSessionId].lastActivity = Date.now();

    // แสดงข้อมูลดีบั๊กเพื่อช่วยในการพัฒนา
    console.log('Query:', query);
    console.log('Detected Intent:', detectedIntent);
    console.log('Confidence:', result.intentDetectionConfidence);

    // เก็บข้อมูลตาม intent ที่ตรวจพบ
    if (detectedIntent === 'step1') {
      sessionData[currentSessionId].step1 = query;
      sessionData[currentSessionId].currentStep = 'step1';
    } else if (detectedIntent === 'step2') {
      sessionData[currentSessionId].step2 = query;
      sessionData[currentSessionId].currentStep = 'step2';
    } else if (detectedIntent === 'step3') {
      sessionData[currentSessionId].step3 = query;
      sessionData[currentSessionId].currentStep = 'step3';
    } else if (detectedIntent === 'step4') {
      sessionData[currentSessionId].step4 = query;
      sessionData[currentSessionId].currentStep = 'step4';
    } else if (detectedIntent === 'provide_user_info') {
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
      // ส่งการแจ้งเตือนไปยังแอดมิน (สามารถเพิ่มโค้ดส่งการแจ้งเตือนที่นี่)
    } else if (detectedIntent === 'step5') {
      const nullSteps = [];
      if (sessionData[currentSessionId].step1 === null) nullSteps.push('step1');
      if (sessionData[currentSessionId].step2 === null) nullSteps.push('step2');
      if (sessionData[currentSessionId].step3 === null) nullSteps.push('step3');
      if (sessionData[currentSessionId].step4 === null) nullSteps.push('step4');

      // ถ้ามีขั้นตอนที่เป็น null
      if (nullSteps.length > 0) {
        let firstNullStep = nullSteps[0]; // ขั้นตอนแรกที่เป็น null
        let stepToShow;

        // หาขั้นตอนก่อนหน้าของขั้นตอนที่เป็น null
        if (firstNullStep === 'step1') {
          // step1 เป็น null และเป็นขั้นตอนแรก ให้แสดง step1 เลย
          stepToShow = 'step1';
        } else if (firstNullStep === 'step2') {
          // หากขั้นตอนที่เป็น null คือ step2 ให้แสดง step1
          stepToShow = 'step2';
        } else if (firstNullStep === 'step3') {
          // หากขั้นตอนที่เป็น null คือ step3 ให้แสดง step2
          stepToShow = 'step3';
        } else if (firstNullStep === 'step4') {
          // หากขั้นตอนที่เป็น null คือ step4 ให้แสดง step3
          stepToShow = 'step4';
        }

        // นำเข้าฟังก์ชัน createStep จาก webhookController
        const { createWelcome, createStep1, createStep2, createStep3, createStep4 } = require('./controllers/webhookController');

        let responseData = {
          success: true,
          sessionId: currentSessionId,
          sessionData: sessionData[currentSessionId]
        };

        // เลือกฟังก์ชันตามขั้นตอนที่ต้องการแสดง
        if (stepToShow === 'step1') {
          const propertyResponse = createWelcome();
          responseData.message = "คุณยังไม่ได้เลือก ว่าต้องการซื้อหรือขาย";
          responseData.payload = propertyResponse.fulfillmentMessages[1]?.payload;
          responseData.intent = 'welcome';
        } else if (stepToShow === 'step2') {
          const propertyResponse = createStep1();
          responseData.message = "กรุณาเลือกประเภทการขาย";
          responseData.payload = propertyResponse.fulfillmentMessages[1]?.payload;
          responseData.intent = 'step1';
        } else if (stepToShow === 'step3') {
          const propertyResponse = createStep2();
          responseData.message = propertyResponse.fulfillmentMessages[0]?.text?.text[0] || "กรุณาเลือกประเภทอสังหาริมทรัพย์";
          responseData.payload = propertyResponse.fulfillmentMessages[1]?.payload;
          responseData.intent = 'step2';
        } else if (stepToShow === 'step4') {
          const propertyResponse = createStep3();
          responseData.message = propertyResponse.fulfillmentMessages[0]?.text?.text[0] || "กรุณาเลือกทำเลที่ตั้ง";
          responseData.payload = propertyResponse.fulfillmentMessages[1]?.payload;
          responseData.intent = 'step3';
        }

        res.json(responseData);
        return;
      }
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
    if (!sessionData[sessionId] || !conversations[sessionId]) {
      return res.status(404).json({
        success: false,
        message: 'ไม่พบข้อมูล session'
      });
    }

    // บันทึกข้อความจากแอดมินลงในประวัติการสนทนา
    conversations[sessionId].messages.push({
      sender: 'admin',
      text: message,
      adminId,
      adminName,
      timestamp: Date.now()
    });

    // อัปเดตสถานะการสนทนา
    conversations[sessionId].status = 'answered';
    conversations[sessionId].lastActivity = Date.now();
    conversations[sessionId].agentId = adminId;

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
      const lastMessage = conversation.messages.length > 0
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
        messageCount: conversation.messages.length
      };
    });

    // กรองตามสถานะ (ถ้ามีการระบุ)
    let filteredConversations = conversationList;
    if (status) {
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

  if (!conversations[sessionId]) {
    return res.status(404).json({
      success: false,
      message: 'ไม่พบข้อมูลการสนทนา'
    });
  }

  // อัปเดตสถานะ
  conversations[sessionId].status = status;
  conversations[sessionId].lastActivity = Date.now();

  // อัปเดต adminId ถ้ามีการระบุ
  if (adminId) {
    conversations[sessionId].agentId = adminId;
  }

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
 * สร้าง static file server สำหรับไฟล์ HTML, CSS, JS
 */
app.use(express.static('public'));

/**
 * Admin Dashboard Route
 */
app.get('/admin', (req, res) => {
  res.sendFile(__dirname + '/admin-dashboard.html');
});

/**
 * เริ่มต้น server
 */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server กำลังทำงานที่พอร์ต ${PORT}`);
});
