/**
 * Node.js Backend Server
 * เชื่อมต่อระหว่าง Live Chat และ Dialogflow
 * รองรับการทำงานกับระบบแอดมินและใช้ PieSocket สำหรับแชทแบบเรียลไทม์
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

// ตั้งค่า PieSocket
const PIESOCKET_API_KEY = process.env.PIESOCKET_API_KEY || 'mOGIGJTyKOmsesgjpchKEECKLekVGmuCSwNv2wpl';
const PIESOCKET_CLUSTER_ID = process.env.PIESOCKET_CLUSTER_ID || 's8661.sgp1';
const PIESOCKET_API_ENDPOINT = `https://api.piesocket.com/v3/channel`;

// เพิ่ม PieSocket Config
const PIESOCKET_CONFIG = {
  clusterId: 's8661.sgp1',
  apiKey: 'mOGIGJTyKOmsesgjpchKEECKLekVGmuCSwNv2wpl',
    anonymous: true,  // เพิ่มออฟชันนี้
     allowedOrigins: ['*']
};
// สร้างตัวแปรสำหรับเก็บข้อมูลแต่ละขั้นตอน โดยใช้ sessionId เป็น key
const sessionData = {};

// สร้างตัวแปรสำหรับเก็บข้อมูลการสนทนา
const conversations = {};

/**
 * ฟังก์ชันสำหรับส่งข้อความผ่าน PieSocket
 * @param {string} channelId - ID ของช่องทาง (ใช้ sessionId)
 * @param {object} message - ข้อความที่ต้องการส่ง
 */

async function sendPieSocketMessage(channel, message) {
    try {
        const response = await axios.post(
            'https://api.piesocket.com/v1/pub',
            {
                channel: channel,
                message: JSON.stringify(message)
            },
            {
                headers: {
                    'Authorization': `Bearer ${process.env.PIESOCKET_API_KEY}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        console.log('PieSocket message sent successfully');
        return response.data;
    } catch (error) {
        console.error('PieSocket send error:', {
            message: error.message,
            response: error.response ? error.response.data : null,
            status: error.response ? error.response.status : null
        });
        throw error;
    }
}
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

   // ส่งข้อความผู้ใช้ผ่าน PieSocket เพื่อให้แอดมินเห็นทันที
   await sendPieSocketMessage(currentSessionId, userMessage);

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

    const lastMessage = conversations[currentSessionId].messages[conversations[currentSessionId].messages.length - 1];
    try {
      await sendPieSocketMessage(currentSessionId, {
        event: 'new_message',
        data: lastMessage
      });
    } catch (pieSocketError) {
      console.error('PieSocket notification error:', pieSocketError);
      // ไม่ต้อง return error กลับหากข้อผิดพลาดเกี่ยวกับ PieSocket
    }

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
      // ส่งการแจ้งเตือนไปยังแอดมิน (สามารถเพิ่มโค้ดส่งการแจ้งเตือนที่นี่)
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
          break; // ใช้ payload แรกที่พบ
        }
      }
    }

    // ส่งข้อความบอทผ่าน PieSocket อีกครั้งหลังจากเพิ่ม payload แล้ว
    await sendPieSocketMessage(currentSessionId, botMessage);

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
const lastAdminMessage = conversations[sessionId].messages[conversations[sessionId].messages.length - 1];
try {
  await sendPieSocketMessage(sessionId, {
    event: 'new_message',
    data: lastAdminMessage
  });
} catch (pieSocketError) {
  console.error('PieSocket notification error:', pieSocketError);
  // ไม่ต้อง return error กลับหากข้อผิดพลาดเกี่ยวกับ PieSocket
}
    // ส่งข้อความผ่าน PieSocket
    await sendPieSocketMessage(sessionId, messageData);

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

  // ส่งการแจ้งเตือนสถานะผ่าน PieSocket
  sendPieSocketMessage(sessionId, {
    type: 'status_update',
    status: status,
    timestamp: Date.now()
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

    // ส่งการแจ้งเตือนการลบข้อมูลผ่าน PieSocket
    sendPieSocketMessage(sessionId, {
      type: 'session_deleted',
      timestamp: Date.now()
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
 * API สำหรับทดสอบการเชื่อมต่อ PieSocket
 */
app.get('/api/test/piesocket', async (req, res) => {
  try {
    await sendPieSocketMessage('test-channel', {
      type: 'test',
      message: 'PieSocket test message',
      timestamp: Date.now()
    });
    res.json({ message: 'PieSocket test message sent successfully!' });
  } catch (error) {
    res.status(500).json({ error: 'PieSocket test failed', details: error.message });
  }
});

app.post('/api/test-piesocket', async (req, res) => {
  const { channel, message } = req.body;

  if (!channel || !message) {
    return res.status(400).json({
      success: false,
      message: 'Channel และ message จำเป็นต้องระบุ'
    });
  }

  try {
    const result = await sendPieSocketMessage(channel, {
      event: 'test_message',
      data: {
        text: message,
        timestamp: Date.now()
      }
    });

    res.json({
      success: true,
      message: 'ส่งข้อความทดสอบผ่าน PieSocket สำเร็จ',
      result
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'เกิดข้อผิดพลาดในการทดสอบ PieSocket',
      error: error.message
    });
  }
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
app.listen(PORT, () => {
  console.log(`Server กำลังทำงานที่พอร์ต ${PORT}`);
});
