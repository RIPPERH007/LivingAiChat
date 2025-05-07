const axios = require('axios');

exports.handleWebhook = async (req, res) => {
  console.log('Webhook Request Body:', JSON.stringify(req.body));

  // แยกข้อมูลจาก request body
  const { responseId, queryResult, session } = req.body;

  // แสดงข้อมูลดีบั๊ก
  console.log('1Request Body:', JSON.stringify(req.body));
  console.log('2Detected Intent:', queryResult.intent.displayName);
  console.log('3Parameters:', JSON.stringify(queryResult.parameters));
  console.log('4Query:', queryResult.queryText);
  console.log('5Detected Intent:', queryResult.intent.displayName);
  console.log('6Detected Intent:', queryResult.intent);
  console.log('7Confidence:', queryResult.intentDetectionConfidence);

  // ตรวจสอบว่ามีข้อมูลครบตามเงื่อนไขหรือไม่
  let searchParams = {};
  let shouldSearch = false;

  // ตรวจสอบพารามิเตอร์จาก queryResult
  if (queryResult.parameters) {
  console.log('Search Parameters:', searchParams);

    // ถ้ามี fields ให้ดึงข้อมูลจาก fields
    if (queryResult.parameters.fields) {
      // ประเภทอสังหาริมทรัพย์ (property_type)
      if (queryResult.parameters.fields.property_type) {
        searchParams.post_type = mapPropertyType(queryResult.parameters.fields.property_type.stringValue);
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
      if (queryResult.parameters.property_type) {
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

  // ถ้าไม่มีข้อมูลครบหรือมีข้อผิดพลาดในการค้นหา ส่งข้อมูลจาก Dialogflow กลับไปโดยตรง
  res.json({
    fulfillmentMessages: queryResult.fulfillmentMessages,
    fulfillmentText: queryResult.fulfillmentText
  });
};

// ฟังก์ชันสำหรับสร้าง payload แสดงผลข้อมูลอสังหาริมทรัพย์
function createPropertyPayload(propertyData) {
  // สร้าง property_list สำหรับแสดงข้อมูลอสังหาริมทรัพย์
  const properties = propertyData.data.map(item => ({
    id: item.web_id.toString(),
    imageUrl: item.photo,
    title: item.name,
    location: item.zone,
    price: item.price,
    tag: item.tag,
    link: item.link
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
  if (type.includes('บ้าน')) return 2;
  if (type.includes('ทาวน์เฮ้าส์') || type.includes('ทาวน์โฮม')) return 3;
  if (type.includes('ที่ดิน')) return 4;
  if (type.includes('อพาร์ทเม้นท์') || type.includes('อพาร์ทเม้น')) return 5;

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
