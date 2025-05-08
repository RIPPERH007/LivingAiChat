/**
 * API Integration
 * จัดการการเชื่อมต่อกับ API สำหรับหน้าแอดมินของ Chatbot
 * เปลี่ยนจาก PieSocket เป็น Socket.IO
 */

// URL ของ backend API
const API_URL = 'http://localhost:3000/api';

/**
 * ดึงข้อมูลการสนทนาทั้งหมด
 * @param {string} status - สถานะของการสนทนา (waiting, answered, closed)
 * @returns {Promise<Array>} - ข้อมูลการสนทนา
 */
async function fetchConversations(status = 'all') {
    try {
        const response = await fetch(`${API_URL}/conversations${status !== 'all' ? `?status=${status}` : ''}`);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        return data.conversations || [];
    } catch (error) {
        console.error('Error fetching conversations:', error);
        return [];
    }
}

/**
 * ดึงข้อมูลการสนทนาเฉพาะราย
 * @param {string} sessionId - ID ของเซสชัน
 * @returns {Promise<Object>} - ข้อมูลการสนทนา
 */
async function fetchConversationDetails(sessionId) {
    try {
        const response = await fetch(`${API_URL}/conversations/${sessionId}`);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        return data || {};
    } catch (error) {
        console.error('Error fetching conversation details:', error);
        return {};
    }
}

/**
 * ดึงข้อมูล session ของการสนทนา
 * @param {string} sessionId - ID ของเซสชัน
 * @returns {Promise<Object>} - ข้อมูล session
 */
async function fetchSessionData(sessionId) {
    try {
        const response = await fetch(`${API_URL}/sessionData/${sessionId}`);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        return data.data || {};
    } catch (error) {
        console.error('Error fetching session data:', error);
        return {};
    }
}

/**
 * ส่งข้อความในนามแอดมิน
 * @param {string} sessionId - ID ของเซสชัน
 * @param {string} message - ข้อความที่ต้องการส่ง
 * @param {string} adminId - ID ของแอดมิน
 * @param {string} adminName - ชื่อแอดมิน
 * @param {number} messageId - ID ของข้อความ (ป้องกันข้อความซ้ำ)
 * @returns {Promise<Object>} - ผลลัพธ์การส่งข้อความ
 */
async function sendAdminMessage(sessionId, message, adminId, adminName, messageId) {
    try {
        const response = await fetch(`${API_URL}/admin/message`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                sessionId,
                message,
                adminId,
                adminName,
                messageId
            })
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        return data;
    } catch (error) {
        console.error('Error sending admin message:', error);
        throw error;
    }
}

/**
 * อัปเดตสถานะของการสนทนา
 * @param {string} sessionId - ID ของเซสชัน
 * @param {string} status - สถานะใหม่ (waiting, answered, closed)
 * @param {string} adminId - ID ของแอดมิน
 * @returns {Promise<Object>} - ผลลัพธ์การอัปเดต
 */
async function updateConversationStatus(sessionId, status, adminId) {
    try {
        const response = await fetch(`${API_URL}/conversations/${sessionId}/status`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ status, adminId })
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        return data;
    } catch (error) {
        console.error('Error updating conversation status:', error);
        throw error;
    }
}

/**
 * ลบการสนทนา
 * @param {string} sessionId - ID ของเซสชัน
 * @returns {Promise<Object>} - ผลลัพธ์การลบ
 */
async function deleteConversation(sessionId) {
    try {
        const response = await fetch(`${API_URL}/sessionData/${sessionId}`, {
            method: 'DELETE'
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        return data;
    } catch (error) {
        console.error('Error deleting conversation:', error);
        throw error;
    }
}

/**
 * ค้นหาการสนทนา
 * @param {string} query - คำค้นหา
 * @returns {Promise<Array>} - ผลลัพธ์การค้นหา
 */
async function searchConversations(query) {
    try {
        const response = await fetch(`${API_URL}/conversations/search?q=${encodeURIComponent(query)}`);

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        return data.results || [];
    } catch (error) {
        console.error('Error searching conversations:', error);
        return [];
    }
}

/**
 * ดึงข้อมูลแดชบอร์ด
 * @returns {Promise<Object>} - ข้อมูลสรุปแดชบอร์ด
 */
async function fetchDashboardData() {
    try {
        const response = await fetch(`${API_URL}/dashboard`);

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        return data;
    } catch (error) {
        console.error('Error fetching dashboard data:', error);
        return {
            waitingCount: 0,
            answeredCount: 0,
            allCount: 0,
            totalConversations: 0
        };
    }
}

/**
 * ส่งข้อความทดสอบผ่าน Socket.IO
 * @param {string} message - ข้อความที่ต้องการส่ง
 * @returns {Promise<Object>} - ผลลัพธ์การส่ง
 */
async function testSocketConnection(message = 'Test message') {
    try {
        const response = await fetch(`${API_URL}/test/socket?message=${encodeURIComponent(message)}`);

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        return data;
    } catch (error) {
        console.error('Error testing socket connection:', error);
        return { success: false, message: error.message };
    }
}

async function updatePropertySearch(sessionId, searchData) {
  try {
    const response = await fetch(`${API_URL}/property/search/${sessionId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ searchData })
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error updating property search:', error);
    throw error;
  }
}

/**
 * ค้นหาอสังหาริมทรัพย์
 * @param {Object} searchData - ข้อมูลการค้นหา
 * @returns {Promise<Object>} - ผลลัพธ์การค้นหา
 */
async function searchProperties(searchData) {
  try {
    const response = await fetch(`${API_URL}/property/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ searchData })
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error searching properties:', error);
    throw error;
  }
}

// Export functions
window.adminAPI = {
    fetchConversations,
    fetchConversationDetails,
    fetchSessionData,
    sendAdminMessage,
    updateConversationStatus,
    deleteConversation,
    searchConversations,
    fetchDashboardData,
    testSocketConnection,
    updatePropertySearch,
    searchProperties
};
