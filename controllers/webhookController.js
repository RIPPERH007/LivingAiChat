const axios = require('axios');

exports.handleWebhook = async (req, res) => {
  console.log('Webhook Request Body:', JSON.stringify(req.body));

  // แยกข้อมูลจาก request body
  const { responseId, queryResult, session } = req.body;

  // แสดงข้อมูลดีบั๊ก
  console.log('Request Body:', JSON.stringify(req.body));
  console.log('Detected Intent:', queryResult.intent.displayName);
  console.log('Parameters:', JSON.stringify(queryResult.parameters));
  console.log('Query:', queryResult.queryText);
  console.log('Confidence:', queryResult.intentDetectionConfidence);

  // ตรวจสอบว่ามีข้อมูลครบตามเงื่อนไขหรือไม่
  let searchParams = {};
  let shouldSearch = false;

  // ตรวจสอบพารามิเตอร์จาก queryResult
  if (queryResult.parameters) {
    console.log('Raw Parameters:', queryResult.parameters);

    // ถ้ามี fields ให้ดึงข้อมูลจาก fields
    if (queryResult.parameters.fields) {
      // ประเภทอสังหาริมทรัพย์ (property_type)
      if (queryResult.parameters.fields.property_type) {
        const propertyTypeValue = queryResult.parameters.fields.property_type.stringValue;
        console.log('Property Type Value from fields:', propertyTypeValue);
        searchParams.post_type = mapPropertyType(propertyTypeValue);
      }

      // ประเภทธุรกรรม (transaction_type) - เช่า/ขาย
      if (queryResult.parameters.fields.transaction_type) {
        searchParams.proprety_tag = mapTransactionType(queryResult.parameters.fields.transaction_type.stringValue);
      }

      // ราคา (price)
      if (queryResult.parameters.fields.price) {
        searchParams.price = parsePrice(queryResult.parameters.fields.price.stringValue);
      }

      // โซน/ทำเล (location/province)
      if (queryResult.parameters.fields.location || queryResult.parameters.fields.province) {
        searchParams.zone_id = mapLocationToZoneId(
          queryResult.parameters.fields.location?.stringValue ||
          queryResult.parameters.fields.province?.stringValue
        );
      }

      // โครงการ (project)
      if (queryResult.parameters.fields.project) {
        searchParams.project_id = mapProjectToId(queryResult.parameters.fields.project.stringValue);
      }
    }
    // ถ้าไม่มี fields แต่มีพารามิเตอร์โดยตรง
    else {
      // ตรวจสอบ property_type เป็นพิเศษ
      if (queryResult.parameters.property_type) {
        console.log('Property Type Value from direct parameters:', queryResult.parameters.property_type);
        searchParams.post_type = mapPropertyType(queryResult.parameters.property_type);
      }

      if (queryResult.parameters.transaction_type) {
        searchParams.proprety_tag = mapTransactionType(queryResult.parameters.transaction_type);
      }

      if (queryResult.parameters.price) {
        searchParams.price = parsePrice(queryResult.parameters.price);
      }

      if (queryResult.parameters.location || queryResult.parameters.province) {
        searchParams.zone_id = mapLocationToZoneId(queryResult.parameters.location || queryResult.parameters.province);
      }

      if (queryResult.parameters.project) {
        searchParams.project_id = mapProjectToId(queryResult.parameters.project);
      }
    }
  }

  // ตรวจสอบพารามิเตอร์ใน intent 'step6' โดยเฉพาะ
  if (queryResult.intent && queryResult.intent.displayName === 'step6') {
    // ดึงข้อความที่ผู้ใช้พิมพ์
    const userText = queryResult.queryText;
    console.log('Step6 - User text:', userText);

    // กรณี intent step6 ให้วิเคราะห์ข้อความที่ผู้ใช้พิมพ์เพื่อหา property_type
    const detectedPropertyType = detectPropertyTypeFromText(userText);
    if (detectedPropertyType) {
      console.log('Detected property type from text:', detectedPropertyType);
      searchParams.post_type = detectedPropertyType;
    }
  }

  console.log('Final Search Parameters:', searchParams);

  // ตรวจสอบว่ามีพารามิเตอร์อย่างน้อย 2 ตัวหรือไม่
  const paramCount = Object.keys(searchParams).length;
  shouldSearch = paramCount >= 2; // ปรับตามความเหมาะสม

  // ถ้ามีข้อมูลครบตามเงื่อนไข ให้ค้นหาข้อมูลจาก API
  if (shouldSearch) {
    try {
      // สร้าง URL สำหรับเรียก API
      let apiUrl = 'https://ownwebdev1.livinginsider.com/api/v1/test_order';

      // เพิ่มพารามิเตอร์ต่างๆ
      const params = new URLSearchParams();
      Object.keys(searchParams).forEach(key => {
        if (searchParams[key]) {
          params.append(key, searchParams[key]);
        }
      });

      console.log('Searching with params:', params.toString());

      // ทำการเรียก API
      const response = await axios.get(`${apiUrl}?${params.toString()}`);
      const propertyData = response.data;

      // ตรวจสอบว่ามีข้อมูลหรือไม่
      if (propertyData && propertyData.data && propertyData.data.length > 0) {
        // สร้าง payload สำหรับแสดงผลข้อมูลอสังหาริมทรัพย์
        const propertyPayload = createPropertyPayload(propertyData);

        // ส่งข้อมูลกลับไปยัง Dialogflow
        return res.json({
          fulfillmentMessages: [
            {
              text: {
                text: [propertyData.sms || "นี่คือรายการอสังหาริมทรัพย์ที่คุณกำลังหา"]
              }
            },
            {
              payload: propertyPayload
            }
          ]
        });
      }
    } catch (error) {
      console.error('Error searching properties:', error);
    }
  }

  // ถ้าเป็น intent 'step6'
  if (queryResult.intent && queryResult.intent.displayName === 'step6') {
    // ดึงข้อความที่ผู้ใช้พิมพ์
    const userText = queryResult.queryText;
    const detectedPropertyType = detectPropertyTypeFromText(userText);

    // สร้าง response กลับไปยัง Dialogflow
    return res.json({
      fulfillmentMessages: [
        {
          text: {
            text: [`คุณต้องการค้นหา${detectedPropertyType ? getPropertyTypeText(detectedPropertyType) : "อสังหาริมทรัพย์"} ใช่ไหมครับ ให้ผมช่วยหาข้อมูลให้นะครับ`]
          }
        }
      ]
    });
  }

  // ถ้าไม่มีข้อมูลครบหรือมีข้อผิดพลาดในการค้นหา ส่งข้อมูลจาก Dialogflow กลับไปโดยตรง
  res.json({
    fulfillmentMessages: queryResult.fulfillmentMessages,
    fulfillmentText: queryResult.fulfillmentText
  });
};

// ฟังก์ชันวิเคราะห์ข้อความเพื่อหาประเภทอสังหาริมทรัพย์
function detectPropertyTypeFromText(text) {
  if (!text) return null;

  const lowerText = text.toLowerCase();

  // คอนโด
  if (lowerText.includes('คอนโด') || lowerText.includes('condo') || lowerText.includes('condominium')) {
    return 1;
  }

  // บ้านเดี่ยว
  if (lowerText.includes('บ้านเดี่ยว') || lowerText.includes('บ้าน') || lowerText.includes('house')) {
    return 2;
  }

  // ทาวน์โฮม ทาวน์เฮ้าส์
  if (lowerText.includes('ทาวน์โฮม') || lowerText.includes('ทาวน์เฮ้าส์') ||
      lowerText.includes('townhome') || lowerText.includes('townhouse')) {
    return 3;
  }

  // ที่ดิน
  if (lowerText.includes('ที่ดิน') || lowerText.includes('land')) {
    return 4;
  }

  // อพาร์ทเม้นท์
  if (lowerText.includes('อพาร์ทเม้นท์') || lowerText.includes('อพาร์ทเม้น') ||
      lowerText.includes('apartment')) {
    return 5;
  }

  return null;
}

// ฟังก์ชันแปลงรหัสประเภทอสังหาริมทรัพย์เป็นข้อความ
function getPropertyTypeText(propertyTypeId) {
  switch (propertyTypeId) {
    case 1: return "คอนโด";
    case 2: return "บ้านเดี่ยว";
    case 3: return "ทาวน์โฮม";
    case 4: return "ที่ดิน";
    case 5: return "อพาร์ทเม้นท์";
    default: return "อสังหาริมทรัพย์";
  }
}

// ฟังก์ชันสำหรับสร้าง payload แสดงผลข้อมูลอสังหาริมทรัพย์
function createPropertyPayload(propertyData) {
  // สร้าง property_list สำหรับแสดงข้อมูลอสังหาริมทรัพย์
  const properties = propertyData.data.map(item => ({
    id: item.web_id ? item.web_id.toString() : '',
    imageUrl: item.photo || '',
    title: item.name || 'ไม่ระบุชื่อ',
    location: item.zone || 'ไม่ระบุที่ตั้ง',
    price: item.price ? formatPrice(item.price) : '-',
    tag: item.tag || 'ขาย',
    link: item.link || '#'
  }));

  // สร้าง rich content สำหรับแสดงผลข้อมูลอสังหาริมทรัพย์
  return {
    richContent: [
      [
        {
          type: "info",
          title: "ผลการค้นหาอสังหาริมทรัพย์",
          subtitle: `พบทั้งหมด ${propertyData.count || properties.length} รายการ`
        },
        ...properties.map(property => ({
          type: "info",
          title: `${property.tag} ${property.title}`,
          subtitle: `${property.location}\n฿${property.price}`,
          actionLink: property.link,
          image: {
            src: {
              rawUrl: property.imageUrl
            }
          }
        }))
      ]
    ]
  };
}

// ฟังก์ชันแปลงประเภทอสังหาริมทรัพย์เป็น post_type
function mapPropertyType(propertyType) {
  if (!propertyType) return null;

  const type = propertyType.toLowerCase();

  if (type.includes('คอนโด')) return 1;
  if (type.includes('บ้าน') || type.includes('บ้านเดี่ยว')) return 2;
  if (type.includes('ทาวน์เฮ้าส์') || type.includes('ทาวน์โฮม')) return 3;
  if (type.includes('ที่ดิน')) return 4;
  if (type.includes('อพาร์ทเม้นท์') || type.includes('อพาร์ทเม้น')) return 5;

  // กรณีไม่มีข้อมูลที่ตรงกัน แต่เป็นตัวเลข
  if (/^[1-5]$/.test(propertyType)) {
    return parseInt(propertyType);
  }

  // กรณีไม่มีข้อมูลที่ตรงกัน
  return null;
}

// ฟังก์ชันแปลงประเภทธุรกรรมเป็น proprety_tag
function mapTransactionType(transactionType) {
  if (!transactionType) return null;

  const type = transactionType.toLowerCase();

  if (type.includes('ขาย')) return 'ขาย';
  if (type.includes('เช่า')) return 'เช่า';

  // กรณีไม่มีข้อมูลที่ตรงกัน
  return null;
}

// ฟังก์ชันแปลงราคาเป็นตัวเลข
function parsePrice(price) {
  if (!price) return null;

  // ตัวอย่างการแปลงค่า "ไม่เกิน 5 ล้าน" เป็น 5000000
  if (typeof price === 'string') {
    if (price.includes('ล้าน')) {
      const match = price.match(/(\d+(\.\d+)?)\s*ล้าน/);
      if (match) {
        return parseFloat(match[1]) * 1000000;
      }
    }

    // แปลงเป็นเลขล้วน (ตัดหน่วยและเครื่องหมายออก)
    return price.replace(/[^\d]/g, '');
  }

  return price;
}

// ฟังก์ชันแปลงทำเล/จังหวัดเป็น zone_id
function mapLocationToZoneId(location) {
  if (!location) return null;

  const loc = location.toLowerCase();

  // ตัวอย่างการแปลงพื้นที่เป็น zone_id (ปรับตามข้อมูลจริง)
  if (loc.includes('กรุงเทพ')) return 1;
  if (loc.includes('ขอนแก่น')) return 2;
  if (loc.includes('เชียงใหม่')) return 3;
  if (loc.includes('พัทยา')) return 4;
  if (loc.includes('ลาดพร้าว')) return 5;
  if (loc.includes('บางนา')) return 6;

  // กรณีไม่มีข้อมูลที่ตรงกัน
  return null;
}

// ฟังก์ชันแปลงชื่อโครงการเป็น project_id
function mapProjectToId(projectName) {
  if (!projectName) return null;

  // ตัวอย่างการแปลงชื่อโครงการเป็น project_id (ปรับตามข้อมูลจริง)
  const project = projectName.toLowerCase();

  // ตัวอย่างการแมปชื่อโครงการเป็น ID
  if (project.includes('ศุภาลัย')) return 1;
  if (project.includes('แสนสิริ')) return 2;
  if (project.includes('พฤกษา')) return 3;

  // กรณีไม่มีข้อมูลที่ตรงกัน
  return null;
}

// ฟังก์ชันจัดรูปแบบราคา
function formatPrice(price) {
  if (!price) return '-';

  let numPrice;
  if (typeof price === 'string') {
    // ลบตัวอักษรที่ไม่ใช่ตัวเลขออก
    numPrice = parseFloat(price.replace(/[^\d.-]/g, ''));
  } else {
    numPrice = price;
  }

  // ตรวจสอบว่าเป็นตัวเลขที่ถูกต้องหรือไม่
  if (isNaN(numPrice)) return price;

  // จัดรูปแบบตัวเลข
  return numPrice.toLocaleString();
}
