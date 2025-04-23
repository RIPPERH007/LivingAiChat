/**
 * Node.js Backend Server
 * เชื่อมต่อระหว่าง Live Chat และ Dialogflow
 */
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

// Webhook Route
app.post('/webhook', webhookController.handleWebhook);

// Middleware
app.use(cors());
app.use(express.json());

// ตั้งค่า Dialogflow
const sessionClient = new SessionsClient({
  keyFilename: './dialogflow-credentials.json', // ไฟล์ credentials ของ Dialogflow
  projectId: 'my-project-test-dialog-flow', // Project ID ของคุณใน Dialogflow
});

// สร้างตัวแปรสำหรับเก็บข้อมูลแต่ละขั้นตอน โดยใช้ sessionId เป็น key
const sessionData = {};

app.post('/api/dialogflow', async (req, res) => {
  try {
    const { query, sessionId } = req.body;
    const currentSessionId = sessionId || uuid.v4();

    // ตรวจสอบและสร้างข้อมูลสำหรับ session นี้ถ้ายังไม่มี
    if (!sessionData[currentSessionId]) {
      sessionData[currentSessionId] = {
        step1: null,
        step2: null,
        step3: null,
        step4: null,
        currentStep: null
      };
    }

    // ตรวจสอบก่อนว่าข้อมูลทุก step ครบหรือไม่
    // const isAllDataComplete = 
    //   sessionData[currentSessionId].step1 !== null && 
    //   sessionData[currentSessionId].step2 !== null && 
    //   sessionData[currentSessionId].step3 !== null && 
    //   sessionData[currentSessionId].step4 !== null;

    // // ถ้าข้อมูลครบแล้ว ให้แสดง createStep4() เลย
    // if (isAllDataComplete) {
    //   const { createStep4 } = require('./controllers/webhookController');
      
    //   const propertyResponse = createStep4();
    //   const responseData = {
    //     success: true,
    //     message: propertyResponse.fulfillmentMessages[0]?.text?.text[0] || "กรุณาเลือกตัวเลือกที่ต้องการ",
    //     payload: propertyResponse.fulfillmentMessages[1]?.payload,
    //     intent: 'step4',
    //     sessionId: currentSessionId,
    //     sessionData: sessionData[currentSessionId]
    //   };
      
    //   res.json(responseData);
    //   return;
    // }

    // สร้าง session path
    const sessionPath = sessionClient.projectAgentSessionPath(
      'my-project-test-dialog-flow', // Project ID ของคุณใน Dialogflow
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

    // แสดงข้อมูลดีบั๊กเพื่อช่วยในการพัฒนา
    console.log('AAA Query:', query);
    console.log('AAA Detected Intent:', detectedIntent);
    console.log('AAA Confidence:', result.intentDetectionConfidence);

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
    } else 
    if (detectedIntent === 'step5') {  
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
        const { createWelcome ,createStep1, createStep2, createStep3, createStep4 } = require('./controllers/webhookController');
        
        let responseData = {
          success: true,
          sessionId: currentSessionId,
          sessionData: sessionData[currentSessionId]
        };
        
        // เลือกฟังก์ชันตามขั้นตอนที่ต้องการแสดง (ขั้นตอนก่อนหน้าของขั้นตอนที่เป็น null)
        if (stepToShow === 'step1') {
          const propertyResponse = createWelcome();
          responseData.message = "คุณยังไม่ได้เลือก ว่าต้องการซื้อหรือขาย";
          responseData.payload = propertyResponse.fulfillmentMessages[1]?.payload;
          responseData.intent = 'welcome';
        } else 
        if (stepToShow === 'step2') {
          const propertyResponse = createStep1();
          responseData.message =  "กรุณาเลือกประเภทการขาย";
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

    // ตรวจสอบอีกครั้งหลังจากบันทึกข้อมูลว่าข้อมูลครบหรือไม่
    // const isAllDataCompleteAfterUpdate = 
    //   sessionData[currentSessionId].step1 !== null && 
    //   sessionData[currentSessionId].step2 !== null && 
    //   sessionData[currentSessionId].step3 !== null && 
    //   sessionData[currentSessionId].step4 !== null;

    // // ถ้าข้อมูลครบแล้ว ให้แสดง createStep4() เลย
    // if (isAllDataCompleteAfterUpdate) {
    //   const { createStep4 } = require('./controllers/webhookController');
      
    //   const propertyResponse = createStep4();
    //   const responseData = {
    //     success: true,
    //     message: propertyResponse.fulfillmentMessages[0]?.text?.text[0] || "กรุณาเลือกตัวเลือกที่ต้องการ",
    //     payload: propertyResponse.fulfillmentMessages[1]?.payload,
    //     intent: 'step4',
    //     sessionId: currentSessionId,
    //     sessionData: sessionData[currentSessionId]
    //   };
      
    //   res.json(responseData);
    //   return;
    // }

    // แสดงข้อมูลที่เก็บไว้ใน console
    console.log('AAA Session Data:', sessionData[currentSessionId]);

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
          //console.log('Found custom payload:', JSON.stringify(payload));
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

// เพิ่ม endpoint สำหรับการดึงข้อมูล session
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

// เพิ่ม endpoint สำหรับการลบข้อมูล session เมื่อจบการสนทนา
app.delete('/api/sessionData/:sessionId', (req, res) => {
  const { sessionId } = req.params;

  if (sessionData[sessionId]) {
    delete sessionData[sessionId];
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

// เพิ่ม endpoint สำหรับทดสอบการเชื่อมต่อ
app.get('/api/test', (req, res) => {
  res.json({ message: 'Backend is running!' });
});

// สร้าง static file server สำหรับไฟล์ HTML, CSS, JS
app.use(express.static('public'));

// เริ่มต้น server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server กำลังทำงานที่พอร์ต ${PORT}`);
});