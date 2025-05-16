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

  socket.on('join_all_rooms', () => {
    console.log(`Admin client ${socket.id} requested to join all rooms`);

    // ดึงรายการห้องทั้งหมด
    const allRooms = Object.keys(conversations);

    // เข้าร่วมทุกห้อง
    allRooms.forEach(roomId => {
      console.log(`Adding admin ${socket.id} to room ${roomId}`);
      socket.join(roomId);
    });

    // แจ้งแอดมินว่าได้เข้าร่วมทุกห้อง
    socket.emit('joined_all_rooms', {
      roomCount: allRooms.length,
      rooms: allRooms
    });
  });

  // รับการสมัครห้องแชท (เมื่อผู้ใช้หรือแอดมินเข้าร่วมห้อง)
  socket.on('join', (roomId) => {
    if (!roomId) {
      console.error('Invalid roomId in join request');
      return;
    }

    console.log(`Client ${socket.id} joined room: ${roomId}`);

    // เข้าร่วมห้อง
    socket.join(roomId);

    // แจ้งไคลเอนต์ว่าได้เข้าร่วมห้องแล้ว
    socket.emit('joined_room', { room: roomId, timestamp: Date.now() });

    // ตรวจสอบว่ามีข้อมูลการสนทนาหรือไม่
    if (conversations[roomId]) {
      // ส่งประวัติการสนทนาให้ผู้ที่เพิ่งเข้าร่วม
      socket.emit('conversation_history', {
        room: roomId,
        messages: conversations[roomId].messages || [],
        timestamp: Date.now()
      });
    } else {
      console.log(`No conversation found for room ${roomId}`);
    }
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

      // ส่งข้อความให้ทุกคนในห้อง (แทนที่ socket.to เพื่อให้แน่ใจว่าข้อความถูกส่งไปยังทุกคน)
      io.to(data.room).emit('new_message', data);

      // บันทึกข้อความลงในประวัติการสนทนา
      if (conversations[data.room]) {
        conversations[data.room].messages.push({
          sender: data.sender,
          text: data.text,
          timestamp: data.timestamp
        });
      }

      // ถ้าไม่มีแอดมินที่แอคทีฟและเป็นข้อความจากผู้ใช้ ให้ส่งไปยัง Dialogflow
      if (!isAdminActive) {
        // ส่งข้อความไปยัง Dialogflow หรือบอทของคุณ
        // ส่วนนี้ควรมีโค้ดสำหรับส่งข้อความไปยัง Dialogflow และรับการตอบกลับ
      }
    } else if (data.sender === 'bot') {
      // ส่งข้อความของบอทเสมอ ไม่ว่าแอดมินจะแอคทีฟหรือไม่
      console.log('Sending bot message to room:', data.room);
      io.to(data.room).emit('new_message', data);

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

      // ส่งข้อความจากแอดมินไปหาทุกคนในห้อง
      io.to(data.room).emit('new_message', data);

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

  // รับการอัปเดตสถานะแอดมิน - แก้ไขโค้ดส่วนนี้เพื่อให้แน่ใจว่าฝั่งแอดมินได้รับข้อความจากลูกค้า
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

      // บันทึกการเปลี่ยนสถานะแอดมินในประวัติการสนทนา
      conversations[sessionId].messages.push({
        sender: 'system',
        text: adminActive ?
              `${adminName || 'แอดมิน'} เข้ามาให้บริการในห้องแชทนี้` :
              `${adminName || 'แอดมิน'} ออกจากห้องแชทนี้`,
        timestamp: Date.now(),
        adminStatus: adminActive
      });
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

  // ตัวจัดการเมื่อตัดการเชื่อมต่อ
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

// --------- API Routes ---------

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
        currentStep: 1,
        propertySearch: {
          transaction_type: null, // Step 1: ประเภทธุรกรรม (เช่า/ซื้อ)
          building_type: null,    // Step 2: ประเภทอสังหาริมทรัพย์
          location: null,         // Step 3: ทำเลที่ตั้ง
          price: null,            // Step 4: ราคา (และค้นหาทันที)
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

    // ตั้ง context ตาม step ปัจจุบัน
    const currentStep = sessionData[currentSessionId].currentStep || 1;
    console.log(`[${new Date().toISOString()}] [Context] [${currentSessionId}] Current step: ${currentStep}`);


    // กำหนด context ตาม step ปัจจุบัน
    if (!query.includes("ค้นหาอสังหาริมทรัพย์")) {
      switch(currentStep) {
        case 1:
          // บังคับให้เรียกใช้ intent step1_transaction_type
          request.queryParams = {
            contexts: [
              {
                name: `${sessionPath}/contexts/force_step1_transaction_type`,
                lifespanCount: 1
              }
            ]
          };
          break;
        case 2:
          // บังคับให้เรียกใช้ intent step2_building_type
          request.queryParams = {
            contexts: [
              {
                name: `${sessionPath}/contexts/force_step2_building_type`,
                lifespanCount: 1
              }
            ]
          };
          break;
        case 3:
          // บังคับให้เรียกใช้ intent step3_location
          request.queryParams = {
            contexts: [
              {
                name: `${sessionPath}/contexts/force_step3_location`,
                lifespanCount: 1
              }
            ]
          };
          break;
        case 4:
          // บังคับให้เรียกใช้ intent step4_price
          request.queryParams = {
            contexts: [
              {
                name: `${sessionPath}/contexts/step4_price`,
                lifespanCount: 1
              }
            ]
          };
          break;
      }
    }


    console.log(`[${new Date().toISOString()}] [Dialogflow] [${currentSessionId}] Sending query: "${query}"`);
    const responses = await sessionClient.detectIntent(request);
    const result = responses[0].queryResult;
    const detectedIntent = result.intent ? result.intent.displayName : 'ไม่พบ intent';

    console.log(`[${new Date().toISOString()}] [Dialogflow] [${currentSessionId}] Detected Intent: ${detectedIntent}`);

    // ตรวจสอบว่ามีข้อมูลการสนทนาหรือไม่
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
    let botMessageText = result.fulfillmentText || 'ไม่เข้าใจคำถาม กรุณาลองใหม่อีกครั้ง';

    // สร้างข้อความบอท
    const botMessage = {
      sender: 'bot',
      text: botMessageText,
      intent: detectedIntent,
      timestamp: Date.now(),
      room: currentSessionId
    };

    // บันทึกข้อความลงในประวัติการสนทนา
    conversations[currentSessionId].messages.push(userMessage);
    conversations[currentSessionId].messages.push(botMessage);
    conversations[currentSessionId].lastActivity = Date.now();

    // ส่งข้อความผู้ใช้ผ่าน Socket.IO
    io.to(currentSessionId).emit('new_message', userMessage);

    // ตรวจสอบข้อความบอทก่อนส่ง
    if (botMessageText.trim() !== 'ไม่มีข้อคำถาม กรุณาลองใหม่อีกครั้ง' &&
        !isDuplicateMessage(botMessage, currentSessionId)) {
      // ส่งข้อความบอทไปยังผู้ใช้
      io.to(currentSessionId).emit('new_message', botMessage);
    }

    // ตรวจสอบและจัดการ intent
    let shouldMoveToNextStep = false;

    // Log สถานะการค้นหาก่อนอัพเดต
    if (sessionData[currentSessionId].propertySearch) {
      console.log(`[${new Date().toISOString()}] [PropertySearch] [${currentSessionId}] Before intent handling:`,
        JSON.stringify(sessionData[currentSessionId].propertySearch, null, 2));
    }

    // จัดการ intent ตาม steps
    // เพิ่ม intent debug logging
    console.log(`[${new Date().toISOString()}] [Intent Debug] [${currentSessionId}] Intent: ${detectedIntent}, Query: "${query}", Step: ${currentStep}`);

    // จัดการ intent ตาม steps
    if (detectedIntent === 'step1_transaction_type') {
      // Step 1: เก็บข้อมูลประเภทธุรกรรม
      const transactionType = getTransactionTypeFromQuery(query);
      console.log(`[${new Date().toISOString()}] [Step1] [${currentSessionId}] Transaction type: ${transactionType}`);

      // เพิ่มการตรวจสอบค่าว่าง
      if (transactionType && transactionType.trim() !== '') {
        sessionData[currentSessionId].propertySearch.transaction_type = transactionType;
        shouldMoveToNextStep = true;
      }
    }
    else if ( detectedIntent === 'step2_location') {
      // Step 2: เก็บข้อมูลประเภทอสังหาริมทรัพย์
      console.log(`[${new Date().toISOString()}] [Step2] [${currentSessionId}] Building type: ${query}`);

      // เพิ่มการตรวจสอบค่าว่าง
      if (query && query.trim() !== '') {
        sessionData[currentSessionId].propertySearch.building_type = query;
        shouldMoveToNextStep = true;
      }

      console.log(`[${new Date().toISOString()}] [PropertySearch] [${currentSessionId}] Updated building_type: ${query}`);
    }
    else if (detectedIntent === 'step3_price') {
      // Step 3: เก็บข้อมูลทำเลที่ตั้ง
      console.log(`[${new Date().toISOString()}] [Step3] [${currentSessionId}] Location: ${query}`);

      // เพิ่มการตรวจสอบค่าว่าง
      if (query && query.trim() !== '') {
        sessionData[currentSessionId].propertySearch.location = query;
        shouldMoveToNextStep = true;
      }
    }
    else if (detectedIntent === 'search_property') {
      // Step 4: เก็บข้อมูลราคาและค้นหาทันที
      console.log(`[${new Date().toISOString()}] [Step4] [${currentSessionId}] Price or search query: "${query}"`);

      // ตรวจสอบว่าเป็นคำสั่งค้นหาหรือไม่
      if (query.toLowerCase().includes('ค้นหา') ||
          query.toLowerCase().includes('search') ||
          query.toLowerCase().includes('หา')) {

        console.log(`[${new Date().toISOString()}] [Step4] [${currentSessionId}] Detected search command: "${query}"`);

        // ตรวจสอบว่ามีข้อมูลราคาอยู่แล้วหรือไม่
        if (!sessionData[currentSessionId].propertySearch.price) {
          // ถ้ายังไม่มีราคา ให้ตั้งเป็นค่าเริ่มต้น
          sessionData[currentSessionId].propertySearch.price = "1";
          console.log(`[${new Date().toISOString()}] [Step4] [${currentSessionId}] Using default price range: 1-5000000`);
        }

      } else {
        // ถ้าไม่ใช่คำสั่งค้นหา ให้เช็คว่าเป็นราคาที่ถูกต้องหรือไม่
        let validPrice = null;

        // ลองแยกราคาออกมาด้วย regex
        const priceMatch = query.match(/(\d[\d,]*(?:\.\d+)?)\s*(?:-|ถึง|to)?\s*(\d[\d,]*(?:\.\d+)?)?/i);

        if (priceMatch) {
          // ถ้าพบตัวเลขในข้อความ
          if (priceMatch[2]) {
            // กรณีมีช่วงราคา เช่น "1000000-2000000" หรือ "1,000,000 ถึง 2,000,000"
            const startPrice = priceMatch[1].replace(/,/g, '');
            const endPrice = priceMatch[2].replace(/,/g, '');
            validPrice = `${startPrice}-${endPrice}`;
          } else {
            // กรณีมีราคาเดียว
            validPrice = priceMatch[1].replace(/,/g, '');
          }

          console.log(`[${new Date().toISOString()}] [Step4] [${currentSessionId}] Extracted price: ${validPrice}`);
        } else {
          // ถ้าไม่พบตัวเลขในข้อความ ให้ใช้ค่าเริ่มต้น
          validPrice = "1";
          console.log(`[${new Date().toISOString()}] [Step4] [${currentSessionId}] No valid price in query, using default: 1-5000000`);
        }

        // บันทึกราคาที่ผ่านการตรวจสอบแล้ว
        sessionData[currentSessionId].propertySearch.price = validPrice;
      }

      // ตรวจสอบว่ามีข้อมูลทั้งหมดที่จำเป็นหรือไม่
      const search = sessionData[currentSessionId].propertySearch;
      const hasTransactionType = !!search.transaction_type;
      const hasBuildingType = !!search.building_type;
      const hasLocation = !!search.location;
      const hasPrice = !!search.price;

      console.log(`[${new Date().toISOString()}] [PropertySearch] [${currentSessionId}] Search data check:`,
        `Transaction type: ${hasTransactionType ? 'YES' : 'NO'},`,
        `Building type: ${hasBuildingType ? 'YES' : 'NO'},`,
        `Location: ${hasLocation ? 'YES' : 'NO'},`,
        `Price: ${hasPrice ? 'YES' : 'NO'}`);

      // ถ้ามีข้อมูลไม่เพียงพอ ให้ขอข้อมูลเพิ่มเติม
      if (!hasTransactionType || (!hasBuildingType && !hasLocation)) {
        console.log(`[${new Date().toISOString()}] [PropertySearch] [${currentSessionId}] Insufficient data for search`);

        // สร้างข้อความแจ้งเตือน
        const insufficientDataMessage = {
          sender: 'bot',
          text: 'ขออภัย ฉันต้องการข้อมูลเพิ่มเติมเพื่อค้นหาอสังหาริมทรัพย์ให้คุณค่ะ',
          intent: 'insufficient_data',
          timestamp: Date.now(),
          room: currentSessionId
        };

        // ส่งข้อความแจ้งเตือน
        io.to(currentSessionId).emit('new_message', insufficientDataMessage);

        // บันทึกข้อความแจ้งเตือนในประวัติการสนทนา
        if (conversations[currentSessionId]) {
          conversations[currentSessionId].messages.push({
            sender: 'bot',
            text: 'ขออภัย ฉันต้องการข้อมูลเพิ่มเติมเพื่อค้นหาอสังหาริมทรัพย์ให้คุณค่ะ',
            intent: 'insufficient_data',
            timestamp: Date.now()
          });
        }

        // ถามคำถามตามข้อมูลที่ยังขาด
        setTimeout(() => {
          if (!hasTransactionType) {
            // ถ้าไม่มีข้อมูลประเภทธุรกรรม (ซื้อ/เช่า)
            const askTransactionMessage = {
              sender: 'bot',
              text: 'คุณต้องการซื้อหรือเช่าอสังหาริมทรัพย์คะ?',
              intent: 'ask_transaction_type',
              timestamp: Date.now() + 100,
              room: currentSessionId
            };

            io.to(currentSessionId).emit('new_message', askTransactionMessage);

            // บันทึกข้อความถามประเภทธุรกรรมในประวัติการสนทนา
            if (conversations[currentSessionId]) {
              conversations[currentSessionId].messages.push({
                sender: 'bot',
                text: 'คุณต้องการซื้อหรือเช่าอสังหาริมทรัพย์คะ?',
                intent: 'ask_transaction_type',
                timestamp: Date.now() + 100
              });
            }
          } else if (!hasBuildingType && !hasLocation) {
            // ถ้าไม่มีทั้งข้อมูลประเภทอสังหาริมทรัพย์และทำเลที่ตั้ง
            // ให้ถามประเภทอสังหาริมทรัพย์ก่อน
            const askBuildingTypeMessage = {
              sender: 'bot',
              text: 'คุณสนใจอสังหาริมทรัพย์ประเภทไหนคะ?',
              intent: 'ask_building_type',
              timestamp: Date.now() + 100,
              room: currentSessionId
            };

            io.to(currentSessionId).emit('new_message', askBuildingTypeMessage);

            // บันทึกข้อความถามประเภทอสังหาริมทรัพย์ในประวัติการสนทนา
            if (conversations[currentSessionId]) {
              conversations[currentSessionId].messages.push({
                sender: 'bot',
                text: 'คุณสนใจอสังหาริมทรัพย์ประเภทไหนคะ?',
                intent: 'ask_building_type',
                timestamp: Date.now() + 100
              });
            }
          }
        }, 1000); // รอ 1 วินาทีก่อนถามคำถามเพิ่มเติม

        return; // ออกจากฟังก์ชันโดยไม่ทำการค้นหา
      }

      // ถ้ามีข้อมูลเพียงพอ ให้เริ่มค้นหา
      // ตั้งค่าให้ข้อมูลครบถ้วนและพร้อมค้นหา
      sessionData[currentSessionId].propertySearch.isComplete = true;
      sessionData[currentSessionId].propertySearch.searchReady = true;

      console.log(`[${new Date().toISOString()}] [PropertySearch] [${currentSessionId}] All steps complete - starting search immediately`);

      // สร้างข้อความแจ้งกำลังค้นหา
      const searchingMessage = {
        sender: 'bot',
        text: 'กำลังค้นหาอสังหาริมทรัพย์ตามเงื่อนไขของคุณ...',
        intent: 'searching',
        timestamp: Date.now() + 10,
        room: currentSessionId
      };

      // ส่งข้อความผ่าน Socket.IO เมื่อไม่มีข้อความซ้ำ
      if (!isDuplicateMessage(searchingMessage, currentSessionId)) {
        io.to(currentSessionId).emit('new_message', searchingMessage);

        // บันทึกข้อความเข้าประวัติการสนทนา
        if (conversations[currentSessionId]) {
          conversations[currentSessionId].messages.push({
            sender: 'bot',
            text: 'กำลังค้นหาอสังหาริมทรัพย์ตามเงื่อนไขของคุณ...',
            intent: 'searching',
            timestamp: Date.now() + 10
          });
        }
      }

      // ค้นหาหลังจากรอสักครู่ (เพื่อให้ข้อความ "กำลังค้นหา" แสดงก่อน)
      setTimeout(() => {
        searchPropertiesAndSendResponse(currentSessionId);
      }, 1000);
    }
    else if (detectedIntent === 'request_agent') {
      // ถ้าต้องการติดต่อแอดมิน
      console.log(`[${new Date().toISOString()}] [Request Agent] [${currentSessionId}] User requested to speak with an agent`);
      conversations[currentSessionId].status = 'waiting';

      // แจ้งแอดมินว่ามีผู้ใช้ต้องการติดต่อ
      io.emit('user_request_agent', {
        sessionId: currentSessionId,
        timestamp: Date.now(),
        userInfo: sessionData[currentSessionId].userInfo
      });
    }

     else if (detectedIntent === 're-search') {
       // ล้างข้อมูลการค้นหาทั้งหมดเพื่อเริ่มใหม่
       console.log(`[${new Date().toISOString()}] [Re-Search] [${currentSessionId}] Resetting all search data and starting over`);

       // รีเซ็ต current step กลับไปที่ขั้นตอนแรก
       sessionData[currentSessionId].currentStep = 1;

       // รีเซ็ตข้อมูลการค้นหาทั้งหมด
       sessionData[currentSessionId].propertySearch = {
         transaction_type: null, // Step 1: ประเภทธุรกรรม (เช่า/ซื้อ)
         building_type: null,    // Step 2: ประเภทอสังหาริมทรัพย์
         location: null,         // Step 3: ทำเลที่ตั้ง
         price: null,            // Step 4: ราคา
         isComplete: false,
         searchReady: false
       };

       // สร้างข้อความแจ้งเตือนว่าเริ่มค้นหาใหม่
       const resetSearchMessage = {
         sender: 'bot',
         text: 'ฉันได้ล้างข้อมูลการค้นหาเดิมแล้ว มาเริ่มค้นหาใหม่กันค่ะ คุณต้องการซื้อหรือเช่าอสังหาริมทรัพย์คะ?',
         intent: 're-search',
         timestamp: Date.now() + 10,
         room: currentSessionId
       };

       // ส่งข้อความแจ้งเตือนผ่าน Socket.IO
       io.to(currentSessionId).emit('new_message', resetSearchMessage);

       // บันทึกข้อความลงในประวัติการสนทนา
       if (conversations[currentSessionId]) {
         conversations[currentSessionId].messages.push({
           sender: 'bot',
           text: 'ฉันได้ล้างข้อมูลการค้นหาเดิมแล้ว มาเริ่มค้นหาใหม่กันค่ะ',
           intent: 're-search',
           timestamp: Date.now() + 10
         });
       }

       // เพิ่ม chips options สำหรับให้ผู้ใช้เลือกประเภทธุรกรรม
       const transactionOptionsPayload = {
         richContent: [
           [
             {
               type: "chips",
               options: [
                 { text: "ซื้อ" },
                 { text: "เช่า" }
               ]
             }
           ]
         ]
       };


       // บันทึกประวัติการรีเซ็ต
       console.log(`[${new Date().toISOString()}] [PropertySearch] [${currentSessionId}] Search data has been reset`);
       logCurrentSearchState(currentSessionId, 'After Reset');
     }

    // อัปเดต currentStep ถ้าจำเป็น
   // หา code นี้ในไฟล์ (บรรทัดประมาณ 615-620):
   if (shouldMoveToNextStep) {
     const oldStep = sessionData[currentSessionId].currentStep;
     const nextStep = oldStep < 4 ? oldStep + 1 : 4; // ไม่เกิน step 4

     // อัปเดต step ต่อไป
     if (nextStep !== oldStep) {
       sessionData[currentSessionId].currentStep = nextStep;
       console.log(`[${new Date().toISOString()}] [PropertySearch] [${currentSessionId}] Updated current step: ${oldStep} -> ${nextStep}`);

     }
   }

    // ตรวจสอบ custom payload จาก Dialogflow
    let payloadSent = false;

// แก้ไขส่วนการตรวจสอบ payload จาก Dialogflow
if (result.fulfillmentMessages && result.fulfillmentMessages.length > 0) {
  for (const message of result.fulfillmentMessages) {
    if (message.payload) {
      const payload = struct.decode(message.payload);

      // ส่ง payload เพียงครั้งเดียว
      const payloadMessage = {
        sender: 'bot',
        intent: detectedIntent,
        timestamp: Date.now() + 20, // +20 เพื่อให้ส่งหลังข้อความอื่น
        room: currentSessionId,
        payload: payload
      };

      // ตรวจสอบว่ามีข้อความซ้ำหรือไม่
      if (!isDuplicateMessage(payloadMessage, currentSessionId)) {
        console.log(`[${new Date().toISOString()}] [Dialogflow] [${currentSessionId}] Sending bot message with payload`);
        io.to(currentSessionId).emit('new_message', payloadMessage);
        payloadSent = true;

        // บันทึกข้อความพร้อม payload ลงในประวัติการสนทนา
        conversations[currentSessionId].messages.push({
          sender: 'bot',
          intent: detectedIntent,
          timestamp: Date.now() + 20,
          payload: payload
        });
      } else {
        console.log(`[${new Date().toISOString()}] [Dialogflow] [${currentSessionId}] Skip duplicate payload`);
      }
    }
  }
}

// เพิ่มโค้ดนี้เพื่อสร้าง payload ตัวเลือกทำเลโดยอัตโนมัติถ้าไม่ได้รับจาก Dialogflow
if (!payloadSent && sessionData[currentSessionId].currentStep === 3) {
  console.log(`[${new Date().toISOString()}] [Dialogflow] [${currentSessionId}] No payload from Dialogflow, adding auto location options`);

  // สร้าง payload ตัวเลือกทำเล
  const locationOptionsPayload = {
    richContent: [
      [
        {
          type: "chips",
          options: [
            { text: "ลาดพร้าว" },
            { text: "บางนา" },
            { text: "สุขุมวิท" },
            { text: "รามคำแหง" }
          ]
        }
      ]
    ]
  };

  // สร้างข้อความ payload
  const locationOptionsMessage = {
    sender: 'bot',
    intent: 'auto_location_options',
    timestamp: Date.now() + 30,
    room: currentSessionId,
    payload: locationOptionsPayload
  };

  // ส่ง payload ตัวเลือกทำเล
  if (!isDuplicateMessage(locationOptionsMessage, currentSessionId)) {
    io.to(currentSessionId).emit('new_message', locationOptionsMessage);

    // บันทึก payload ตัวเลือกทำเลในประวัติการสนทนา
    if (conversations[currentSessionId]) {
      conversations[currentSessionId].messages.push({
        sender: 'bot',
        intent: 'auto_location_options',
        timestamp: Date.now() + 30,
        payload: locationOptionsPayload
      });
    }
  }
}
    // ถ้ามีข้อมูลการค้นหาแต่ยังไม่ได้ส่ง payload chips ค้นหา ให้ส่ง chips ค้นหา
    if (!payloadSent && sessionData[currentSessionId].propertySearch) {
      const search = sessionData[currentSessionId].propertySearch;

      // ตรวจสอบว่ามีข้อมูลอย่างน้อย 2 ใน 3 แต่ยังไม่ครบ 3
      const completedSteps =
        (search.transaction_type ? 1 : 0) +
        (search.location ? 1 : 0) +
        (search.price ? 1 : 0);

      if (completedSteps >= 2 && completedSteps < 3) {
        // สร้าง payload chips สำหรับค้นหา
        const searchChipsPayload = {
          richContent: [[
            {
              type: "info",
              title: "ข้อมูลการค้นหา",
              subtitle: `มีข้อมูล ${completedSteps} รายการแล้ว คุณต้องการค้นหาเลยหรือเพิ่มข้อมูลอีก?`
            },
            {
              type: "chips",
              options: [
                {
                  text: "ค้นหาอสังหาริมทรัพย์เลย"
                },
                {
                  text: "เพิ่มข้อมูลอีก"
                }
              ]
            }
          ]]
        };

        const searchChipsMessage = {
          sender: 'bot',
          intent: 'search_chips',
          timestamp: Date.now() + 30, // +30 เพื่อให้ส่งหลังข้อความอื่น
          room: currentSessionId,
          payload: searchChipsPayload
        };

        console.log(`[${new Date().toISOString()}] [PropertySearch] [${currentSessionId}] Sending search chips`);
        io.to(currentSessionId).emit('new_message', searchChipsMessage);

        // บันทึกข้อความลงในประวัติการสนทนา
        conversations[currentSessionId].messages.push({
          sender: 'bot',
          intent: 'search_chips',
          timestamp: Date.now() + 30,
          payload: searchChipsPayload
        });
      }
    }

    // Log สถานะการค้นหาหลังจัดการ intent
    if (sessionData[currentSessionId].propertySearch) {
      console.log(`[${new Date().toISOString()}] [PropertySearch] [${currentSessionId}] After intent handling:`,
        JSON.stringify(sessionData[currentSessionId].propertySearch, null, 2));

      // นับจำนวน steps ที่มีข้อมูล
      const search = sessionData[currentSessionId].propertySearch;
      const completedSteps =
        (search.transaction_type ? 1 : 0) +
        (search.location ? 1 : 0) +
        (search.price ? 1 : 0);

      console.log(`[${new Date().toISOString()}] [PropertySearch] [${currentSessionId}] Completed steps: ${completedSteps}/3`);
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
    console.error(`[${new Date().toISOString()}] [API Error]`, error);
    res.status(500).json({
      success: false,
      message: 'เกิดข้อผิดพลาดในการเชื่อมต่อกับ Dialogflow',
      error: error.message
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

    // รวบรวมพารามิเตอร์การค้นหา
    let searchParams = {};

    if (searchData) {
      // แปลงข้อมูลเป็นพารามิเตอร์ API
      if (searchData.buildingType) {
        searchParams.buildingType = searchData.buildingType;
      }

      if (searchData.propertyType) {
        searchParams.post_type = mapPropertyType(searchData.propertyType);
      }

      if (searchData.transactionType) {
        searchParams.property_tag = mapTransactionType(searchData.transactionType);
      }

      if (searchData.price) {
        searchParams.price = searchData.price;
      }

      if (searchData.location) {
        searchParams.zone = searchData.location;
      }

      if (searchData.zoneId) {
        searchParams.zoneId = searchData.zoneId;
      }
    }

    console.log('Searching with params:', searchParams);

    // สร้าง URL สำหรับเรียก API
    let apiUrl = 'https://ownwebdev1.livinginsider.com/api/v1/test_order';

    // เพิ่มพารามิเตอร์ค้นหา
    const params = new URLSearchParams();
    Object.keys(searchParams).forEach(key => {
      if (searchParams[key]) {
        params.append(key, searchParams[key]);
      }
    });

    // ทำการเรียก API
    const response = await axios.get(`${apiUrl}`);
    const propertyData = response.data;

    // แปลงข้อมูลให้เหมาะกับการแสดงผล
    if (propertyData && propertyData.data && propertyData.data.length > 0) {
      const properties = propertyData.data.map(item => ({
        id: item.web_id ? item.web_id.toString() : '',
        imageUrl: item.photo || '',
        title: item.name || 'ไม่ระบุชื่อ',
        location: item.zone || 'ไม่ระบุที่ตั้ง',
        price: item.price ? formatPrice(item.price) : '-',
        tag: item.tag || 'ขาย',
        link: item.link || '#'
      }));

      // ส่งข้อมูลกลับไป
      res.json({
        success: true,
        data: {
          data: properties,
          count: propertyData.count || properties.length,
          more: propertyData.more || null
        }
      });
    } else {
      res.json({
        success: false,
        message: 'ไม่พบข้อมูลที่ตรงกับการค้นหา'
      });
    }
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
      buildingType: null,
      zoneId: null,
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

// เพิ่มฟังก์ชันนี้ใน server.js
async function addTrainingPhrase(projectId, intentId, phrase, language = 'th-TH') {
  try {
    // สร้าง clients
    const intentsClient = new IntentsClient({
      keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
    });

    // สร้าง path สำหรับ intent
    const intentPath = intentsClient.projectAgentIntentPath(projectId, intentId);

    // ดึง intent ปัจจุบัน
    const [intent] = await intentsClient.getIntent({ name: intentPath });

    // เพิ่ม training phrase
    const trainingPhrases = intent.trainingPhrases || [];
    const newPhrase = {
      parts: [{ text: phrase }],
      type: 'EXAMPLE'
    };

    trainingPhrases.push(newPhrase);
    intent.trainingPhrases = trainingPhrases;

    // อัปเดต intent
    const updateMask = {
      paths: ['training_phrases']
    };

    const request = {
      intent: intent,
      updateMask: updateMask
    };

    const [updatedIntent] = await intentsClient.updateIntent(request);
    console.log(`Training phrase "${phrase}" added to intent ${intentId}`);
    return updatedIntent;
  } catch (error) {
    console.error('Error adding training phrase:', error);
    throw error;
  }
}

// เพิ่มในส่วนของ API routes ใน server.js
app.post('/api/admin/add-training-phrase', async (req, res) => {
  try {
    const { phrase, intentId } = req.body;

    if (!phrase || !intentId) {
      return res.status(400).json({
        success: false,
        message: 'กรุณาระบุข้อความและ intent ID'
      });
    }

    const updatedIntent = await addTrainingPhrase(
      process.env.DIALOGFLOW_PROJECT_ID,
      intentId,
      phrase
    );

    res.json({
      success: true,
      message: 'เพิ่ม Training Phrase สำเร็จ',
      intent: updatedIntent
    });
  } catch (error) {
    console.error('Error adding training phrase:', error);
    res.status(500).json({
      success: false,
      message: 'เกิดข้อผิดพลาดในการเพิ่ม Training Phrase'
    });
  }
});
// เพิ่มใน server.js
app.get('/api/socket-test', (req, res) => {
  const testMessage = {
    sender: 'system',
    text: 'This is a test message from server',
    timestamp: Date.now()
  };

  // ส่งข้อความไปยังทุกการเชื่อมต่อ
  io.emit('new_message', testMessage);

  res.json({ success: true, message: 'Test message sent to all clients' });
});

app.get('/admin-new', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/admin-new.html'));
});
/**
 * เริ่มต้น server
 */
const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`Server กำลังทำงานที่พอร์ต ${PORT}`);
});
    async function searchPropertiesAndSendResponse(sessionId) {
   if (!sessionId || !sessionData[sessionId]) {
      console.error(`[${new Date().toISOString()}] [PropertySearch] [${sessionId}] Cannot search: Session data not found`);
      return;
    }

    try {
      // Log สถานะก่อนเริ่มค้นหา
      console.log(`[${new Date().toISOString()}] [PropertySearch] [${sessionId}] Starting property search...`);

      // ดึงข้อมูลการค้นหาจาก session
      const searchData = sessionData[sessionId].propertySearch;
      console.log(`[${new Date().toISOString()}] [PropertySearch] [${sessionId}] Search data:`,
        JSON.stringify(searchData, null, 2));

      // แปลงข้อมูลเป็นพารามิเตอร์สำหรับ API
      let searchParams = {};

      // แปลงข้อมูลการค้นหาเป็นพารามิเตอร์ API
      if (searchData.transaction_type) {
        // เปลี่ยนจาก transaction_type เป็น post_type
        searchParams.post_type = searchData.transaction_type;
        console.log(`[${new Date().toISOString()}] [PropertySearch] [${sessionId}] Using post_type: ${searchData.transaction_type}`);
      }

      if (searchData.building_type) {
        const mappedType = mapPropertyType(searchData.building_type);
        if (mappedType !== null) {
          // ใช้ค่า property_tag แทน post_type
          searchParams.property_tag = mappedType;
          console.log(`[${new Date().toISOString()}] [PropertySearch] [${sessionId}] Mapping building_type: "${searchData.building_type}" -> ${mappedType}`);
        }
      }

      if (searchData.location) {
        searchParams.keyword = searchData.location;
        console.log(`[${new Date().toISOString()}] [PropertySearch] [${sessionId}] Using location: ${searchData.location}`);
      }

      if (searchData.price) {
        // ตรวจสอบว่าราคาเป็นข้อความค้นหาหรือไม่
        if (searchData.price.includes('ค้นหา') ||
            searchData.price.includes('หา') ||
            searchData.price.includes('search')) {
          // ใช้ค่าราคาเริ่มต้น
          searchParams.price = "1"; // หรือค่าเริ่มต้นที่เหมาะสม
        } else {
          searchParams.price = searchData.price;
        }
        console.log(`[${new Date().toISOString()}] [PropertySearch] [${sessionId}] Using price: ${searchParams.price}`);
      }

      console.log(`[${new Date().toISOString()}] [PropertySearch] [${sessionId}] Final search parameters:`,
        JSON.stringify(searchParams, null, 2));

      // สร้าง URL สำหรับเรียก API
      const apiUrl = 'https://ownwebdev1.livinginsider.com/api/v1/chat/prop_listing';

      // สร้าง URL params
      const params = new URLSearchParams();
      Object.keys(searchParams).forEach(key => {
        if (searchParams[key]) {
          params.append(key, searchParams[key]);
        }
      });

      // เรียกใช้ API
      const fullUrl = `${apiUrl}?web_id=001&room_id=a0289c60-2ca5-46d5-897d-0b747f4a9d1c&price=0&post_type=1&zone_id=14`;
      console.log(`[${new Date().toISOString()}] [PropertySearch] [${sessionId}] Final API URL: ${fullUrl}`);

      // ส่งคำขอ API
      console.log(`[${new Date().toISOString()}] [PropertySearch] [${sessionId}] Calling API...`);

      // ใช้ axios.get พร้อม URL ที่สร้างขึ้น
      const response = await axios.get(fullUrl, {
        timeout: 10000,
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        }
      });

      console.log(`[${new Date().toISOString()}] [PropertySearch] [${sessionId}] API response status: ${response.status}`);
      const responseData = response.data;

      // ตรวจสอบว่ามีข้อมูลหรือไม่
      if (responseData && responseData.data && responseData.data.length > 0) {
        console.log(`[${new Date().toISOString()}] [PropertySearch] [${sessionId}] Found ${responseData.data.length} properties`);

        // แปลงข้อมูลจาก API ให้อยู่ในรูปแบบที่ต้องการแสดงผล
        const properties = responseData.data.map((item, index) => {
          return {
            id: item.web_id || `prop-${index}`,
            imageUrl: item.photo || 'assets/images/property-placeholder.jpg',
            title: item.name || 'ไม่ระบุชื่อ',
            location: item.zone_name || 'ไม่ระบุที่ตั้ง',
            price: item.price || '-',
            tag: item.tag || (searchData.transaction_type === 'เช่า' ? 'เช่า' : 'ขาย'),
            link: item.link || '#',
            building: item.building || '',
            project_name: item.project_name || 'ไม่ระบุ'
          };
        });

        // ต่อโค้ดเหมือนของเดิม...
        // สร้าง summary text ตามข้อมูลการค้นหา
        let summaryText = 'ผลการค้นหาอสังหาริมทรัพย์';
        if (searchData.transaction_type) {
          summaryText += ` สำหรับ${searchData.transaction_type}`;
        }
        if (searchData.building_type) {
          summaryText += ` ประเภท${searchData.building_type}`;
        }
        if (searchData.location) {
          summaryText += ` บริเวณ${searchData.location}`;
        }
        if (searchData.price) {
          summaryText += ` ในช่วงราคา${searchData.price}`;
        }

        // สร้าง property_list สำหรับแสดงผลใน rich content
        const propertyListItems = properties.slice(0, 5).map(property => ({
          type: "custom_card",
          property_data: property
        }));

        // สร้าง rich content
        const richContent = [
          [
            {
              type: "info",
              title: summaryText,
              subtitle: `พบทั้งหมด ${responseData.count || properties.length} รายการ`
            },
            ...propertyListItems
          ]
        ];

        // ส่งข้อความผ่าน Socket.IO
        const searchResultMessage = {
          sender: 'bot',
          intent: 'search_results',
          timestamp: Date.now(),
          room: sessionId,
          text: responseData.sms || `พบอสังหาริมทรัพย์ทั้งหมด ${properties.length} รายการ`,
          payload: {
            richContent: richContent
          }
        };

        console.log(`[${new Date().toISOString()}] [PropertySearch] [${sessionId}] Sending search results message`);
        io.to(sessionId).emit('new_message', searchResultMessage);

        // บันทึกข้อความในประวัติการสนทนา
        if (conversations[sessionId]) {
          conversations[sessionId].messages.push({
            sender: 'bot',
            intent: 'search_results',
            timestamp: Date.now(),
            text: responseData.sms || `พบอสังหาริมทรัพย์ทั้งหมด ${properties.length} รายการ`,
            payload: {
              richContent: richContent
            }
          });
        }

      // เพิ่มการส่งข้อความปุ่มเพิ่มเติมถ้ามี more link
      if (responseData.more && responseData.more.link) {
        const moreButtonPayload = {
          richContent: [
            [
              {
                type: "button",
                options: [
                  {
                    text: responseData.more.txt || "ดูเพิ่มเติม",
                    link: responseData.more.link
                  }
                ]
              }
            ]
          ]
        };

        // ส่ง more button เป็นข้อความแยก
        const moreButtonMessage = {
          sender: 'bot',
          intent: 'more_results',
          timestamp: Date.now() + 100, // บวก 100 เพื่อให้ส่งหลังข้อความแรก
          room: sessionId,
          text: "คุณสามารถดูข้อมูลเพิ่มเติมได้จากลิงก์นี้",
          payload: moreButtonPayload
        };

        // ส่งข้อมูลไปยังห้องแชท
        io.to(sessionId).emit('new_message', moreButtonMessage);

        // บันทึกข้อความในประวัติการสนทนา
        if (conversations[sessionId]) {
          conversations[sessionId].messages.push({
            sender: 'bot',
            intent: 'more_results',
            timestamp: Date.now() + 100,
            text: "คุณสามารถดูข้อมูลเพิ่มเติมได้จากลิงก์นี้",
            payload: moreButtonPayload
          });
        }
      }

      // ส่งข้อความถามความต้องการเพิ่มเติม
      setTimeout(() => {
        const askMorePayload = {
          richContent: [
            [
              {
                type: "chips",
                options: [
                  {
                    text: "ค้นหาเพิ่มเติม"
                  },
                  {
                    text: "ฉันต้องการข้อมูลเพิ่มเติม"
                  },
                  {
                    text: "ติดต่อเจ้าหน้าที่"
                  }
                ]
              }
            ]
          ]
        };

        const askMoreMessage = {
          sender: 'bot',
          intent: 'ask_more',
          timestamp: Date.now() + 200, // บวก 200 เพื่อให้ส่งหลังข้อความแรกและ more button
          room: sessionId,
          text: "คุณต้องการข้อมูลเพิ่มเติมหรือไม่?",
          payload: askMorePayload
        };

        // ส่งข้อมูลไปยังห้องแชท
        io.to(sessionId).emit('new_message', askMoreMessage);

        // บันทึกข้อความในประวัติการสนทนา
        if (conversations[sessionId]) {
          conversations[sessionId].messages.push({
            sender: 'bot',
            intent: 'ask_more',
            timestamp: Date.now() + 200,
            text: "คุณต้องการข้อมูลเพิ่มเติมหรือไม่?",
            payload: askMorePayload
          });
        }
      }, 1000); // รอ 1 วินาที

      console.log(`[${new Date().toISOString()}] [PropertySearch] [${sessionId}] Search completed successfully with ${properties.length} results`);
    } else {
      // กรณีไม่พบข้อมูล
      console.log(`[${new Date().toISOString()}] [PropertySearch] [${sessionId}] No properties found`);

      const noResultsPayload = {
        richContent: [
          [
            {
              type: "info",
              title: "ผลการค้นหาอสังหาริมทรัพย์",
              subtitle: "ไม่พบข้อมูลที่ตรงกับการค้นหาของคุณ"
            },
            {
              type: "chips",
              options: [
                {
                  text: "ค้นหาใหม่"
                },
                {
                  text: "ปรับเงื่อนไขการค้นหา"
                },
                {
                  text: "ติดต่อเจ้าหน้าที่"
                }
              ]
            }
          ]
        ]
      };

      const noResultsMessage = {
        sender: 'bot',
        intent: 'search_results',
        timestamp: Date.now(),
        room: sessionId,
        text: "ไม่พบข้อมูลที่ตรงกับการค้นหา",
        payload: noResultsPayload
      };

      // ส่งข้อมูลไปยังห้องแชท
      io.to(sessionId).emit('new_message', noResultsMessage);

      // บันทึกข้อความในประวัติการสนทนา
      if (conversations[sessionId]) {
        conversations[sessionId].messages.push({
          sender: 'bot',
          intent: 'search_results',
          timestamp: Date.now(),
          text: "ไม่พบข้อมูลที่ตรงกับการค้นหา",
          payload: noResultsPayload
        });
      }
    }
  } catch (error) {
    console.error(`[${new Date().toISOString()}] [PropertySearch] [${sessionId}] Error searching properties:`, error);

    // ใช้ข้อมูลตัวอย่างแทนในกรณีเกิดข้อผิดพลาด
    console.log(`[${new Date().toISOString()}] [PropertySearch] [${sessionId}] Using mock data instead`);

    const mockProperties = [
      {
        id: '12345',
        imageUrl: 'https://via.placeholder.com/300x200',
        title: 'คอนโดใจกลางเมือง',
        location: 'สุขุมวิท',
        price: '3,500,000',
        tag: searchData.transaction_type === 'เช่า' ? 'เช่า' : 'ขาย',
        link: '#'
      },
      {
        id: '67890',
        imageUrl: 'https://via.placeholder.com/300x200',
        title: 'บ้านเดี่ยว 3 ห้องนอน',
        location: 'รังสิต',
        price: '5,200,000',
        tag: searchData.transaction_type === 'เช่า' ? 'เช่า' : 'ขาย',
        link: '#'
      },
      {
        id: '24680',
        imageUrl: 'https://via.placeholder.com/300x200',
        title: 'ทาวน์โฮมใหม่',
        location: 'บางนา',
        price: '12,000',
        tag: searchData.transaction_type === 'เช่า' ? 'เช่า' : 'ขาย',
        link: '#'
      }
    ];

    // สร้าง summary text ตามข้อมูลการค้นหา
    let summaryText = 'ผลการค้นหาอสังหาริมทรัพย์';
    if (searchData.transaction_type) {
      summaryText += ` สำหรับ${searchData.transaction_type}`;
    }
    if (searchData.location) {
      summaryText += ` บริเวณ${searchData.location}`;
    }
    if (searchData.price) {
      summaryText += ` ในช่วงราคา${searchData.price}`;
    }

    // สร้าง property list items
    const propertyListItems = mockProperties.map(property => ({
      type: "custom_card",
      property_data: property
    }));

    // สร้าง rich content
    const richContent = [
      [
        {
          type: "info",
          title: `${summaryText} (ข้อมูลตัวอย่าง)`,
          subtitle: `พบทั้งหมด ${mockProperties.length} รายการ`
        },
        ...propertyListItems
      ]
    ];

    // ส่งข้อมูลผ่าน Socket.IO
    const searchResultMessage = {
      sender: 'bot',
      intent: 'search_results',
      timestamp: Date.now(),
      room: sessionId,
      text: `พบอสังหาริมทรัพย์ตัวอย่างทั้งหมด ${mockProperties.length} รายการ`,
      payload: {
        richContent: richContent
      }
    };

    // ส่งข้อมูลไปยังห้องแชท
    io.to(sessionId).emit('new_message', searchResultMessage);

    // บันทึกข้อความในประวัติการสนทนา
    if (conversations[sessionId]) {
      conversations[sessionId].messages.push({
        sender: 'bot',
        intent: 'search_results',
        timestamp: Date.now(),
        text: `พบอสังหาริมทรัพย์ตัวอย่างทั้งหมด ${mockProperties.length} รายการ`,
        payload: {
          richContent: richContent
        }
      });
    }

    // ส่งข้อความถามความต้องการเพิ่มเติม
    setTimeout(() => {
      const askMorePayload = {
        richContent: [
          [
            {
              type: "chips",
              options: [
                {
                  text: "ค้นหาเพิ่มเติม"
                },
                {
                  text: "ฉันต้องการข้อมูลเพิ่มเติม"
                },
                {
                  text: "ติดต่อเจ้าหน้าที่"
                }
              ]
            }
          ]
        ]
      };

      const askMoreMessage = {
        sender: 'bot',
        intent: 'ask_more',
        timestamp: Date.now() + 100,
        room: sessionId,
        text: "คุณต้องการข้อมูลเพิ่มเติมหรือไม่?",
        payload: askMorePayload
      };

      // ส่งข้อมูลไปยังห้องแชท
      io.to(sessionId).emit('new_message', askMoreMessage);

      // บันทึกข้อความในประวัติการสนทนา
      if (conversations[sessionId]) {
        conversations[sessionId].messages.push({
          sender: 'bot',
          intent: 'ask_more',
          timestamp: Date.now() + 100,
          text: "คุณต้องการข้อมูลเพิ่มเติมหรือไม่?",
          payload: askMorePayload
        });
      }
    }, 1000); // รอ 1 วินาที
  }
}

// ฟังก์ชันแปลงประเภทธุรกรรมเป็น proprety_tag
function mapTransactionType(transactionType) {
  if (!transactionType) return null;

  const type = typeof transactionType === 'string' ? transactionType.toLowerCase() : '';

  if (type.includes('ขาย') || type === 'sale' || type === 'buy') return 'ขาย';
  if (type.includes('เช่า') || type === 'rent') return 'เช่า';
  if (type.includes('เซ้ง')) return 'เซ้ง';

  return transactionType;
}
function getMockPropertyData() {
  return {
    success: true,
    data: {
      data: [
        {
          id: '12345',
          imageUrl: 'https://via.placeholder.com/300x200',
          title: 'คอนโดใจกลางเมือง',
          location: 'สุขุมวิท',
          price: '3,500,000',
          tag: 'ขาย',
          link: '#'
        },
        {
          id: '67890',
          imageUrl: 'https://via.placeholder.com/300x200',
          title: 'บ้านเดี่ยว 3 ห้องนอน',
          location: 'รังสิต',
          price: '5,200,000',
          tag: 'ขาย',
          link: '#'
        },
        {
          id: '24680',
          imageUrl: 'https://via.placeholder.com/300x200',
          title: 'ทาวน์โฮมใหม่',
          location: 'บางนา',
          price: '12,000',
          tag: 'เช่า',
          link: '#'
        },
        {
          id: '13579',
          imageUrl: 'https://via.placeholder.com/300x200',
          title: 'คอนโดวิวสวน',
          location: 'ลาดพร้าว',
          price: '15,000',
          tag: 'เช่า',
          link: '#'
        },
        {
          id: '86420',
          imageUrl: 'https://via.placeholder.com/300x200',
          title: 'ที่ดินเปล่า 100 ตร.วา',
          location: 'ปทุมธานี',
          price: '2,500,000',
          tag: 'ขาย',
          link: '#'
        }
      ],
      count: 5,
      more: {
        link: '#',
        txt: 'ดูอสังหาริมทรัพย์เพิ่มเติม'
      }
    }
  };
}

// ฟังก์ชันช่วยในการแปลงประเภทอสังหาริมทรัพย์
function mapPropertyType(propertyType) {
  console.log(`Mapping property type from: "${propertyType}"`);

  if (!propertyType) return null;

  if (typeof propertyType === 'number') {
    return propertyType;
  }

  const type = typeof propertyType === 'string' ? propertyType.toLowerCase() : '';

  if (type.includes('คอนโด') || type.includes('condo')) return 1;
  if (type.includes('บ้าน') || type.includes('บ้านเดี่ยว') || type.includes('house')) return 2;
  if (type.includes('ทาวน์เฮ้าส์') || type.includes('ทาวน์โฮม') || type.includes('townhouse') || type.includes('townhome')) return 3;
  if (type.includes('ที่ดิน') || type.includes('land')) return 4;
  if (type.includes('อพาร์ทเม้นท์') || type.includes('อพาร์ทเม้น') || type.includes('apartment')) return 5;

  // กรณีไม่พบประเภทที่ตรงกัน ให้ใช้ค่าเริ่มต้น (เช่น คอนโด)
  console.log(`Could not map property type: "${propertyType}", using default value 1`);
  return 1;
}

// ฟังก์ชันช่วยในการจัดรูปแบบราคา
function formatPrice(price) {
  if (!price) return '-';

  let numPrice;
  if (typeof price === 'string') {
    numPrice = parseFloat(price.replace(/[^\d.-]/g, ''));
  } else {
    numPrice = price;
  }

  if (isNaN(numPrice)) return price;

  return numPrice.toLocaleString('th-TH');
}

function logPropertySearchStep(sessionId, step, value, fullData = null) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [PropertySearch] [${sessionId}] [Step: ${step}] Value: ${value}`);

  // ถ้ามีการส่งข้อมูลทั้งหมดมา ให้แสดงสถานะของทุก step
  if (fullData) {
    console.log(`[${timestamp}] [PropertySearch] [${sessionId}] Current search data:`, JSON.stringify(fullData, null, 2));

    // นับจำนวน step ที่มีข้อมูลแล้ว
    const completedSteps = Object.entries(fullData)
      .filter(([key, value]) => {
        // ไม่นับ field ที่เป็น flag
        if (key === 'isComplete' || key === 'searchReady') return false;
        // นับเฉพาะ field ที่มีค่า
        return value !== null && value !== undefined && value !== '';
      }).length;

    console.log(`[${timestamp}] [PropertySearch] [${sessionId}] Completed steps: ${completedSteps}/3`);

    // แสดงสถานะความพร้อมในการค้นหา
    console.log(`[${timestamp}] [PropertySearch] [${sessionId}] Search ready: ${fullData.searchReady}`);
    console.log(`[${timestamp}] [PropertySearch] [${sessionId}] Data complete: ${fullData.isComplete}`);
  }
}

function updatePropertySearchStep(sessionId, step, value, stepName) {
  if (!sessionData[sessionId]) {
    console.error(`[PropertySearch] [${sessionId}] Session data not found`);
    return false;
  }

  if (!sessionData[sessionId].propertySearch) {
    console.error(`[PropertySearch] [${sessionId}] Property search data not found`);
    return false;
  }

  // บันทึกค่าเดิมเพื่อเปรียบเทียบ
  const oldValue = sessionData[sessionId].propertySearch[stepName];

  // อัปเดตค่า
  sessionData[sessionId].propertySearch[stepName] = value;

  // Log การอัปเดต
  logPropertySearchStep(
    sessionId,
    step,
    value,
    sessionData[sessionId].propertySearch
  );

  // แสดงการเปลี่ยนแปลง
  console.log(`[PropertySearch] [${sessionId}] [${step}] Updated ${stepName}: "${oldValue}" -> "${value}"`);

  return true;
}

function logCurrentSearchState(sessionId, context = '') {
  if (!sessionData[sessionId] || !sessionData[sessionId].propertySearch) {
    console.error(`[PropertySearch] Cannot log search state: No data for session ${sessionId}`);
    return;
  }

  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [PropertySearch] [${sessionId}] [${context}] Current search state:`);
  console.log(JSON.stringify(sessionData[sessionId].propertySearch, null, 2));

  // แสดงสถานะของแต่ละ step ว่ามีข้อมูลหรือไม่
  const search = sessionData[sessionId].propertySearch;
  console.log(`[${timestamp}] [PropertySearch] [${sessionId}] Step status:`);
  console.log(`  Step 1 (transaction_type): ${search.transaction_type ? 'YES' : 'NO'}`);
  console.log(`  Step 2 (location): ${search.location ? 'YES' : 'NO'}`);
  console.log(`  Step 3 (price): ${search.price ? 'YES' : 'NO'}`);
}

function getTransactionTypeFromQuery(query) {
  if (!query) return null;

  const lowerQuery = query.toLowerCase();

  if (lowerQuery.includes('เช่า') || lowerQuery.includes('rent')) {
    return 'เช่า';
  }

  if (lowerQuery.includes('ซื้อ') || lowerQuery.includes('buy')) {
    return 'ซื้อ';
  }

  if (lowerQuery.includes('ขาย') || lowerQuery.includes('sell') || lowerQuery.includes('sale')) {
    return 'ขาย';
  }

  if (lowerQuery.includes('เซ้ง')) {
    return 'เซ้ง';
  }

  // กรณีไม่พบคำที่ระบุประเภทธุรกรรมโดยตรง ให้คืนค่าข้อความเดิม
  return query;
}
function isDuplicateMessage(message, sessionId, timeWindow = 5000) {
  if (!conversations[sessionId] || !conversations[sessionId].messages) {
    return false;
  }

  // ตรวจสอบ 5 ข้อความล่าสุด
  const recentMessages = conversations[sessionId].messages
    .filter(msg => msg.sender === message.sender)
    .slice(-5);

  // เพิ่ม debug log
  console.log(`[${new Date().toISOString()}] [DuplicateCheck] Checking for duplicates of message:`,
    JSON.stringify({
      text: message.text,
      intent: message.intent,
      sender: message.sender,
      hasPayload: !!message.payload
    }));

  return recentMessages.some(msg => {
    // เช็คข้อความเหมือนกัน (สำหรับข้อความทั่วไป)
    const isSameText = message.text && msg.text === message.text;

    // เช็ค intent เหมือนกัน
    const isSameIntent = message.intent && msg.intent === message.intent;

    // เช็คเวลาห่างกันไม่เกิน timeWindow
    const isWithinTimeWindow = Math.abs(msg.timestamp - message.timestamp) < timeWindow;

    // เช็ค payload เหมือนกัน (ถ้ามี)
    const isSamePayload = message.payload && msg.payload &&
      JSON.stringify(message.payload) === JSON.stringify(msg.payload);

    // ข้อความจะถือว่าซ้ำก็ต่อเมื่อ
    // 1. มีข้อความเหมือนกัน หรือ
    // 2. มี intent เหมือนกันและมี payload เหมือนกัน
    // และอยู่ในช่วงเวลาที่กำหนด
    const isDuplicate = (isSameText || (isSameIntent && isSamePayload)) && isWithinTimeWindow;

    if (isDuplicate) {
      console.log(`[${new Date().toISOString()}] [DuplicateCheck] Found duplicate:`,
        JSON.stringify({
          text: msg.text,
          intent: msg.intent,
          sender: msg.sender,
          timestamp: msg.timestamp
        }));
    }

    return isDuplicate;
  });
}
