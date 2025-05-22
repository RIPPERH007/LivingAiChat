/**
 * server.js - เซิร์ฟเวอร์หลักสำหรับ Live Chat
 * จัดการ Socket.IO และ API endpoints
 */
const dotenv = require('dotenv');
dotenv.config()

// นำเข้าโมดูลที่จำเป็น
const cors = require('cors');
const { struct } = require('pb-util');
const uuid = require('uuid');
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const path = require('path');
const http = require('http');
// สร้าง Express app และ HTTP server
const app = express();
const server = http.createServer(app);

// ตั้งค่า Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cors());
app.use(express.json());

// ตั้งค่าเส้นทางสำหรับไฟล์ static
app.use(express.static('public'));

app.get('/admin-new', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/admin-new.html'));
});
// เริ่มเซิร์ฟเวอร์
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server กำลังทำงานที่พอร์ต ${PORT}`);
});

