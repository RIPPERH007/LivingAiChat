/**
 * Admin Chat Enhancer
 * ปรับปรุงการแสดงข้อความ Rich Content บนฝั่งแอดมิน
 */
(function() {
    // เพิ่ม CSS เข้าไปในเพจ
    function addAdminChatStyles() {
        const styleElement = document.createElement('style');
        styleElement.textContent = `
/* CSS สำหรับแสดงผลข้อความ Rich Content บนฝั่งแอดมิน */

/* แก้ไขการแสดงผลข้อความในแชท */
.message {
    display: flex;
    margin-bottom: 16px;
    max-width: 85%;
    position: relative;
}

.message.user-message, .message.user {
    margin-left: auto;
    flex-direction: row-reverse;
}

.message.bot-message, .message.bot, .message.admin-message, .message.admin {
    margin-right: auto;
}

.message-content {
    padding: 12px 15px;
    border-radius: 18px;
    background-color: #f7f7f7;
    position: relative;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
}

.message.user-message .message-content, .message.user .message-content {
    background-color: #e9ebfe;
    border-top-right-radius: 4px;
}

.message.admin-message .message-content, .message.admin .message-content {
    background-color: #5e35b1;
    color: white;
    border-top-left-radius: 4px;
}

.message.bot-message .message-content, .message.bot .message-content {
    background-color: #ffffff;
    border: 1px solid #e0e0e0;
    border-top-left-radius: 4px;
}

.message-time {
    font-size: 11px;
    color: #888;
    margin-top: 4px;
    text-align: right;
}

.message.user-message .message-time, .message.user .message-time {
    text-align: left;
}

.message-content p {
    margin: 0;
    line-height: 1.4;
}

.message-content small {
    font-size: 11px;
    opacity: 0.8;
    display: block;
    margin-top: 5px;
}

/* Rich Content Styling */
.rich-content {
    margin-top: 10px;
    max-width: 100%;
}

/* Info Card */
.rich-content.info-card {
    background-color: #f9f9f9;
    border-radius: 8px;
    padding: 12px;
    border-left: 3px solid #5e35b1;
}

.rich-content.info-card h4 {
    margin: 0 0 8px 0;
    font-size: 14px;
    color: #333;
}

.rich-content.info-card p {
    margin: 0;
    font-size: 13px;
    color: #666;
}

/* Chips */
.rich-content.chips-container {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 8px;
}

.chip {
    padding: 8px 15px;
    background-color: white;
    border: 1px solid #e0e0e0;
    border-radius: 20px;
    font-size: 13px;
    cursor: pointer;
    transition: all 0.2s;
}

.chip:hover {
    background-color: #f0f0f0;
    border-color: #d0d0d0;
}

/* Button */
.rich-content.button-container {
    margin-top: 10px;
}

.chat-btn {
    display: inline-block;
    padding: 8px 15px;
    margin: 5px;
    border-radius: 20px;
    font-size: 14px;
    cursor: pointer;
    border: none;
    transition: all 0.2s;
}

.chat-btn-primary {
    background-color: #5e35b1;
    color: white;
}

.chat-btn-primary:hover {
    background-color: #512da8;
}

.chat-btn-secondary {
    background-color: #2bbd7e;
    color: white;
}

.chat-btn-light {
    background-color: #f8f9fa;
    color: #333;
    border: 1px solid #ddd;
}

/* Property Card */
.property-card {
    background-color: white;
    border-radius: 12px;
    overflow: hidden;
    margin-bottom: 10px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    width: 100%;
    cursor: pointer;
}

.property-image {
    position: relative;
    width: 100%;
    height: 150px;
    overflow: hidden;
}

.property-image img {
    width: 100%;
    height: 100%;
    object-fit: cover;
}

.property-badge {
    position: absolute;
    top: 10px;
    right: 10px;
    background-color: rgba(52, 58, 64, 0.7);
    color: white;
    padding: 4px 10px;
    border-radius: 4px;
    font-size: 12px;
    font-weight: 500;
}

.property-info {
    padding: 12px;
}

.property-price {
    font-size: 16px;
    font-weight: bold;
    color: #2bbd7e;
}

.property-title {
    font-size: 14px;
    font-weight: 500;
    margin: 5px 0;
    color: #333;
}

.property-location {
    font-size: 12px;
    color: #666;
    display: flex;
    align-items: center;
}

.property-location i {
    margin-right: 5px;
    font-size: 12px;
}

/* Property Card ในรูปแบบ LivingInsider */
.li-property-card {
    background: white;
    border-radius: 15px;
    margin-bottom: 12px;
    overflow: hidden;
    display: flex;
    cursor: pointer;
    box-shadow: 0 1px 3px rgba(0,0,0,0.08);
    width: 100%;
}

.li-property-left {
    padding: 12px;
    width: 110px;
    min-width: 110px;
}

.li-property-left img {
    width: 100%;
    height: 90px;
    object-fit: cover;
    border-radius: 8px;
}

.li-property-right {
    flex: 1;
    padding: 12px 12px 12px 0;
    position: relative;
}

.li-property-badge {
    position: absolute;
    top: 12px;
    right: 12px;
    background: #6b6b6b;
    color: white;
    font-size: 12px;
    padding: 2px 10px;
    border-radius: 20px;
    display: flex;
    align-items: center;
}

.li-property-badge i {
    margin-right: 3px;
    font-size: 10px;
}

.li-property-title {
    color: #FF9800;
    font-size: 14px;
    font-weight: 500;
    margin-right: 65px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.li-property-code {
    color: #FF9800;
    font-size: 12px;
    margin-top: 2px;
}

.li-property-location {
    font-size: 12px;
    color: #666;
    margin-top: 4px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    display: flex;
    align-items: center;
}

.li-property-location i {
    margin-right: 3px;
    font-size: 10px;
}

.li-property-price {
    font-size: 18px;
    font-weight: bold;
    color: #333;
    margin-top: 4px;
}

/* List Items */
.rich-content.list-container {
    border: 1px solid #e0e0e0;
    border-radius: 8px;
    overflow: hidden;
}

.list-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 15px;
    border-bottom: 1px solid #f0f0f0;
    cursor: pointer;
}

.list-item:last-child {
    border-bottom: none;
}

.list-item:hover {
    background-color: #f9f9f9;
}

.list-item-content {
    flex: 1;
}

.list-item-title {
    font-size: 14px;
    font-weight: 500;
    color: #333;
}

.list-item-subtitle {
    font-size: 12px;
    color: #666;
    margin-top: 3px;
}

.list-item-icon {
    color: #999;
}

/* Image Container */
.rich-content.image-container {
    text-align: center;
    margin: 10px 0;
}

.rich-content.image-container img {
    max-width: 100%;
    border-radius: 8px;
    box-shadow: 0 2px 5px rgba(0,0,0,0.1);
}

/* Admin Status Indicator */
.admin-status-indicator {
    background-color: #4b3f3a;
    color: white;
    padding: 8px 0;
    font-size: 12px;
    text-align: center;
    width: 100%;
    position: relative;
    margin: -10px 0 10px 0;
    border-radius: 0 0 12px 12px;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
    animation: fadeIn 0.3s ease;
}

.admin-status-indicator.active {
    background-color: #2bbd7e;
}

.admin-status-indicator::before {
    content: "";
    display: inline-block;
    width: 8px;
    height: 8px;
    background-color: #4caf50;
    border-radius: 50%;
    margin-right: 5px;
    animation: pulse 1.5s infinite;
}

/* Admin Status Button */
.admin-status-btn {
    padding: 8px 15px;
    font-size: 13px;
    border-radius: 20px;
    cursor: pointer;
    transition: all 0.3s;
    border: 1px solid #ddd;
    background-color: #f5f5f5;
    color: #333;
}

.admin-status-btn.active {
    background-color: #5e35b1;
    border-color: #5e35b1;
    color: white;
}

.admin-status-btn:hover {
    opacity: 0.9;
}

/* Animation */
@keyframes fadeIn {
    from { opacity: 0; transform: translateY(-10px); }
    to { opacity: 1; transform: translateY(0); }
}

@keyframes pulse {
    0% {
        opacity: 0.4;
        transform: scale(0.9);
    }
    50% {
        opacity: 1;
        transform: scale(1.1);
    }
    100% {
        opacity: 0.4;
        transform: scale(0.9);
    }
}

/* System Messages */
.message.system-message {
    display: flex;
    justify-content: center;
    margin: 10px 0;
    max-width: 100%;
}

.message-content.system-notification {
    background-color: rgba(94, 53, 177, 0.1);
    color: #5e35b1;
    padding: 6px 12px;
    border-radius: 15px;
    text-align: center;
    font-size: 12px;
}

/* Loading and Error Messages */
.loading-message, .error-message, .empty-message {
    text-align: center;
    padding: 20px;
    color: #666;
    background: #f9f9f9;
    border-radius: 8px;
    margin: 20px 0;
}

.error-message {
    color: #e53935;
    background: rgba(229, 57, 53, 0.1);
}

.empty-message {
    color: #9e9e9e;
    background: #f5f5f5;
}
`;
        document.head.appendChild(styleElement);
        console.log('Admin chat styles added to page');
    }

    // ตั้งค่าตัวจัดการข้อความ
    function setupMessageHandler() {
        window.handleIncomingMessage = function(data) {
            console.log('Handling incoming message:', data);

            // ถ้ามีฟังก์ชันสำหรับการจัดการข้อความใน state.socket.on แล้ว จะออกจากฟังก์ชันนี้
            if (window.socketMessageHandled) {
                console.log('Message already handled by socket.on event');
                return;
            }

            // ตรวจสอบว่าเป็นข้อความในห้องที่กำลังดูอยู่หรือไม่
            const currentSessionId = document.querySelector('#adminChatMessages')?.dataset?.sessionId;
            if (data.room === currentSessionId) {
                console.log('Message is for current room, displaying...');

                // เรียกใช้ฟังก์ชันจัดการข้อความตามประเภทผู้ส่ง
                if (data.sender === 'user') {
                    if (window.addMessage) {
                        window.addMessage('user', data.text, '', data.timestamp);
                    }
                } else if (data.sender === 'bot') {
                    if (data.payload) {
                        if (window.addBotMessageWithPayload) {
                            window.addBotMessageWithPayload(data);
                        }
                    } else if (window.addMessage) {
                        window.addMessage('bot', data.text, '', data.timestamp);
                    }
                } else if (data.sender === 'admin') {
                    if (window.addMessage) {
                        window.addMessage('admin', data.text, data.adminName || '', data.timestamp);
                    }
                }
            } else {
                console.log('Message is for a different room:', data.room);

                // อัพเดตรายการการสนทนาถ้ามีการแสดงอยู่
                if (window.loadConversations) {
                    window.loadConversations();
                }
            }
        };
    }

    // สร้างฟังก์ชันเริ่มต้น
    function init() {
        console.log('Admin Chat Enhancer initializing...');

        // เพิ่ม CSS
        addAdminChatStyles();

        // ตั้งค่าตัวจัดการข้อความ
        setupMessageHandler();

        // แสดงข้อความประสบความสำเร็จ
        console.log('Admin Chat Enhancer initialized successfully');
    }

    // รันฟังก์ชันเริ่มต้นเมื่อหน้าเว็บโหลดเสร็จ
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
