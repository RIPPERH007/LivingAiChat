const axios = require('axios');

// ฟังก์ชัน createStep ทั้งหมดให้สามารถเรียกใช้ได้จากภายนอก
exports.createWelcome = createWelcome;

exports.handleWebhook = (req, res) => {
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

  // ตรวจสอบว่าเป็น intent property_search หรือไม่
  if (queryResult.intent && queryResult.intent.displayName === 'welcome') {
    // สร้างข้อมูลจำลองอสังหาริมทรัพย์
    const propertyResponse = createWelcome();

    // ส่งข้อมูลกลับไปยัง Dialogflow
    res.json(propertyResponse);
  } else {
            // ถ้าไม่ใช่ intent ที่ต้องการให้ส่งข้อความปกติกลับไป
            res.json({
              fulfillmentText: queryResult.fulfillmentText || 'ไม่เข้าใจคำถาม กรุณาลองใหม่อีกครั้ง'
            });
          }
};




function createWelcome() {
  return {
    fulfillmentMessages: [
      {
        text: {
          text: [
            "นี่คือรายการอสังหาริมทรัพย์ที่เรามีในขณะนี้"
          ]
        }
      },
      {
        payload: {

          richContent: [
            [
              {
                options: [
                  {
                    text: "ต้องการซื้อ"
                  },
                  {
                    text: "ต้องการขาย"
                  },
                ],
                type: "chips"
              }
            ]
          ]
        }
      }
    ]
  };
}

//
//function createStep1() {
//  return {
//    fulfillmentMessages: [
//      {
//        text: {
//          text: [
//            "นี่คือรายการอสังหาริมทรัพย์ที่เรามีในขณะนี้"
//          ]
//        }
//      },
//      {
//        payload: {
//
//          richContent: [
//            [
//              {
//                options: [
//                  {
//                    text: "ทั้งหมด"
//                  },
//                  {
//                    text: "คอนโด"
//                  },
//                  {
//                    text: "บ้าน"
//                  },
//                  {
//                    text: "ที่ดิน"
//                  },
//                  {
//                    text: "ทาวน์เฮ้าส์"
//                  },
//                  {
//                    text: "กิจการ โรงแรม หอพัก"
//                  },
//                  {
//                    text: "วิลล่า"
//                  },
//                  {
//                    text: "ชาวน่า"
//                  },
//                  {
//                    text: "ร้านอาหาร"
//                  },
//                  {
//                    text: "อพาร์ทเม้น"
//                  }
//                ],
//                type: "chips"
//              }
//            ]
//          ]
//        }
//      }
//    ]
//  };
//}
//
//
//function createStep2() {
//  return {
//    fulfillmentMessages: [
//      {
//        text: {
//          text: [
//            "นี่คือรายการอสังหาริมทรัพย์ที่เรามีในขณะนี้"
//          ]
//        }
//      },
//      {
//        payload: {
//          "richContent": [
//            [
//              {
//                "title": "ทำเลแนะนำ",
//                "type": "info",
//                "subtitle": "กรุณาเลือกทำเลที่คุณสนใจ"
//              },
//              {
//                "title": "",
//                "type": "list",
//                "items": [
//                  {
//                    "synonyms": [
//                      "บ่อพลอย"
//                    ],
//                    "key": "บ่อพลอย",
//                    "event": {
//                      "name": "selected_location",
//                      "languageCode": "th",
//                      "parameters": {
//                        "location": "บ่อพลอย"
//                      }
//                    },
//                    "title": "บ่อพลอย",
//                    "subtitle": "บ่อพลอย กาญจนบุรี สุราษฎร์ธานี"
//                  },
//                  {
//                    "key": "แม่น้ำ",
//                    "subtitle": "แม่น้ำ กาญจนบุรี สุราษฎร์ธานี",
//                    "title": "แม่น้ำ",
//                    "synonyms": [
//                      "แม่น้ำ"
//                    ],
//                    "event": {
//                      "name": "selected_location",
//                      "languageCode": "th",
//                      "parameters": {
//                        "location": "แม่น้ำ"
//                      }
//                    }
//                  },
//                  {
//                    "synonyms": [
//                      "ปลายแหลม"
//                    ],
//                    "subtitle": "ปลายแหลม กาญจนบุรี สุราษฎร์ธานี",
//                    "title": "ปลายแหลม",
//                    "key": "ปลายแหลม",
//                    "event": {
//                      "languageCode": "th",
//                      "parameters": {
//                        "location": "ปลายแหลม"
//                      },
//                      "name": "selected_location"
//                    }
//                  },
//                  {
//                    "synonyms": [
//                      "บางรัก"
//                    ],
//                    "title": "บางรัก",
//                    "event": {
//                      "languageCode": "th",
//                      "parameters": {
//                        "location": "บางรัก"
//                      },
//                      "name": "selected_location"
//                    },
//                    "key": "บางรัก",
//                    "subtitle": "บางรัก กาญจนบุรี สุราษฎร์ธานี"
//                  },
//                  {
//                    "key": "เดวะ",
//                    "title": "เดวะ",
//                    "subtitle": "เดวะ กาญจนบุรี สุราษฎร์ธานี",
//                    "event": {
//                      "languageCode": "th",
//                      "parameters": {
//                        "location": "เดวะ"
//                      },
//                      "name": "selected_location"
//                    },
//                    "synonyms": [
//                      "เดวะ"
//                    ]
//                  },
//                  {
//                    "key": "บางปอ",
//                    "subtitle": "บางปอ กาญจนบุรี สุราษฎร์ธานี",
//                    "synonyms": [
//                      "บางปอ"
//                    ],
//                    "event": {
//                      "parameters": {
//                        "location": "บางปอ"
//                      },
//                      "name": "selected_location",
//                      "languageCode": "th"
//                    },
//                    "title": "บางปอ"
//                  },
//                  {
//                    "event": {
//                      "parameters": {
//                        "location": "ละไม"
//                      },
//                      "languageCode": "th",
//                      "name": "selected_location"
//                    },
//                    "title": "ละไม",
//                    "synonyms": [
//                      "ละไม"
//                    ],
//                    "key": "ละไม",
//                    "subtitle": "ละไม กาญจนบุรี สุราษฎร์ธานี"
//                  },
//                  {
//                    "title": "เฉวงน้อย",
//                    "key": "เฉวงน้อย",
//                    "subtitle": "เฉวงน้อย กาญจนบุรี สุราษฎร์ธานี",
//                    "synonyms": [
//                      "เฉวงน้อย"
//                    ],
//                    "event": {
//                      "name": "selected_location",
//                      "languageCode": "th",
//                      "parameters": {
//                        "location": "เฉวงน้อย"
//                      }
//                    }
//                  },
//                  {
//                    "subtitle": "ลิปะน้อย กาญจนบุรี สุราษฎร์ธานี",
//                    "event": {
//                      "name": "selected_location",
//                      "parameters": {
//                        "location": "ลิปะน้อย"
//                      },
//                      "languageCode": "th"
//                    },
//                    "key": "ลิปะน้อย",
//                    "synonyms": [
//                      "ลิปะน้อย"
//                    ],
//                    "title": "ลิปะน้อย"
//                  }
//                ]
//              }
//            ]
//          ]
//        }
//      }
//    ]
//  };
//}
//
//
//function createStep3() {
//  return {
//    fulfillmentMessages: [
//      {
//        text: {
//          text: [
//            "นี่คือรายการอสังหาริมทรัพย์ที่เรามีในขณะนี้"
//          ]
//        }
//      },
//      {
//        payload: {
//          "richContent": [
//            [
//              {
//                "options": [
//                  {
//                    "text": "น้อยกว่า 1 ล้าน"
//                  },
//                  {
//                    "text": "1 ล้าน - 1.5 ล้าน"
//                  },
//                  {
//                    "text": "1.5 ล้าน - 2 ล้าน"
//                  },
//                  {
//                    "text": "2 ล้าน - 2.5 ล้าน"
//                  },
//                  {
//                    "text": "2.5 ล้าน - 3 ล้าน"
//                  },
//                  {
//                    "text": "3 ล้าน - 3.5 ล้าน"
//                  },
//                  {
//                    "text": "3.5 ล้าน - 4 ล้าน"
//                  },
//                  {
//                    "text": "4 ล้าน - 4.5 ล้าน"
//                  },
//                  {
//                    "text": "4.5 ล้าน - 5 ล้าน"
//                  },
//                  {
//                    "text": "5 ล้าน - 5.5 ล้าน"
//                  },
//                  {
//                    "text": "5.5 ล้าน - 6 ล้าน"
//                  },
//                  {
//                    "text": "6 ล้าน - 6.5 ล้าน"
//                  },
//                  {
//                    "text": "6.5 ล้าน - 7 ล้าน"
//                  },
//                  {
//                    "text": "7 ล้าน - 7.5 ล้าน"
//                  },
//                  {
//                    "text": "7.5 ล้าน - 8 ล้าน"
//                  },
//                  {
//                    "text": "8 ล้าน - 8.5 ล้าน"
//                  },
//                  {
//                    "text": "8.5 ล้าน - 9 ล้าน"
//                  },
//                  {
//                    "text": "9 ล้าน - 9.5 ล้าน"
//                  },
//                  {
//                    "text": "9.5 ล้าน - 10 ล้าน"
//                  },
//                  {
//                    "text": "10 ล้าน - 11 ล้าน"
//                  },
//                  {
//                    "text": "11 ล้าน - 12 ล้าน"
//                  },
//                  {
//                    "text": "12 ล้าน - 13 ล้าน"
//                  },
//                  {
//                    "text": "13 ล้าน - 14 ล้าน"
//                  },
//                  {
//                    "text": "14 ล้าน - 15 ล้าน"
//                  },
//                  {
//                    "text": "15 ล้าน - 16 ล้าน"
//                  },
//                  {
//                    "text": "16 ล้าน - 17 ล้าน"
//                  },
//                  {
//                    "text": "17 ล้าน - 18 ล้าน"
//                  },
//                  {
//                    "text": "18 ล้าน - 19 ล้าน"
//                  },
//                  {
//                    "text": "19 ล้าน - 20 ล้าน"
//                  },
//                  {
//                    "text": "20 ล้าน - 25 ล้าน"
//                  },
//                  {
//                    "text": "25 ล้าน - 30 ล้าน"
//                  },
//                  {
//                    "text": "30 ล้าน - 35 ล้าน"
//                  },
//                  {
//                    "text": "35 ล้าน - 40 ล้าน"
//                  },
//                  {
//                    "text": "40 ล้าน - 45 ล้าน"
//                  },
//                  {
//                    "text": "45 ล้าน - 50 ล้าน"
//                  },
//                  {
//                    "text": "50 ล้าน - 60 ล้าน"
//                  },
//                  {
//                    "text": "60 ล้าน - 70 ล้าน"
//                  },
//                  {
//                    "text": "70 ล้าน - 80 ล้าน"
//                  },
//                  {
//                    "text": "80 ล้าน - 90 ล้าน"
//                  },
//                  {
//                    "text": "90 ล้าน - 100 ล้าน"
//                  },
//                  {
//                    "text": "มากกว่า 100 ล้าน"
//                  }
//                ],
//                "type": "chips"
//              }
//            ]
//          ]
//        }
//      }
//    ]
//  };
//}
//
//
//function createStep4() {
//  return {
//    fulfillmentMessages: [
//      {
//        text: {
//          text: [
//            "กรุณาเลือกตัวเลือกที่ต้องการ"
//          ]
//        }
//      },
//      {
//        payload: {
//          richContent: [
//            [
//              {
//                "type": "button",
//                "options": [
//                  {
//                    "text": "ค้นหาอสังหาริมทรัพย์",
//                    "icon": "search",
//                    "color": "primary"
//                  },
//                  {
//                    "text": "ติดต่อเจ้าหน้าที่",
//                    "icon": "headset",
//                    "color": "success"
//                  },
//                  {
//                    "text": "ดูเกี่ยวกับเรา",
//                    "icon": "building",
//                    "color": "light"
//                  },
//                  {
//                    "text": "ยกเลิกการค้นหา",
//                    "icon": "times",
//                    "color": "danger"
//                  }
//                ]
//              }
//            ]
//          ]
//        }
//      }
//    ]
//  };
//}
//
//
//function createStep5() {
//  return {
//    fulfillmentMessages: [
//      {
//        text: {
//          text: [
//            "นี่คือรายการอสังหาริมทรัพย์ที่เรามีในขณะนี้"
//          ]
//        }
//      },
//      {
//        payload: {
//          richContent: [
//            [
//              {
//                type: "property_list",
//                properties: [
//                  {
//                    id: "prop001",
//                    imageUrl: "https://www.thepropertycenter.asia/upload/own_18/post_list/6763c0e7ef98f_admin_81823.jpeg",
//                    title: "บ้านเดี่ยว 2 ชั้น หมู่บ้านศุภาลัย",
//                    location: "บางนา, กรุงเทพฯ",
//                    price: 3950000,
//                    area: 50,
//                    floors: 2,
//                    bedrooms: 3,
//                    bathrooms: 2
//                  },
//                  {
//                    id: "prop002",
//                    imageUrl: "https://www.thepropertycenter.asia/upload/own_18/post_list/6763c0ea61162_admin_46200.jpeg",
//                    title: "คอนโดมิเนียม ริเวอร์ไซด์ วิวแม่น้ำ",
//                    location: "เจริญนคร, กรุงเทพฯ",
//                    price: 5200000,
//                    area: 32,
//                    floors: 1,
//                    bedrooms: 1,
//                    bathrooms: 1
//                  },
//                  {
//                    id: "prop003",
//                    imageUrl: "https://www.thepropertycenter.asia/upload/own_18/post_list/6763c0e8e0e91_admin_19516.jpeg",
//                    title: "ทาวน์โฮม 3 ชั้น ใกล้ BTS",
//                    location: "อ่อนนุช, กรุงเทพฯ",
//                    price: 4850000,
//                    area: 24,
//                    floors: 3,
//                    bedrooms: 4,
//                    bathrooms: 3
//                  }
//                ]
//              }
//            ]
//          ]
//        }
//      }
//    ]
//  };
//}


// ฟังก์ชันค้นหาบ้าน
async function searchProperties(parameters) {
  try {
    // เรียก API ค้นหาบ้าน
    const response = await axios.get('https://your-api.com/properties', {
      params: {
        location: parameters.location,
        bedrooms: parameters.bedrooms,
        // พารามิเตอร์อื่นๆ
      }
    });

    return response.data.map(property => ({
      id: property.id,
      imageUrl: property.image,
      price: property.price,
      title: property.title,
      location: property.location,
      area: property.area,
      floors: property.floors,
      bedrooms: property.bedrooms,
      bathrooms: property.bathrooms
    }));
  } catch (error) {
    console.error('Search Properties Error:', error);
    return [];
  }
}

// ฟังก์ชันดึงรายละเอียดบ้าน
async function getPropertyDetails(propertyId) {
  try {
    const response = await axios.get(`https://your-api.com/properties/${propertyId}`);
    return response.data;
  } catch (error) {
    console.error('Property Details Error:', error);
    return null;
  }
}
