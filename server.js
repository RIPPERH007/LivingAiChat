/**
 * server.js - ระบบหลักรวม Live Chat และ Admin Dashboard
 * เชื่อมต่อระหว่าง Live Chat และ Dialogflow
 * รองรับการทำงานกับระบบแอดมินและใช้ Socket.IO สำหรับแชทแบบเรียลไทม์
 */
require('dotenv').config();

// นำเข้าโมดูลที่จำเป็น
const cors = require('cors');
const { SessionsClient } = require('@google-cloud/dialogflow');
const { struct } = require('pb-util');
const uuid = require('uuid');
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const path = require('path');
const http = require('http');
const socketIo = require('socket.io');

// นำเข้า webhook controller (ถ้ามี)
let webhookController;
try {
  webhookController = require('./controllers/webhookController');
} catch (error) {
  console.log('Webhook controller not found, creating dummy handler');
  webhookController = {
    handleWebhook: (req, res) => {
      console.log('Webhook Request Body:', JSON.stringify(req.body));
      res.json({ success: true });
    }
  };
}

// สร้าง Express app และ HTTP server
const app = express();
const server = http.createServer(app);

// ตั้งค่า Socket.IO
const io = socketIo(server, {
  cors: {
    origin: "*", // อนุญาตให้เข้าถึงจากทุกโดเมน
    methods: ["GET", "POST"],
    allowedHeaders: ["my-custom-header"],
    credentials: true
  }
});

// ตั้งค่า Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cors());
app.use(express.json());

// Webhook Route (ถ้ามี)
app.post('/webhook', webhookController.handleWebhook);

// ตั้งค่า static files
app.use(express.static('public'));

// ตั้งค่า Dialogflow
const sessionClient = new SessionsClient({
  keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
  projectId: process.env.DIALOGFLOW_PROJECT_ID,
});

// สร้างตัวแปรสำหรับเก็บข้อมูล session และการสนทนา
const sessionData = {};
const conversations = {};

// --------- Socket.IO Event Handlers ---------
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  // ทดสอบการเชื่อมต่อโดยส่งข้อความทดสอบไปยังไคลเอนต์ที่เพิ่งเชื่อมต่อ
  socket.emit('test', { message: 'Socket connection test from server', timestamp: Date.now() });

  // รับการสมัครห้องแชท (เมื่อผู้ใช้หรือแอดมินเข้าร่วมห้อง)
  socket.on('join', (roomId) => {
    console.log(`Client ${socket.id} joined room: ${roomId}`);
    socket.join(roomId);
    // แจ้งไคลเอนต์ว่าได้เข้าร่วมห้องแล้ว
    socket.emit('joined_room', { room: roomId, timestamp: Date.now() });
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

    // อัปเดตข้อมูลการสนทนาให้สอดคล้องกัน
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

    // เพิ่มการเช็คแบบชัดเจนเพื่อดีบั๊ก
    console.log('Data room:', data.room);
    console.log('Data sender:', data.sender);
    console.log('Admin active status:', sessionData[data.room]?.adminActive);

    // ตรวจสอบสถานะแอดมิน
    const isAdminActive = sessionData[data.room]?.adminActive === true ||
                          conversations[data.room]?.adminActive === true;

    console.log('Is admin active:', isAdminActive);

    if (data.sender === 'user') {
      // ถ้าเป็นข้อความจากผู้ใช้ ให้อัปเดตสถานะเป็น "ยังไม่ได้ตอบ"
      if (conversations[data.room]) {
        conversations[data.room].status = 'waiting';
        conversations[data.room].lastActivity = Date.now();
      }

      // ส่งข้อความจากผู้ใช้ไปยังแอดมินเท่านั้น (ไม่ส่งกลับไปหาผู้ใช้)
      socket.to(data.room).emit('new_message', data);

      // บันทึกข้อความลงในประวัติการสนทนา
      if (conversations[data.room]) {
        conversations[data.room].messages.push({
          sender: data.sender,
          text: data.text,
          timestamp: data.timestamp
        });
      }
    } else if (data.sender === 'bot') {
      // ส่งข้อความของบอทเสมอ ไม่ว่าแอดมินจะแอคทีฟหรือไม่
      console.log('Sending bot message to room:', data.room);
      socket.to(data.room).emit('new_message', data);

      // บันทึกข้อความบอทลงในประวัติการสนทนา
      if (conversations[data.room]) {
        conversations[data.room].messages.push({
          sender: data.sender,
          text: data.text,
          timestamp: data.timestamp,
          intent: data.intent,
          payload: data.payload
        });
      }
    } else if (data.sender === 'admin') {
      // ถ้าเป็นข้อความจากแอดมิน ให้อัปเดตสถานะเป็น "ตอบแล้ว"
      if (conversations[data.room]) {
        conversations[data.room].status = 'answered';
        conversations[data.room].lastActivity = Date.now();
      }

      // ส่งข้อความจากแอดมินไปหาผู้ใช้
      socket.to(data.room).emit('new_message', data);

      // บันทึกข้อความแอดมินลงในประวัติการสนทนา
      if (conversations[data.room]) {
        conversations[data.room].messages.push({
          sender: data.sender,
          text: data.text,
          timestamp: data.timestamp,
          adminId: data.adminId,
          adminName: data.adminName
        });
      }
    }

    // อัปเดตเวลากิจกรรมล่าสุด
    if (conversations[data.room]) {
      conversations[data.room].lastActivity = Date.now();
    }
  });

  // รับการอัปเดตสถานะ
  socket.on('status_update', (data) => {
    console.log('Status update received:', data);
    if (conversations[data.room]) {
      conversations[data.room].status = data.status;
      conversations[data.room].lastActivity = Date.now();
    }
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

// --------- API Routes ---------

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
        },
        currentStep: 1, // เพิ่มตัวแปรเก็บ step ปัจจุบัน
        propertySearch: {
          province: null,         // จังหวัด (step 1)
          facilities: null,       // สิ่งอำนวยความสะดวก (step 2)
          price: null,            // ราคา (step 3)
          transactionType: null,  // เช่า, ซื้อ, ขาย, เซ้ง (step 4)
          location: null,         // ทำเลที่ตั้ง (step 5)
          propertyType: null,     // ประเภทอสังหาริมทรัพย์ (step 6)
          isComplete: false,
          searchReady: false
        }
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

    // เพิ่ม queryParams เพื่อบังคับให้ตรงกับ step ปัจจุบัน
    // เฉพาะเมื่อไม่ใช่การค้นหาโดยตรง (ข้อความไม่ใช่ "ค้นหาอสังหาริมทรัพย์")
    if (!query.includes("ค้นหาอสังหาริมทรัพย์") && sessionData[currentSessionId].currentStep) {
      const currentStep = sessionData[currentSessionId].currentStep || 1;
      console.log(`Current Step for ${currentSessionId}: ${currentStep}`);

      // บังคับให้เรียกใช้ intent ตาม step ปัจจุบัน
      request.queryParams = {
        contexts: [
          {
            name: `${sessionPath}/contexts/force_step${currentStep}`,
            lifespanCount: 1
          }
        ]
      };
    }

    // ส่ง request ไปยัง Dialogflow
    const responses = await sessionClient.detectIntent(request);
    const result = responses[0].queryResult;
    const detectedIntent = result.intent ? result.intent.displayName : 'ไม่พบ intent';

    console.log(`Detected Intent: ${detectedIntent}`);

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

    // กำหนดค่าเริ่มต้นสำหรับข้อความบอท
    let botMessageText = 'ไม่เข้าใจคำถาม กรุณาลองใหม่อีกครั้ง'; // ค่าเริ่มต้น

    // ปรับลำดับความสำคัญในการเลือกข้อความ
    // 1. ใช้ข้อความจาก webhook ถ้ามี
    if (result.webhookUsed && result.fulfillmentMessages && result.fulfillmentMessages.length > 0) {
      // ดึงข้อความจาก webhook
      const webhookMessage = result.fulfillmentMessages.find(msg => msg.text && msg.text.text && msg.text.text.length > 0);

      if (webhookMessage) {
        botMessageText = webhookMessage.text.text[0];
        console.log('Using text from webhook message:', botMessageText);
      }
      // ถ้าไม่มีข้อความจาก webhook ให้ใช้ fulfillmentText
      else if (result.fulfillmentText && result.fulfillmentText.trim() !== '') {
        botMessageText = result.fulfillmentText;
        console.log('Using fulfillmentText because webhook message is empty:', botMessageText);
      }
    }
    // 2. ถ้าไม่ใช้ webhook ให้ใช้ fulfillmentText โดยตรง
    else if (result.fulfillmentText && result.fulfillmentText.trim() !== '') {
      botMessageText = result.fulfillmentText;
      console.log('Using fulfillmentText (no webhook):', botMessageText);
    }

    // สร้างข้อความบอทเพียงครั้งเดียว
    const botMessage = {
      sender: 'bot',
      text: botMessageText,
      intent: detectedIntent,
      timestamp: Date.now(),
      room: currentSessionId
    };

    // บันทึกข้อความ
    conversations[currentSessionId].messages.push(userMessage);
    conversations[currentSessionId].messages.push(botMessage);

    // อัปเดตเวลากิจกรรมล่าสุด
    conversations[currentSessionId].lastActivity = Date.now();

    // ส่งข้อความผู้ใช้ผ่าน Socket.IO
    io.to(currentSessionId).emit('new_message', userMessage);

    // เพิ่มบรรทัดนี้เพื่อส่งข้อความบอทไปยังผู้ใช้เสมอ
    io.to(currentSessionId).emit('new_message', botMessage);

    // ตรวจสอบ intent และเก็บข้อมูลตามขั้นตอน
    let shouldMoveToNextStep = false;

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
    } else if (detectedIntent === 'step1') {
      // เก็บข้อมูลจังหวัด
      const parameters = result.parameters.fields;
      if (parameters && parameters.province) {
        sessionData[currentSessionId].propertySearch.province = parameters.province.stringValue || null;
        console.log("Updated step1 - province:", sessionData[currentSessionId].propertySearch.province);
        shouldMoveToNextStep = true;
      } else {
        // ถ้าไม่มีพารามิเตอร์ province แต่ได้รับ intent step1 ให้เก็บข้อความผู้ใช้
        sessionData[currentSessionId].propertySearch.province = query;
        console.log("Updated step1 with raw query:", query);
        shouldMoveToNextStep = true;
      }
    } else if (detectedIntent === 'step2') {
      // เก็บข้อมูลสิ่งอำนวยความสะดวก
      const parameters = result.parameters.fields;
      if (parameters && parameters.facilities) {
        sessionData[currentSessionId].propertySearch.facilities = parameters.facilities.stringValue || null;
        console.log("Updated step2 - facilities:", sessionData[currentSessionId].propertySearch.facilities);
        shouldMoveToNextStep = true;
      } else {
        // ถ้าไม่มีพารามิเตอร์ facilities แต่ได้รับ intent step2 ให้เก็บข้อความผู้ใช้
        sessionData[currentSessionId].propertySearch.facilities = query;
        console.log("Updated step2 with raw query:", query);
        shouldMoveToNextStep = true;
      }
    } else if (detectedIntent === 'step3') {
      // เก็บข้อมูลราคา
      const parameters = result.parameters.fields;
      if (parameters && parameters.price) {
        sessionData[currentSessionId].propertySearch.price = parameters.price.stringValue || null;
        console.log("Updated step3 - price:", sessionData[currentSessionId].propertySearch.price);
        shouldMoveToNextStep = true;
      } else {
        // ถ้าไม่มีพารามิเตอร์ price แต่ได้รับ intent step3 ให้เก็บข้อความผู้ใช้
        sessionData[currentSessionId].propertySearch.price = query;
        console.log("Updated step3 with raw query:", query);
        shouldMoveToNextStep = true;
      }
    } else if (detectedIntent === 'step4') {
      // เก็บข้อมูลประเภทธุรกรรม
      const parameters = result.parameters.fields;
      if (parameters && parameters.transaction_type) {
        sessionData[currentSessionId].propertySearch.transactionType = parameters.transaction_type.stringValue || null;
        console.log("Updated step4 - transactionType:", sessionData[currentSessionId].propertySearch.transactionType);
        shouldMoveToNextStep = true;
      } else {
        // ถ้าไม่มีพารามิเตอร์ transaction_type แต่ได้รับ intent step4 ให้เก็บข้อความผู้ใช้
        sessionData[currentSessionId].propertySearch.transactionType = query;
        console.log("Updated step4 with raw query:", query);
        shouldMoveToNextStep = true;
      }
    } else if (detectedIntent === 'step5') {
      // เก็บข้อมูลทำเลที่ตั้ง
      const parameters = result.parameters.fields;
      if (parameters && parameters.location) {
        sessionData[currentSessionId].propertySearch.location = parameters.location.stringValue || null;
        console.log("Updated step5 - location:", sessionData[currentSessionId].propertySearch.location);
        shouldMoveToNextStep = true;
      } else {
        // ถ้าไม่มีพารามิเตอร์ location แต่ได้รับ intent step5 ให้เก็บข้อความผู้ใช้
        sessionData[currentSessionId].propertySearch.location = query;
        console.log("Updated step5 with raw query:", query);
        shouldMoveToNextStep = true;
      }
    } else if (detectedIntent === 'step6') {
      // เก็บข้อมูลประเภทอสังหาริมทรัพย์
      const parameters = result.parameters.fields;
      if (parameters && parameters.property_type) {
        sessionData[currentSessionId].propertySearch.propertyType = parameters.property_type.stringValue || null;
        console.log("Updated step6 - propertyType:", sessionData[currentSessionId].propertySearch.propertyType);
        shouldMoveToNextStep = true;
      } else {
        // ถ้าไม่มีพารามิเตอร์ property_type แต่ได้รับ intent step6 ให้เก็บข้อความผู้ใช้
        sessionData[currentSessionId].propertySearch.propertyType = query;
        console.log("Updated step6 with raw query:", query);
        shouldMoveToNextStep = true;
      }

      // ตั้งค่าว่าเสร็จสมบูรณ์เมื่อถึง step 6
      sessionData[currentSessionId].propertySearch.isComplete = true;
    } else if (query.includes("ค้นหาอสังหาริมทรัพย์") || detectedIntent === 'search_property') {
      // ถ้าผู้ใช้สั่งค้นหา ให้เรียก API และแสดงผลลัพธ์
      try {
        console.log("Searching for properties with current data:", sessionData[currentSessionId].propertySearch);
        const response = await axios.get('https://ownwebdev1.livinginsider.com/api/v1/test_order');

        if (response.data && response.data.data && response.data.data.length > 0) {
          // ปรับข้อมูลให้เป็นรูปแบบที่ต้องการแสดงผล
          const propertyData = response.data.data.map(item => ({
            id: item.web_id ? item.web_id.toString() : '',
            imageUrl: item.photo || '',
            title: item.name || 'ไม่ระบุชื่อ',
            location: item.zone || 'ไม่ระบุที่ตั้ง',
            price: item.price || '-',
            tag: item.tag || 'ขาย',
            link: item.link || '#',
            details: item.details || '',
            rooms: item.rooms || '',
            bathrooms: item.bathrooms || '',
            size: item.size || '',
            contactPhone: item.contact_phone || ''
          }));

          // สร้าง payload สำหรับแสดงผลการค้นหา
          const searchResultPayload = {
            richContent: [[
              {
                type: "info",
                title: "ผลการค้นหาอสังหาริมทรัพย์",
                subtitle: `พบทั้งหมด ${response.data.count || propertyData.length} รายการ`
              }
            ]]
          };

          // เพิ่มการ์ดอสังหาริมทรัพย์แต่ละรายการ
          propertyData.forEach(property => {
            // สร้าง custom card layout
            searchResultPayload.richContent[0].push({
              type: "info",
              title: `${property.tag} ${property.title}`,
              subtitle: `${property.location}\n฿${property.price}`,
              actionLink: property.link,
              image: {
                src: {
                  rawUrl: property.imageUrl
                }
              }
            });
          });

          // ส่ง payload กลับไปแสดงผล
          const searchResultMessage = {
            sender: 'bot',
            intent: 'search_results',
            timestamp: Date.now() + 1,
            room: currentSessionId,
            payload: searchResultPayload
          };

          io.to(currentSessionId).emit('new_message', searchResultMessage);

          // บันทึกข้อความการค้นหาลงในประวัติการสนทนา
          conversations[currentSessionId].messages.push({
            sender: 'bot',
            intent: 'search_results',
            timestamp: Date.now() + 1,
            payload: searchResultPayload
          });
        }
      } catch (error) {
        console.error("Error searching properties:", error);
      }
    }

    // อัปเดต step ปัจจุบันถ้าจำเป็น
    if (shouldMoveToNextStep && sessionData[currentSessionId].currentStep) {
      const currentStep = sessionData[currentSessionId].currentStep || 1;
      const nextStep = currentStep < 6 ? currentStep + 1 : 6;
      sessionData[currentSessionId].currentStep = nextStep;
      console.log(`Moving from step ${currentStep} to step ${nextStep} for ${currentSessionId}`);
    }

    // นับจำนวน step ที่มีข้อมูลแล้ว (สำหรับการค้นหาอสังหาฯ)
    if (sessionData[currentSessionId].propertySearch) {
      const search = sessionData[currentSessionId].propertySearch;
      let completedSteps = 0;
      if (search.province) completedSteps++;
      if (search.facilities) completedSteps++;
      if (search.price) completedSteps++;
      if (search.transactionType) completedSteps++;
      if (search.location) completedSteps++;
      if (search.propertyType) completedSteps++;

      console.log(`Completed steps for ${currentSessionId}: ${completedSteps}/6`);

      // ถ้าครบ 6 steps หรือมีข้อมูลเพียงพอ (อย่างน้อย 3 steps)
      if (completedSteps >= 3) {
        sessionData[currentSessionId].propertySearch.searchReady = true;
      }
    }

    // ตรวจสอบ custom payload
    let payloadSent = false;

    if (result.fulfillmentMessages && result.fulfillmentMessages.length > 0) {
      for (const message of result.fulfillmentMessages) {
        if (message.payload) {
          const payload = struct.decode(message.payload);

          // ส่ง payload เพียงครั้งเดียว
          const payloadMessage = {
            sender: 'bot',
            intent: detectedIntent,
            timestamp: Date.now() + 1, // +1 เพื่อให้ timestamp ไม่ซ้ำกับข้อความข้างต้น
            room: currentSessionId,
            payload: payload
          };

          console.log('Sending bot message with payload via Socket.IO');
          io.to(currentSessionId).emit('new_message', payloadMessage);
          payloadSent = true;

          // บันทึกข้อความพาโหลดลงในประวัติการสนทนา
          conversations[currentSessionId].messages.push({
            sender: 'bot',
            intent: detectedIntent,
            timestamp: Date.now() + 1,
            payload: payload
          });
        }
      }
    }

    // ถ้าไม่มี payload แต่มีข้อมูลพอที่จะค้นหาได้แล้ว (อย่างน้อย 3 steps) ให้สร้าง payload ใหม่แล้วใส่ chips ค้นหา
    // แสดง chips ตั้งแต่ step 4 เป็นต้นไป
    if (!payloadSent && sessionData[currentSessionId].currentStep && sessionData[currentSessionId].currentStep >= 4) {
      const completedSteps = Object.values(sessionData[currentSessionId].propertySearch)
        .filter(value => value !== null && value !== undefined && value !== false && value !== "").length;

      const searchChipsPayload = {
        richContent: [[
          {
            type: "info",
            title: "ข้อมูลการค้นหาของคุณ",
            subtitle: `มีข้อมูลการค้นหา ${completedSteps} รายการจากทั้งหมด 6 รายการ`
          },
          {
            type: "chips",
            options: [
              {
                text: "ค้นหาอสังหาริมทรัพย์"
              }
            ]
          }
        ]]
      };

      const searchChipsMessage = {
        sender: 'bot',
        intent: 'search_property',
        timestamp: Date.now() + 2,
        room: currentSessionId,
        payload: searchChipsPayload
      };

      console.log('Sending search chips message via Socket.IO');
      io.to(currentSessionId).emit('new_message', searchChipsMessage);

      // บันทึกข้อความ chips ค้นหาลงในประวัติการสนทนา
      conversations[currentSessionId].messages.push({
        sender: 'bot',
        intent: 'search_property',
        timestamp: Date.now() + 2,
        payload: searchChipsPayload
      });
    }

    // สร้าง response กลับไปยัง Live Chat
    const responseData = {
      success: true,
      message: botMessageText,
      intent: detectedIntent,
      confidence: result.intentDetectionConfidence,
      sessionId: currentSessionId,
      sessionData: sessionData[currentSessionId] // ส่งข้อมูล session กลับไปด้วยเพื่อใช้ตรวจสอบที่ฝั่งไคลเอนต์
    };

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
    const { sessionId, message, adminId, adminName, messageId } = req.body;

    // ตรวจสอบว่ามี session นี้หรือไม่
    if (!sessionData[sessionId]) {
      return res.status(404).json({
        success: false,
        message: 'ไม่พบข้อมูล session'
      });
    }

    // สร้างข้อมูลข้อความ
    const messageData = {
      sender: 'admin',
      text: message,
      adminId,
      adminName,
      timestamp: messageId || Date.now()
    };

    // ตั้งค่าสถานะแอดมินเป็นแอคทีฟถ้ายังไม่เคยตั้ง
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

      // ตรวจสอบและอัปเดตสถานะจากข้อความล่าสุด
      if (conversation.messages && conversation.messages.length > 0) {
        const lastMessage = conversation.messages[conversation.messages.length - 1];
        if (lastMessage.sender === 'user' || lastMessage.sender === 'bot') {
          conversation.status = 'waiting';
        } else if (lastMessage.sender === 'admin') {
          conversation.status = 'answered';
        }
      }

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
  const { status, adminId, adminActive } = req.body;

  if (!conversations[sessionId] && !sessionData[sessionId]) {
    return res.status(404).json({
      success: false,
      message: 'ไม่พบข้อมูลการสนทนา'
    });
  }

  // ตรวจสอบว่ามีข้อมูลการสนทนาหรือไม่
  if (!conversations[sessionId]) {
    conversations[sessionId] = {
      messages: [],
      status: status || 'waiting',
      lastActivity: Date.now()
    };
  } else {
    // อัปเดตสถานะ
    if (status) {
      conversations[sessionId].status = status;
    }
    conversations[sessionId].lastActivity = Date.now();
  }

  // อัปเดต adminId ถ้ามีการระบุ
  if (adminId) {
    conversations[sessionId].agentId = adminId;
  }

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

  // ส่งการแจ้งเตือนสถานะผ่าน Socket.IO
  if (status) {
    io.to(sessionId).emit('status_update', {
      type: 'status_update',
      status: status,
      timestamp: Date.now(),
      room: sessionId
    });
  }

  res.json({
    success: true,
    message: 'อัปเดตสถานะสำเร็จ',
    conversation: {
      sessionId,
      status: conversations[sessionId].status,
      lastActivity: conversations[sessionId].lastActivity,
      agentId: conversations[sessionId].agentId,
      adminActive: conversations[sessionId].adminActive
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
 * API สำหรับทดสอบส่งข้อความไปยังห้องเฉพาะ
 */
app.get('/api/test/room/:roomId', (req, res) => {
  const { roomId } = req.params;
  const testMessage = {
    sender: 'system',
    text: 'This is a test message to the room',
    timestamp: Date.now(),
    room: roomId
  };

  io.to(roomId).emit('new_message', testMessage);
  res.json({ success: true, message: `Test message sent to room ${roomId}` });
});

/**
 * API สำหรับค้นหาอสังหาริมทรัพย์
 */
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
 * API สำหรับอัปเดตข้อมูลการค้นหา
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
  if (!sessionData[sessionId].propertySearch) {
    sessionData[sessionId].propertySearch = {
      province: null,
      facilities: null,
      price: null,
      transactionType: null,
      location: null,
      propertyType: null,
      isComplete: false,
      searchReady: false
    };
  }

  sessionData[sessionId].propertySearch = {
    ...sessionData[sessionId].propertySearch,
    ...searchData
  };

  // ส่งการแจ้งเตือนการอัปเดตข้อมูลการค้นหาผ่าน Socket.IO
  io.to(sessionId).emit('new_property_search', {
    sessionId,
    searchData: sessionData[sessionId].propertySearch,
    timestamp: Date.now()
  });

  res.json({
    success: true,
    message: 'อัปเดตข้อมูลการค้นหาสำเร็จ',
    data: sessionData[sessionId].propertySearch
  });
});

/**
 * ตั้งค่า route สำหรับหน้า admin
 */
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/admin-dashboard.html'));
});

/**
 * เริ่มต้น server
 */
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server กำลังทำงานที่พอร์ต ${PORT}`);
});
