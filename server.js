/**
 * server.js - เซิร์ฟเวอร์หลักสำหรับ Live Chat
 * จัดการ Socket.IO และ API endpoints
 */
require('dotenv').config();

// นำเข้าโมดูลที่จำเป็น
const cors = require('cors');
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
