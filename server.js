/**
 * server.js - เซิร์ฟเวอร์หลักสำหรับ Live Chat
 * จัดการ Socket.IO และ API endpoints
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

// ตั้งค่าเส้นทางสำหรับไฟล์ static
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

  // รับการสมัครห้อง (join room)
  socket.on('join', (roomId) => {
    if (!roomId) {
      console.error('Invalid roomId in join request');
      return;
    }

    console.log(`Client ${socket.id} joined room: ${roomId}`);
    socket.join(roomId);
    socket.emit('joined_room', { room: roomId, timestamp: Date.now() });

    // ตรวจสอบและส่งประวัติการสนทนา
    if (conversations[roomId]) {
      socket.emit('conversation_history', {
        room: roomId,
        messages: conversations[roomId].messages || [],
        timestamp: Date.now()
      });
    }
  });

  // รับการสมัครห้องทั้งหมดสำหรับแอดมิน
  socket.on('join_all_rooms', () => {
    console.log(`Admin client ${socket.id} requested to join all rooms`);

    const allRooms = Object.keys(conversations);
    allRooms.forEach(roomId => {
      socket.join(roomId);
    });

    socket.emit('joined_all_rooms', {
      roomCount: allRooms.length,
      rooms: allRooms
    });
  });

  // รับข้อความใหม่
  socket.on('new_message', (data) => {
    console.log('New message received via socket:', data);

    // ตรวจสอบข้อมูลที่จำเป็น
    if (!data.room || !data.sender) {
      console.error('Missing required data in new_message event');
      return;
    }

    // สร้างหรืออัปเดตข้อมูลการสนทนา
    if (!conversations[data.room]) {
      conversations[data.room] = {
        messages: [],
        status: 'waiting',
        lastActivity: Date.now()
      };
    }

    // บันทึกข้อความใหม่
    conversations[data.room].messages.push({
      sender: data.sender,
      text: data.text,
      timestamp: data.timestamp || Date.now(),
      payload: data.payload,
      adminName: data.adminName
    });

    // อัปเดตสถานะการสนทนา
    if (data.sender === 'user') {
      conversations[data.room].status = 'waiting';
    } else if (data.sender === 'admin') {
      conversations[data.room].status = 'answered';
      conversations[data.room].agentId = data.adminId;
    }

    // อัปเดตเวลากิจกรรมล่าสุด
    conversations[data.room].lastActivity = Date.now();

    // ส่งข้อความไปยังทุกคนในห้อง
    io.to(data.room).emit('new_message', data);
  });

  // รับการเปลี่ยนสถานะแอดมิน
  socket.on('admin_status_change', (data) => {
    console.log('Admin status change received:', data);

    const { room: sessionId, adminActive, adminId, adminName } = data;
    if (!sessionId) {
      console.error('Invalid admin_status_change event: missing sessionId');
      return;
    }

    // อัปเดตข้อมูลสถานะแอดมิน
    if (conversations[sessionId]) {
      conversations[sessionId].adminActive = adminActive;
      conversations[sessionId].lastActivity = Date.now();

      if (adminActive) {
        conversations[sessionId].status = 'answered';
        conversations[sessionId].agentId = adminId;
      }

      // บันทึกการเปลี่ยนสถานะในประวัติการสนทนา
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

    // ส่งการเปลี่ยนสถานะไปยังทุกคนในห้อง
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

// API Dialogflow
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

    // เพิ่ม context ตาม step ปัจจุบัน
    const currentStep = sessionData[currentSessionId].currentStep || 1;
    console.log(`Current step: ${currentStep}`);

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

    console.log(`Sending query to Dialogflow: "${query}"`);
    const responses = await sessionClient.detectIntent(request);
    const result = responses[0].queryResult;
    const detectedIntent = result.intent ? result.intent.displayName : 'ไม่พบ intent';

    console.log(`Detected Intent: ${detectedIntent}`);

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

    // ส่งข้อความบอทไปยังผู้ใช้
    io.to(currentSessionId).emit('new_message', botMessage);

    // จัดการ intent ตาม steps
    let shouldMoveToNextStep = false;

//    // จัดการ intent ตาม steps และประมวลผลข้อมูลการค้นหา
//    if (detectedIntent === 'step1_transaction_type') {
//      // Step 1: เก็บข้อมูลประเภทธุรกรรม
//      const transactionType = getTransactionTypeFromQuery(query);
//      if (transactionType) {
//        sessionData[currentSessionId].propertySearch.transaction_type = transactionType;
//        shouldMoveToNextStep = true;
//      }
//    }
//    else if (detectedIntent === 'step2_location') {
//      // Step 2: เก็บข้อมูลประเภทอสังหาริมทรัพย์
//      if (query && query.trim() !== '') {
//        sessionData[currentSessionId].propertySearch.building_type = query;
//        shouldMoveToNextStep = true;
//      }
//    }
//    else if (detectedIntent === 'step3_price') {
//      // Step 3: เก็บข้อมูลทำเลที่ตั้ง
//      if (query && query.trim() !== '') {
//        sessionData[currentSessionId].propertySearch.location = query;
//        shouldMoveToNextStep = true;
//      }
//    }
//    else if (detectedIntent === 'search_property') {
//      // Step 4: ค้นหาอสังหาริมทรัพย์
//      sessionData[currentSessionId].propertySearch.isComplete = true;
//      sessionData[currentSessionId].propertySearch.searchReady = true;
//
//      // ส่งคำขอค้นหาอสังหาริมทรัพย์ไปยัง API ภายนอก
//      searchPropertiesAndSendResponse(currentSessionId);
//    }
//    else if (detectedIntent === 're-search') {
//      // รีเซ็ตข้อมูลการค้นหา
//      sessionData[currentSessionId].currentStep = 1;
//      sessionData[currentSessionId].propertySearch = {
//        transaction_type: null,
//        building_type: null,
//        location: null,
//        price: null,
//        isComplete: false,
//        searchReady: false
//      };
//    }
//
//    // อัปเดต currentStep ถ้าจำเป็น
//    if (shouldMoveToNextStep) {
//      const oldStep = sessionData[currentSessionId].currentStep;
//      const nextStep = oldStep < 4 ? oldStep + 1 : 4; // ไม่เกิน step 4
//
//      if (nextStep !== oldStep) {
//        sessionData[currentSessionId].currentStep = nextStep;
//      }
//    }

    // ตรวจสอบ custom payload จาก Dialogflow
    if (result.fulfillmentMessages && result.fulfillmentMessages.length > 0) {
      for (const message of result.fulfillmentMessages) {
        if (message.payload) {
          const payload = struct.decode(message.payload);

          // ส่ง payload ผ่าน Socket.IO
          const payloadMessage = {
            sender: 'bot',
            intent: detectedIntent,
            timestamp: Date.now() + 20,
            room: currentSessionId,
            payload: payload
          };

          io.to(currentSessionId).emit('new_message', payloadMessage);

          // บันทึกข้อความพร้อม payload ลงในประวัติการสนทนา
          conversations[currentSessionId].messages.push({
            sender: 'bot',
            intent: detectedIntent,
            timestamp: Date.now() + 20,
            payload: payload
          });
        }
      }
    }

    // สร้าง response กลับไปยัง client
    const responseData = {
      success: true,
      message: botMessageText,
      intent: detectedIntent,
      confidence: result.intentDetectionConfidence,
      sessionId: currentSessionId,
      sessionData: sessionData[currentSessionId]
    };

    res.json(responseData);
  } catch (error) {
    console.error('API Error:', error);
    res.status(500).json({
      success: false,
      message: 'เกิดข้อผิดพลาดในการเชื่อมต่อกับ Dialogflow',
      error: error.message
    });
  }
});

// API สำหรับค้นหาอสังหาริมทรัพย์
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
    }

    console.log('Searching with params:', searchParams);

    // ทำการเรียก API ภายนอก
    try {
      let apiUrl = 'https://ownwebdev1.livinginsider.com/api/v1/test_order';
      const params = new URLSearchParams();
      Object.keys(searchParams).forEach(key => {
        if (searchParams[key]) {
          params.append(key, searchParams[key]);
        }
      });

      const response = await axios.get(`${apiUrl}?${params.toString()}`);
      const propertyData = response.data;

      // ส่งข้อมูลกลับไป
      res.json({
        success: true,
        data: propertyData
      });
    } catch (error) {
      // กรณีมีข้อผิดพลาดจาก API ภายนอก ให้ส่งข้อมูลตัวอย่างกลับไปแทน
      console.error('Error calling external API:', error);
      res.json({
        success: true,
        data: getMockPropertyData()
      });
    }
  } catch (error) {
    console.error('Error searching properties:', error);
    res.status(500).json({
      success: false,
      message: 'เกิดข้อผิดพลาดในการค้นหาอสังหาริมทรัพย์'
    });
  }
});

app.get('/admin-new', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/admin-new.html'));
});
// เริ่มเซิร์ฟเวอร์
const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`Server กำลังทำงานที่พอร์ต ${PORT}`);
});


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
