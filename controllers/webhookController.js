/**
 * Webhook Controller
 * จัดการ webhook จาก Dialogflow และสร้างการตอบกลับแบบมีโครงสร้าง
 */

// เอ็กซ์ปอร์ตฟังก์ชันสำหรับใช้ใน server.js
exports.createWelcome = createWelcome;
exports.createStep1 = createStep1;
exports.createStep2 = createStep2;
exports.createStep3 = createStep3;
exports.createStep4 = createStep4;
exports.createStep5 = createStep5;

// จัดการ webhook ที่ส่งมาจาก Dialogflow
exports.handleWebhook = (req, res) => {
    // ตรวจสอบความถูกต้องของ request
    if (!req.body || !req.body.queryResult) {
        return res.status(400).json({
            success: false,
            message: 'Invalid webhook request'
        });
    }

    // รับข้อมูลจาก request
    const queryResult = req.body.queryResult;
    const intent = queryResult.intent.displayName;
    const parameters = queryResult.parameters;

    let response;

    // ตรวจสอบ intent และส่งข้อมูลไปยังฟังก์ชันที่เกี่ยวข้อง
    switch (intent) {
        case 'welcome':
            response = createWelcome();
            break;
        case 'step1':
            response = createStep1(parameters);
            break;
        case 'step2':
            response = createStep2(parameters);
            break;
        case 'step3':
            response = createStep3(parameters);
            break;
        case 'step4':
            response = createStep4(parameters);
            break;
        case 'step5':
            response = createStep5(parameters);
            break;
        case 'mortgage_inquiry':
            response = handleMortgageInquiry(parameters);
            break;
        case 'property_detail':
            response = handlePropertyDetail(parameters);
            break;
        case 'foreigner_buying':
            response = handleForeignerBuying(parameters);
            break;
        default:
            response = createDefaultResponse();
    }

    // ส่งข้อมูลกลับไปยัง Dialogflow
    res.json(response);
};

/**
 * สร้างการตอบกลับแบบ Default สำหรับกรณีที่ไม่มี Intent ที่เหมาะสม
 * @returns {Object} การตอบกลับแบบ Default
 */
function createDefaultResponse() {
    return {
        fulfillmentMessages: [
            {
                text: {
                    text: [
                        'ขอโทษครับ ผมยังไม่เข้าใจคำถามของคุณ กรุณาถามใหม่หรือเลือกหัวข้อที่คุณสนใจจากตัวเลือกด้านล่างนี้'
                    ]
                }
            },
            {
                payload: {
                    richContent: [
                        [
                            {
                                type: "chips",
                                options: [
                                    {
                                        text: "ซื้อบ้าน"
                                    },
                                    {
                                        text: "ขายบ้าน"
                                    },
                                    {
                                        text: "เช่าบ้าน"
                                    },
                                    {
                                        text: "สินเชื่อบ้าน"
                                    },
                                    {
                                        text: "ติดต่อเจ้าหน้าที่"
                                    }
                                ]
                            }
                        ]
                    ]
                }
            }
        ]
    };
}

/**
 * สร้างการตอบกลับแบบ Welcome Message
 * @returns {Object} การตอบกลับแบบ Welcome
 */
function createWelcome() {
    return {
        fulfillmentMessages: [
            {
                text: {
                    text: [
                        '🙏สวัสดีครับ ผมคือผู้ช่วยอัจฉริยะของ My Property พร้อมช่วยคุณหา ซื้อ ขาย หรือเช่าสินทรัพย์ แบบง่าย ๆ สนใจเรื่องไหน ถามกันได้เลย!'
                    ]
                }
            },
            {
                payload: {
                    richContent: [
                        [
                            {
                                type: "chips",
                                options: [
                                    {
                                        text: "ซื้อ"
                                    },
                                    {
                                        text: "ขาย"
                                    },
                                    {
                                        text: "เช่า"
                                    },
                                    {
                                        text: "ให้เช่า"
                                    }
                                ]
                            }
                        ]
                    ]
                }
            }
        ]
    };
}

/**
 * สร้างการตอบกลับสำหรับขั้นตอนที่ 1
 * เลือกประเภทธุรกรรม (ซื้อ, ขาย, เช่า, ให้เช่า)
 * @param {Object} parameters - พารามิเตอร์จาก Dialogflow
 * @returns {Object} การตอบกลับสำหรับขั้นตอนที่ 1
 */
function createStep1(parameters = {}) {
    const transactionType = parameters.transaction_type || '';
    let responseText = '';

    if (transactionType === 'ซื้อ') {
        responseText = 'คุณต้องการซื้ออสังหาริมทรัพย์ประเภทใด?';
    } else if (transactionType === 'ขาย') {
        responseText = 'คุณต้องการขายอสังหาริมทรัพย์ประเภทใด?';
    } else if (transactionType === 'เช่า') {
        responseText = 'คุณต้องการเช่าอสังหาริมทรัพย์ประเภทใด?';
    } else if (transactionType === 'ให้เช่า') {
        responseText = 'คุณต้องการให้เช่าอสังหาริมทรัพย์ประเภทใด?';
    } else {
        responseText = 'กรุณาเลือกประเภทธุรกรรมที่คุณต้องการ';
    }

    return {
        fulfillmentMessages: [
            {
                text: {
                    text: [responseText]
                }
            },
            {
                payload: {
                    richContent: [
                        [
                            {
                                type: "chips",
                                options: [
                                    {
                                        text: "บ้านเดี่ยว"
                                    },
                                    {
                                        text: "คอนโด"
                                    },
                                    {
                                        text: "ทาวน์โฮม"
                                    },
                                    {
                                        text: "ที่ดิน"
                                    },
                                    {
                                        text: "อาคารพาณิชย์"
                                    }
                                ]
                            }
                        ]
                    ]
                }
            }
        ]
    };
}

/**
 * สร้างการตอบกลับสำหรับขั้นตอนที่ 2
 * เลือกประเภทอสังหาริมทรัพย์
 * @param {Object} parameters - พารามิเตอร์จาก Dialogflow
 * @returns {Object} การตอบกลับสำหรับขั้นตอนที่ 2
 */
function createStep2(parameters = {}) {
    const propertyType = parameters.property_type || '';
    const responseText = 'คุณต้องการอสังหาริมทรัพย์ในทำเลที่ตั้งใด?';

    return {
        fulfillmentMessages: [
            {
                text: {
                    text: [responseText]
                }
            },
            {
                payload: {
                    richContent: [
                        [
                            {
                                type: "chips",
                                options: [
                                    {
                                        text: "กรุงเทพฯ"
                                    },
                                    {
                                        text: "นนทบุรี"
                                    },
                                    {
                                        text: "ปทุมธานี"
                                    },
                                    {
                                        text: "สมุทรปราการ"
                                    },
                                    {
                                        text: "อื่นๆ"
                                    }
                                ]
                            }
                        ]
                    ]
                }
            }
        ]
    };
}

/**
 * สร้างการตอบกลับสำหรับขั้นตอนที่ 3
 * เลือกทำเลที่ตั้ง
 * @param {Object} parameters - พารามิเตอร์จาก Dialogflow
 * @returns {Object} การตอบกลับสำหรับขั้นตอนที่ 3
 */
function createStep3(parameters = {}) {
    const location = parameters.location || '';
    const responseText = 'คุณมีงบประมาณในการซื้อเท่าไร?';

    return {
        fulfillmentMessages: [
            {
                text: {
                    text: [responseText]
                }
            },
            {
                payload: {
                    richContent: [
                        [
                            {
                                type: "chips",
                                options: [
                                    {
                                        text: "ไม่เกิน 1 ล้านบาท"
                                    },
                                    {
                                        text: "1-3 ล้านบาท"
                                    },
                                    {
                                        text: "3-5 ล้านบาท"
                                    },
                                    {
                                        text: "5-10 ล้านบาท"
                                    },
                                    {
                                        text: "มากกว่า 10 ล้านบาท"
                                    }
                                ]
                            }
                        ]
                    ]
                }
            }
        ]
    };
}

/**
 * สร้างการตอบกลับสำหรับขั้นตอนที่ 4
 * เลือกงบประมาณ
 * @param {Object} parameters - พารามิเตอร์จาก Dialogflow
 * @returns {Object} การตอบกลับสำหรับขั้นตอนที่ 4
 */
function createStep4(parameters = {}) {
    const budget = parameters.budget || '';

    return {
        fulfillmentMessages: [
            {
                text: {
                    text: [
                        'ขอบคุณสำหรับข้อมูล นี่คือรายการอสังหาริมทรัพย์ที่ตรงกับความต้องการของคุณ'
                    ]
                }
            },
            {
                payload: {
                    richContent: [
                        [
                            {
                                type: "property_list",
                                properties: [
                                    {
                                        id: "P001",
                                        title: "บ้านเดี่ยว 2 ชั้น หมู่บ้านชัยพฤกษ์",
                                        price: 4500000,
                                        location: "บางนา, กรุงเทพฯ",
                                        area: 50,
                                        floors: 2,
                                        bedrooms: 3,
                                        bathrooms: 2,
                                        imageUrl: "assets/images/house1.jpg",
                                        date: "1 วัน",
                                        views: 152
                                    },
                                    {
                                        id: "P002",
                                        title: "บ้านเดี่ยว สไตล์โมเดิร์น สุขุมวิท 101",
                                        price: 6200000,
                                        location: "สุขุมวิท, กรุงเทพฯ",
                                        area: 72,
                                        floors: 2,
                                        bedrooms: 4,
                                        bathrooms: 3,
                                        imageUrl: "assets/images/house2.jpg",
                                        date: "3 วัน",
                                        views: 89
                                    },
                                    {
                                        id: "P003",
                                        title: "บ้านเดี่ยว ในโครงการหรู พร้อมสระว่ายน้ำ",
                                        price: 8500000,
                                        location: "รามอินทรา, กรุงเทพฯ",
                                        area: 100,
                                        floors: 2,
                                        bedrooms: 4,
                                        bathrooms: 3,
                                        imageUrl: "assets/images/house3.jpg",
                                        date: "5 วัน",
                                        views: 120
                                    }
                                ]
                            }
                        ]
                    ]
                }
            }
        ]
    };
}

/**
 * สร้างการตอบกลับสำหรับขั้นตอนที่ 5
 * แสดงรายละเอียดของอสังหาริมทรัพย์ที่เลือก
 * @param {Object} parameters - พารามิเตอร์จาก Dialogflow
 * @returns {Object} การตอบกลับสำหรับขั้นตอนที่ 5
 */
function createStep5(parameters = {}) {
    const propertyId = parameters.property_id || '';

    // ข้อมูลจำลองสำหรับอสังหาริมทรัพย์
    const properties = {
        'P001': {
            id: "P001",
            title: "บ้านเดี่ยว 2 ชั้น หมู่บ้านชัยพฤกษ์",
            price: 4500000,
            location: "บางนา, กรุงเทพฯ",
            area: 50,
            floors: 2,
            bedrooms: 3,
            bathrooms: 2,
            description: "บ้านเดี่ยว 2 ชั้น สภาพใหม่ ตกแต่งสวย เดินทางสะดวก ใกล้ถนนใหญ่ ใกล้ห้างสรรพสินค้า และโรงพยาบาล",
            features: ["เฟอร์นิเจอร์ Built-in", "เครื่องปรับอากาศ 4 เครื่อง", "ระบบรักษาความปลอดภัย 24 ชม.", "สวนส่วนกลาง"],
            imageUrl: "assets/images/house1.jpg"
        },
        'P002': {
            id: "P002",
            title: "บ้านเดี่ยว สไตล์โมเดิร์น สุขุมวิท 101",
            price: 6200000,
            location: "สุขุมวิท, กรุงเทพฯ",
            area: 72,
            floors: 2,
            bedrooms: 4,
            bathrooms: 3,
            description: "บ้านเดี่ยวสไตล์โมเดิร์น ตกแต่งสวยงาม เดินทางสะดวก ใกล้รถไฟฟ้า BTS บางจาก เพียง 800 เมตร",
            features: ["เฟอร์นิเจอร์ Built-in ครบทั้งหลัง", "เครื่องปรับอากาศทุกห้อง", "ระบบ Smart Home", "สวนส่วนตัว"],
            imageUrl: "assets/images/house2.jpg"
        },
        'P003': {
            id: "P003",
            title: "บ้านเดี่ยว ในโครงการหรู พร้อมสระว่ายน้ำ",
            price: 8500000,
            location: "รามอินทรา, กรุงเทพฯ",
            area: 100,
            floors: 2,
            bedrooms: 4,
            bathrooms: 3,
            description: "บ้านเดี่ยวในโครงการหรู พร้อมสระว่ายน้ำส่วนตัว บรรยากาศร่มรื่น เงียบสงบ เหมาะสำหรับครอบครัวใหญ่",
            features: ["สระว่ายน้ำส่วนตัว", "ห้องทำงาน", "ห้องอเนกประสงค์", "พื้นที่จอดรถ 2 คัน", "ระบบรักษาความปลอดภัย 24 ชม."],
            imageUrl: "assets/images/house3.jpg"
        }
    };

    // ตรวจสอบว่ามีข้อมูลของอสังหาริมทรัพย์ที่ต้องการหรือไม่
    const property = properties[propertyId];

    if (!property) {
        return {
            fulfillmentMessages: [
                {
                    text: {
                        text: [
                            "ขออภัย ไม่พบข้อมูลอสังหาริมทรัพย์ที่คุณต้องการ โปรดลองเลือกรายการอื่น"
                        ]
                    }
                }
            ]
        };
    }

    // สร้างการตอบกลับที่มีรายละเอียดของอสังหาริมทรัพย์
    return {
        fulfillmentMessages: [
            {
                text: {
                    text: [
                        `นี่คือรายละเอียดของ ${property.title}`
                    ]
                }
            },
            {
                payload: {
                    richContent: [
                        [
                            {
                                type: "image",
                                rawUrl: property.imageUrl,
                                accessibilityText: property.title
                            },
                            {
                                type: "info",
                                title: property.title,
                                subtitle: `ราคา: ${property.price.toLocaleString()} บาท | พื้นที่: ${property.area} ตร.ว.`
                            },
                            {
                                type: "info",
                                title: "รายละเอียด",
                                subtitle: property.description
                            },
                            {
                                type: "info",
                                title: "สิ่งอำนวยความสะดวก",
                                subtitle: property.features.join(", ")
                            },
                            {
                                type: "button",
                                options: [
                                    {
                                        text: "นัดดูสถานที่",
                                        icon: "event",
                                        color: "primary"
                                    },
                                    {
                                        text: "ติดต่อตัวแทนขาย",
                                        icon: "phone",
                                        color: "secondary"
                                    },
                                    {
                                        text: "ดูรายการอื่น",
                                        icon: "refresh"
                                    }
                                ]
                            }
                        ]
                    ]
                }
            }
        ]
    };
}

/**
 * จัดการข้อความที่เกี่ยวกับการขอสินเชื่อ
 * @param {Object} parameters - พารามิเตอร์จาก Dialogflow
 * @returns {Object} การตอบกลับสำหรับคำถามเกี่ยวกับสินเชื่อ
 */
function handleMortgageInquiry(parameters = {}) {
    return {
        fulfillmentMessages: [
            {
                text: {
                    text: [
                        "สำหรับการขอสินเชื่อบ้านในประเทศไทย คุณสามารถขอได้จากธนาคารพาณิชย์หลายแห่ง โดยแต่ละธนาคารจะมีเงื่อนไขและอัตราดอกเบี้ยที่แตกต่างกัน ขึ้นอยู่กับรายได้และประวัติทางการเงินของคุณ"
                    ]
                }
            },
            {
                text: {
                    text: [
                        "สำหรับชาวต่างชาติ ธนาคารบางแห่งในไทยมีโปรแกรมสินเชื่อพิเศษ แต่จะมีเงื่อนไขเพิ่มเติม เช่น อาจต้องมีใบอนุญาตทำงานในไทย หรือ มีคู่สมรสเป็นคนไทย"
                    ]
                }
            },
            {
                payload: {
                    richContent: [
                        [
                            {
                                type: "button",
                                options: [
                                    {
                                        text: "ต้องการข้อมูลเพิ่มเติม",
                                        icon: "info",
                                        color: "primary"
                                    },
                                    {
                                        text: "ติดต่อฝ่ายสินเชื่อ",
                                        icon: "phone",
                                        color: "secondary"
                                    }
                                ]
                            }
                        ]
                    ]
                }
            }
        ]
    };
}

/**
 * จัดการคำถามเกี่ยวกับรายละเอียดอสังหาริมทรัพย์
 * @param {Object} parameters - พารามิเตอร์จาก Dialogflow
 * @returns {Object} การตอบกลับสำหรับคำถามเกี่ยวกับรายละเอียดอสังหาริมทรัพย์
 */
function handlePropertyDetail(parameters = {}) {
    return {
        fulfillmentMessages: [
            {
                text: {
                    text: [
                        "คุณสนใจอสังหาริมทรัพย์ประเภทไหนครับ? ผมสามารถแนะนำข้อมูลเกี่ยวกับบ้านเดี่ยว, คอนโด, ทาวน์โฮม หรืออาคารพาณิชย์ได้"
                    ]
                }
            },
            {
                payload: {
                    richContent: [
                        [
                            {
                                type: "chips",
                                options: [
                                    {
                                        text: "บ้านเดี่ยว"
                                    },
                                    {
                                        text: "คอนโด"
                                    },
                                    {
                                        text: "ทาวน์โฮม"
                                    },
                                    {
                                        text: "อาคารพาณิชย์"
                                    }
                                ]
                            }
                        ]
                    ]
                }
            }
        ]
    };
}

/**
 * จัดการคำถามเกี่ยวกับการซื้ออสังหาริมทรัพย์ของชาวต่างชาติ
 * @param {Object} parameters - พารามิเตอร์จาก Dialogflow
 * @returns {Object} การตอบกลับสำหรับคำถามเกี่ยวกับการซื้ออสังหาริมทรัพย์ของชาวต่างชาติ
 */
function handleForeignerBuying(parameters = {}) {
    return {
        fulfillmentMessages: [
            {
                text: {
                    text: [
                        "สำหรับชาวต่างชาติที่ต้องการซื้ออสังหาริมทรัพย์ในประเทศไทย มีข้อจำกัดและเงื่อนไขดังนี้:"
                    ]
                }
            },
            {
                text: {
                    text: [
                        "1. คอนโด: ชาวต่างชาติสามารถซื้อและถือครองกรรมสิทธิ์ห้องชุดได้ แต่สัดส่วนการถือครองโดยชาวต่างชาติในแต่ละอาคารต้องไม่เกิน 49% ของพื้นที่ทั้งหมด\n\n2. บ้านและที่ดิน: โดยทั่วไปชาวต่างชาติไม่สามารถถือครองที่ดินได้ แต่มีทางเลือกอื่น เช่น การเช่าระยะยาว (30 ปี ต่ออายุได้) หรือการตั้งบริษัทไทย\n\n3. คอนโดมิเนียมสร้างบนที่ดินเช่า: ชาวต่างชาติสามารถซื้อได้โดยไม่จำกัดสัดส่วน"
                    ]
                }
            },
            {
                payload: {
                    richContent: [
                        [
                            {
                                type: "button",
                                options: [
                                    {
                                        text: "ปรึกษาฝ่ายกฎหมาย",
                                        icon: "info",
                                        color: "primary"
                                    },
                                    {
                                        text: "ดูคอนโดสำหรับชาวต่างชาติ",
                                        icon: "home",
                                        color: "secondary"
                                    }
                                ]
                            }
                        ]
                    ]
                }
            }
        ]
    };
}
