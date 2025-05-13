/**
 * Dialogflow Integration
 * ส่วนที่จัดการการเชื่อมต่อกับ Dialogflow
 */

// URL ของ backend API ที่เชื่อมต่อกับ Dialogflow
const DIALOGFLOW_API_URL = 'http://localhost:4000/api/dialogflow';

/**
 * ส่งข้อความไปยัง Dialogflow
 * @param {string} message - ข้อความที่ต้องการส่ง
 * @param {string} sessionId - ID ของเซสชัน
 * @param {number} messageId - ID ของข้อความ (เพื่อป้องกันข้อความซ้ำ)
 * @returns {Promise} Promise ที่ส่งค่ากลับเป็นข้อมูลการตอบกลับจาก Dialogflow
 */
async function sendToDialogflow(message, sessionId, messageId = null) {
    try {
        const response = await axios.post(DIALOGFLOW_API_URL, {
            query: message,
            sessionId: sessionId,
            messageId: messageId
        });

        // ตรวจสอบว่ามีการตอบกลับและสถานะการตอบกลับถูกต้อง
        if (response.data && response.data.success) {
            return {
                message: response.data.message || '',
                payload: response.data.payload || null,
                intent: response.data.intent || '',
                confidence: response.data.confidence || 0,
                messageId: response.data.messageId || null
            };
        } else {
            // กรณีที่ไม่มีการตอบกลับหรือมีข้อผิดพลาด
            console.error('Invalid response from Dialogflow API:', response.data);
            return {
                message: 'ขออภัย ไม่สามารถประมวลผลข้อความของคุณได้ในขณะนี้',
                payload: null
            };
        }
    } catch (error) {
        console.error('Error communicating with Dialogflow API:', error);
        throw error;
    }
}

// Export ฟังก์ชันไปใช้งาน
window.sendToDialogflow = sendToDialogflow;
