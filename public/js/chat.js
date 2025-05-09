/**
 * ปรับปรุง LiveChat Bot Widget
 * เปลี่ยนจาก PieSocket มาใช้ Socket.IO
 */
(function () {
    // การกำหนดองค์ประกอบ DOM
    const elements = {
        chatToggleBtn: document.getElementById('chat-toggle-btn'),
        chatWindow: document.getElementById('chat-window'),
        chatMessages: document.getElementById('chat-messages'),
        chatInput: document.getElementById('chat-input'),
        chatSendBtn: document.getElementById('chat-send-btn'),
        chatNowBtn: document.getElementById('chat-now-btn'),
        chatInputArea: document.getElementById('chat-input-area'),
        chatMinimizeBtn: document.querySelector('.chat-minimize-btn'),
        socketStatus: document.getElementById('socket-status'), // สถานะการเชื่อมต่อ Socket.IO
        adminStatusIndicator: document.createElement('div') // สร้าง element ใหม่สำหรับแสดงสถานะแอดมิน

    };

    // สถานะการแชท
const chatState = {
    isOpen: false,
    sessionId: generateSessionId(),
    socket: null,
    adminActive: false,  // เพิ่มสถานะการทำงานของแอดมิน
    lastMessageSender: null // เพิ่มเพื่อติดตามว่าใครส่งข้อความล่าสุด
};

    // การลงทะเบียนตัวจัดการเหตุการณ์
    function setupEventListeners() {
        elements.chatToggleBtn.addEventListener('click', toggleChat);
        elements.chatMinimizeBtn.addEventListener('click', toggleChat);
        elements.chatSendBtn.addEventListener('click', sendMessage);

        // ถ้า chatNowBtn มีอยู่
        if (elements.chatNowBtn) {
            elements.chatNowBtn.addEventListener('click', startChat);
        }

        // จัดการการส่งข้อความด้วย Enter
        elements.chatInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                sendMessage();
            }
        });

        // เพิ่ม Event Listeners สำหรับการคลิก chip
        document.addEventListener('click', function(e) {
            if (e.target.classList.contains('chip')) {
                handleChipClick(e.target);
            }
        });
    }

    // เพิ่มฟังก์ชันตรวจสอบข้อความซ้ำ
    function isMessageDuplicate(messageId) {
        return document.querySelector(`.message[data-message-id="${messageId}"]`) !== null;
    }

    // เชื่อมต่อกับ Socket.IO
function connectSocket() {
    // ตรวจสอบว่า Socket.IO ถูกโหลดแล้วหรือไม่
    if (typeof io === 'undefined') {
        console.error('Socket.IO library not loaded! Make sure to include the Socket.IO client script.');
        return false;
    }

    try {
        // เชื่อมต่อ Socket.IO
        const socketUrl = window.location.hostname === 'localhost' ?
                          'http://localhost:3000' :
                          window.location.origin;

        // ตรวจสอบว่ามีการเชื่อมต่ออยู่แล้วหรือไม่
        if (chatState.socket && chatState.socket.connected) {
            console.log('Socket is already connected:', chatState.socket.id);
            return true;
        }

        // สร้างการเชื่อมต่อใหม่
        chatState.socket = io(socketUrl, {
            reconnectionAttempts: 5,
            reconnectionDelay: 1000,
            timeout: 10000
        });

        // เมื่อเชื่อมต่อสำเร็จ
        chatState.socket.on('connect', () => {
            console.log('Connected to Socket.IO with ID:', chatState.socket.id);

            // เข้าร่วมห้องแชทตาม sessionId
            chatState.socket.emit('join', chatState.sessionId);

            // อัปเดตสถานะการเชื่อมต่อ (ถ้ามี)
            if (elements.socketStatus) {
                elements.socketStatus.textContent = 'Connected';
                elements.socketStatus.classList.add('connected');
                elements.socketStatus.classList.remove('disconnected');
            }
        });

        // เมื่อมีข้อความใหม่จากเซิร์ฟเวอร์
        chatState.socket.on('new_message', (message) => {
            console.log('New message received via socket:', message);

            // เช็คว่าเป็นข้อความที่แสดงไปแล้วหรือไม่
            if (isMessageDuplicate(message.timestamp)) {
                console.log('Duplicate message from socket, ignoring:', message);
                return;
            }

            // แสดงข้อความตามประเภท
            if (message.sender === 'admin') {
                // ข้อความจากแอดมิน
                const messageElement = document.createElement('div');
                messageElement.className = 'message bot-message';
                messageElement.setAttribute('data-message-id', message.timestamp);
                messageElement.innerHTML = `
                    <div class="message-avatar">
                        <img src="assets/icons/chat-avatar.jpg" alt="Admin">
                    </div>
                    <div class="message-content admin-message">
                        <p>${escapeHTML(message.text)}</p>
                        <small>${escapeHTML(message.adminName || 'Admin')}</small>
                    </div>
                `;

                elements.chatMessages.appendChild(messageElement);
                scrollToBottom();
            }
            else if (message.sender === 'bot') {
                // ข้อความจากบอท

                // จัดการกับ payload ถ้ามี
                if (message.payload) {
                    const richContentHtml = processRichContent(message.payload);

                    if (richContentHtml) {
                        const messageElement = document.createElement('div');
                        messageElement.className = 'message bot-message';
                        messageElement.setAttribute('data-message-id', message.timestamp);
                        messageElement.innerHTML = `
                            <div class="message-avatar">
                                <img src="assets/icons/chat-avatar.jpg" alt="Bot">
                            </div>
                            <div class="message-content">
                                ${richContentHtml}
                            </div>
                        `;

                        elements.chatMessages.appendChild(messageElement);
                        addInteractiveListeners(messageElement);
                        scrollToBottom();
                    }
                } else if (message.text) {
                    // ถ้ามีข้อความธรรมดา
                    addMessage('bot', message.text, '', message.timestamp);
                }
            }
        });

        // รับการแจ้งเตือนผลการค้นหาอสังหาริมทรัพย์
        chatState.socket.on('property_search_results', (data) => {
            console.log('Property search results received:', data);

            // ตรวจสอบว่ามีข้อมูลหรือไม่
            if (data.success && data.data) {
                // ขณะนี้เซิร์ฟเวอร์จะส่งข้อความผ่าน new_message อยู่แล้ว
                // แต่เราอาจต้องการทำอะไรเพิ่มเติมกับข้อมูลค้นหาที่นี่
                console.log('Search successful - results will be displayed via new_message event');
            } else {
                console.log('No search results found');
            }
        });

        // เมื่อมีการอัปเดตสถานะแอดมิน
        chatState.socket.on('admin_status_change', (data) => {
            console.log('Admin status changed:', data);

            // อัปเดตสถานะแอดมิน
            chatState.adminActive = data.adminActive;

            // แสดงสถานะในแชท
            updateAdminStatusDisplay(data.adminActive, data.adminName);

            // เพิ่มข้อความแจ้งเตือนในแชท
            const message = data.adminActive
                ? `${data.adminName || 'แอดมิน'}กำลังให้บริการคุณ`
                : 'แชทบอทกลับมาให้บริการแล้ว';

            addMessage('system', message, '', Date.now());
        });

        // เมื่อตัดการเชื่อมต่อ
        chatState.socket.on('disconnect', () => {
            console.log('Disconnected from Socket.IO');

            // อัปเดตสถานะการเชื่อมต่อ (ถ้ามี)
            if (elements.socketStatus) {
                elements.socketStatus.textContent = 'Disconnected';
                elements.socketStatus.classList.add('disconnected');
                elements.socketStatus.classList.remove('connected');
            }
        });

        // เมื่อกำลังพยายามเชื่อมต่อใหม่
        chatState.socket.on('reconnecting', (attemptNumber) => {
            console.log(`Attempting to reconnect (${attemptNumber})...`);

            if (elements.socketStatus) {
                elements.socketStatus.textContent = `Reconnecting (${attemptNumber})`;
                elements.socketStatus.classList.add('disconnected');
            }
        });

        // เมื่อเชื่อมต่อใหม่สำเร็จ
        chatState.socket.on('reconnect', () => {
            console.log('Reconnected successfully');

            // เข้าร่วมห้องแชทอีกครั้ง
            chatState.socket.emit('join', chatState.sessionId);

            if (elements.socketStatus) {
                elements.socketStatus.textContent = 'Connected';
                elements.socketStatus.classList.add('connected');
                elements.socketStatus.classList.remove('disconnected');
            }
        });

        // เมื่อเกิดข้อผิดพลาดในการเชื่อมต่อ
        chatState.socket.on('connect_error', (error) => {
            console.error('Socket.IO connection error:', error);

            // อัปเดตสถานะการเชื่อมต่อ (ถ้ามี)
            if (elements.socketStatus) {
                elements.socketStatus.textContent = 'Connection Error';
                elements.socketStatus.classList.add('disconnected');
                elements.socketStatus.classList.remove('connected');
            }
        });

        console.log('Socket.IO initialized, waiting for connection...');
        return true;
    } catch (error) {
        console.error('Error connecting to Socket.IO:', error);
        return false;
    }
}

function setupAdminStatusIndicator() {
    elements.adminStatusIndicator.className = 'admin-status-indicator';
    elements.adminStatusIndicator.style.display = 'none';

    // เพิ่มเข้าไปใน chat header
    const chatHeader = document.querySelector('.chat-header');
    if (chatHeader) {
        chatHeader.appendChild(elements.adminStatusIndicator);
    }
}
// ฟังก์ชันอัปเดตการแสดงสถานะแอดมิน
function updateAdminStatusDisplay(isActive, adminName) {
    if (!elements.adminStatusIndicator) return;

    if (isActive) {
        elements.adminStatusIndicator.textContent = `${adminName || 'แอดมิน'}กำลังให้บริการ`;
        elements.adminStatusIndicator.style.display = 'block';
        elements.adminStatusIndicator.classList.add('active');
    } else {
        elements.adminStatusIndicator.style.display = 'none';
        elements.adminStatusIndicator.classList.remove('active');
    }
}
    // สลับหน้าต่างแชท
    function toggleChat() {
        chatState.isOpen = !chatState.isOpen;
        elements.chatWindow.style.display = chatState.isOpen ? 'flex' : 'none';
        elements.chatToggleBtn.style.display = chatState.isOpen ? 'none' : 'flex';

        if (chatState.isOpen) {
            elements.chatWindow.classList.add('fade-in');

            // เชื่อมต่อกับ Socket.IO เมื่อเปิดแชท
            if (!chatState.socket) {
                connectSocket();
            } else if (chatState.socket.disconnected) {
                // ลองเชื่อมต่อใหม่ถ้าขาดการเชื่อมต่อ
                chatState.socket.connect();
            }
        }
    }

    // เริ่มการสนทนา
    function startChat() {
        if (elements.chatNowBtn) {
            elements.chatNowBtn.style.display = 'none';
        }

        if (elements.chatInputArea) {
            elements.chatInputArea.classList.remove('hidden');
        }

        elements.chatInput.focus();
    }

    // จัดการการคลิก chip
    function handleChipClick(chipElement) {
        const clickText = chipElement.dataset.text;
        if (!clickText) return;

        // กรณีคลิกค้นหาอสังหาริมทรัพย์
        if (clickText === "ค้นหาอสังหาริมทรัพย์") {
            // แสดงข้อความผู้ใช้
            const messageId = Date.now();
            addMessage('user', clickText, '', messageId);

            // เรียกใช้ Socket.IO เพื่อค้นหาอสังหาริมทรัพย์โดยตรง
            if (chatState.socket && chatState.socket.connected) {
                chatState.socket.emit('request_property_search', {
                    sessionId: chatState.sessionId,
                    searchData: null, // ใช้ข้อมูลที่เก็บไว้ใน session
                    timestamp: messageId
                });

                // แสดงข้อความกำลังค้นหา
                const loadingMessageId = Date.now() + 1;
                addMessage('bot', 'กำลังค้นหาอสังหาริมทรัพย์ตามเงื่อนไขของคุณ...', '', loadingMessageId);
            } else {
                // ถ้าไม่มีการเชื่อมต่อ Socket.IO ให้ส่งไปที่ Dialogflow ตามปกติ
                sendToDialogflow(clickText, chatState.sessionId, messageId)
                    .then(handleDialogflowResponse)
                    .catch(handleDialogflowError);
            }
        } else {
            // กรณีคลิก chip อื่นๆ ที่ไม่ใช่การค้นหา
            const messageId = Date.now();
            addMessage('user', clickText, '', messageId);

            sendToDialogflow(clickText, chatState.sessionId, messageId)
                .then(handleDialogflowResponse)
                .catch(handleDialogflowError);
        }
    }



function addSystemMessage(text) {
    const messageElement = document.createElement('div');
    messageElement.className = 'message system-message';
    messageElement.innerHTML = `
        <div class="message-content system-notification">
            <p>${escapeHTML(text)}</p>
        </div>
    `;
    elements.chatMessages.appendChild(messageElement);
    scrollToBottom();
}

    // ส่งข้อความ
   function sendMessage() {
       const message = elements.chatInput.value.trim();
       if (!message) return;

       const messageId = Date.now();

       // แสดงข้อความผู้ใช้
       addMessage('user', message, '', messageId);
       chatState.lastMessageSender = 'user';

       // เคลียร์ช่องข้อความ
       elements.chatInput.value = '';

       // ถ้าแอดมินกำลังแอคทีฟ ให้ส่งข้อความผ่าน Socket.IO แต่ไม่ต้องส่งไป Dialogflow
       if (chatState.adminActive) {
           if (chatState.socket && chatState.socket.connected) {
               chatState.socket.emit('new_message', {
                   sender: 'user',
                   text: message,
                   timestamp: messageId,
                   room: chatState.sessionId
               });
           }
       } else {
           // ส่งข้อความไปยัง Dialogflow ถ้าแอดมินไม่ได้แอคทีฟ
           sendToDialogflow(message, chatState.sessionId, messageId)
               .then(handleDialogflowResponse)
               .catch(handleDialogflowError);
       }
   }

    // จัดการข้อผิดพลาดจาก Dialogflow
    function handleDialogflowError(error) {
        console.error('เกิดข้อผิดพลาดในการเชื่อมต่อ:', error);
        addMessage('bot', 'ขออภัย มีปัญหาในการเชื่อมต่อกับระบบ โปรดลองอีกครั้งในภายหลัง');
    }

    // เพิ่มข้อความลงในช่องแชท
    function addMessage(sender, text, senderName = '', messageId = null) {
        const timestamp = messageId || Date.now();

        // ตรวจสอบว่ามีข้อความนี้อยู่แล้วหรือไม่
        if (isMessageDuplicate(timestamp)) {
            console.log('Duplicate message, not adding:', text);
            return;
        }

        const messageElement = document.createElement('div');
        messageElement.className = `message ${sender}-message`;
        messageElement.setAttribute('data-message-id', timestamp);
        messageElement.innerHTML = `
            <div class="message-avatar">
                ${sender === 'user'
                ? '<i class="fa-solid fa-user"></i>'
                : '<img src="assets/icons/chat-avatar.jpg" alt="Bot">'
            }
            </div>
            <div class="message-content">
                <p>${escapeHTML(text)}</p>
            </div>
        `;
        elements.chatMessages.appendChild(messageElement);
        scrollToBottom();

        // ถ้าเป็นข้อความจากผู้ใช้และมีการเชื่อมต่อ Socket.IO
        if (sender === 'user' && chatState.socket && chatState.socket.connected) {
            chatState.socket.emit('new_message', {
                sender: 'user',
                text: text,
                timestamp: timestamp,
                room: chatState.sessionId
            });
        }
    }

    // ป้องกันการโจมตีแบบ XSS
    function escapeHTML(unsafe) {
        if (!unsafe) return '';
        return unsafe
            .toString()
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    /**
     * จัดการการตอบกลับจาก Dialogflow และแสดงผล
     * @param {Object} response - ข้อมูลการตอบกลับจาก Dialogflow
     */
    function handleDialogflowResponse(response) {
        console.log('Handling Dialogflow response:', response);

//        // แสดงข้อความตอบกลับ
//        if (response.message) {
//            // ใช้ messageId จากฝั่ง server ถ้ามี
//            const botMessageId = response.messageId || Date.now();
//            addMessage('bot', response.message, '', botMessageId);
//        }

        // จัดการ Rich Content
        if (response.payload) {
            console.log('Processing payload:', response.payload);
            const richContentHtml = processRichContent(response.payload);

            if (richContentHtml) {
                console.log('Rich content HTML generated:', richContentHtml);
                const payloadMessageId = (response.messageId ? response.messageId + 1 : Date.now()) + 1;

                // ตรวจสอบว่ามีข้อความนี้อยู่แล้วหรือไม่
                if (isMessageDuplicate(payloadMessageId)) {
                    console.log('Duplicate rich content, not adding');
                    return;
                }

                const messageElement = document.createElement('div');
                messageElement.className = 'message bot-message';
                messageElement.setAttribute('data-message-id', payloadMessageId);
                messageElement.innerHTML = `
                    <div class="message-avatar">
                        <img src="assets/icons/chat-avatar.jpg" alt="Bot">
                    </div>
                    <div class="message-content">
                        ${richContentHtml}
                    </div>
                `;

                // เพิ่มลงใน DOM
                elements.chatMessages.appendChild(messageElement);

                // เพิ่ม Event Listeners สำหรับองค์ประกอบแบบโต้ตอบ
                addInteractiveListeners(messageElement);

                scrollToBottom();
            }
        }
    }

    // ฟังก์ชันย่อยสำหรับการแสดงผล Rich Content
    function renderInfoCard(item) {
        return `
            <div class="rich-content info-card">
                <h4>${escapeHTML(item.title || '')}</h4>
                <p>${escapeHTML(item.subtitle || '')}</p>
            </div>
        `;
    }

    function renderChips(item) {
        return `
            <div class="rich-content chips-container">
                ${item.options.map(option => `
                    <div class="chip" data-text="${escapeHTML(option.text)}">
                        ${escapeHTML(option.text)}
                    </div>
                `).join('')}
            </div>
        `;
    }

    function renderImage(item) {
        return `
        <div class="rich-content image-container">
            <img src="${escapeHTML(item.rawUrl)}"
                 alt="${escapeHTML(item.accessibilityText || 'Image')}"
                 data-text="${escapeHTML(item.title || item.accessibilityText || 'Image')}"
                 style="max-width:100%; cursor: pointer;">
        </div>
    `;
    }

    function renderButton(item) {
        // ตรวจสอบว่ามีโครงสร้างแบบใหม่ (มี options array) หรือไม่
        if (item.options && Array.isArray(item.options)) {
            return `
                <div class="rich-content button-container">
                    ${item.options.map(option => {
                // ตรวจสอบว่ามี icon และ color หรือไม่
                const icon = option.icon ? `<i class="fa-solid fa-${escapeHTML(option.icon)}"></i>` : '';
                const colorClass = option.color ? `chat-btn-${escapeHTML(option.color)}` : 'chat-btn-primary';
                const buttonText = option.text || "Button";

                return `
                            <button class="chat-btn ${colorClass}" data-text="${escapeHTML(buttonText)}">
                                ${icon} ${escapeHTML(buttonText)}
                            </button>
                        `;
            }).join('')}
                </div>
            `;
        }
        // โครงสร้างแบบเดิม (มี text โดยตรง)
        else {
            // ตรวจสอบว่ามี icon และ color หรือไม่
            const icon = item.icon ? `<i class="fa-solid fa-${escapeHTML(item.icon)}"></i>` : '';
            const colorClass = item.color ? `chat-btn-${escapeHTML(option.color)}` : 'chat-btn-primary';
            const buttonText = item.text || "Button";

            return `
                <div class="rich-content button-container">
                    <button class="chat-btn ${colorClass}" data-text="${escapeHTML(buttonText)}">
                        ${icon} ${escapeHTML(buttonText)}
                    </button>
                </div>
            `;
        }
    }

    function renderList(item) {
        return `
            <div class="rich-content list-container">
                ${item.items.map(listItem => `
                    <div class="list-item" data-text="${escapeHTML(listItem.title)}">
                        <div class="list-item-content">
                            <div class="list-item-title">${escapeHTML(listItem.title || '')}</div>
                            <div class="list-item-subtitle">${escapeHTML(listItem.subtitle || '')}</div>
                        </div>
                        <div class="list-item-icon">
                            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M9 18l6-6-6-6"/>
                            </svg>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
    }

    function renderPropertyList(properties) {
        return `
            <div class="property-list">
                ${properties.map(property => {
            // จัดการวันที่ (ถ้ามี)
            const dateDisplay = property.date ? property.date : '';
            // จัดการจำนวนการดู (ถ้ามี)
            const viewsDisplay = property.views ? property.views : '';
            // สร้างข้อความสำหรับส่งเมื่อคลิก
            const clickText = `ขอดูรายละเอียดของอสังหาริมทรัพย์ ${property.id}`;

            return `
                    <div class="property-card" data-property-id="${property.id}" data-text="${escapeHTML(clickText)}">
                        <div class="property-image">
                            <img src="${property.imageUrl}" alt="${property.title}">
                            <div class="property-badge">ขาย</div>
                            ${(dateDisplay || viewsDisplay) ? `
                            <div class="property-date-views">
                                ${dateDisplay ? `<div class="property-date">${dateDisplay}</div>` : ''}
                                ${viewsDisplay ? `
                                <div class="property-views">
                                    <i class="fa-solid fa-eye"></i> ${viewsDisplay}
                                </div>
                                ` : ''}
                            </div>
                            ` : ''}
                        </div>
                        <div class="property-info">
                            <div class="property-price">฿${property.price.toLocaleString()}</div>
                            <div class="property-title">${property.title}</div>
                            <div class="property-location">
                                <i class="fa-solid fa-location-dot"></i> ${property.location}
                            </div>
                            <div class="property-amenities">
                                <div class="amenity-item">
                                    <i class="fa-solid fa-chart-area"></i>
                                    <span>${property.area} ตร.ว.</span>
                                </div>
                                <div class="amenity-item">
                                    <i class="fa-solid fa-layer-group"></i>
                                    <span>ชั้น ${property.floors}</span>
                                </div>
                                <div class="amenity-item">
                                    <i class="fa-solid fa-bed"></i>
                                    <span>${property.bedrooms} ห้องนอน</span>
                                </div>
                                <div class="amenity-item">
                                    <i class="fa-solid fa-bath"></i>
                                    <span>${property.bathrooms} ห้องน้ำ</span>
                                </div>
                            </div>
                        </div>
                    </div>
                    `;
        }).join('')}
            </div>
        `;
    }

    /**
     * ประมวลผล Rich Content จาก Dialogflow
     * @param {Object} payload - Payload จาก Dialogflow
     * @returns {string} - HTML สำหรับแสดง Rich Content
     */
function processRichContent(payload) {
    if (!payload.richContent || payload.richContent.length === 0) return '';

    const richContent = payload.richContent[0];
    let richContentHTML = '';

    // ประมวลผลแต่ละประเภทของ Rich Content
    richContent.forEach(item => {
        switch (item.type) {
            case 'property_list':
                richContentHTML += renderPropertyList(item.properties);
                break;
            case 'info':
                richContentHTML += renderInfoCard(item);
                break;
            case 'chips':
                richContentHTML += renderChips(item);
                break;
            case 'image':
                richContentHTML += renderImage(item);
                break;
            case 'button':
                richContentHTML += renderButton(item);
                break;
            case 'list':
                richContentHTML += renderList(item);
                break;
            case 'custom_card':
                richContentHTML += renderPropertyCard(item.property_data);
                break;
            default:
                console.log('Unknown rich content type:', item.type);
        }
    });

    return richContentHTML;
}

function renderPropertyCard(property) {
  // กำหนดประเภท tag (เช่า หรือ ขาย)
  const tagType = property.tag && property.tag.toLowerCase().includes('เช่า') ? 'เช่า' : 'ขาย';
  const tagClass = tagType === 'เช่า' ? 'rent-tag' : 'buy-tag';

  // กำหนดสไตล์ตามรูปแบบที่ต้องการ
  return `
    <div class="property-li-card" data-property-id="${property.id || ''}" data-text="ขอดูรายละเอียดของ ${property.title || 'อสังหาริมทรัพย์'} เพิ่มเติม">
      <div class="property-li-image">
        <img src="${property.imageUrl || 'assets/images/property-placeholder.jpg'}"
             alt="${property.title || 'อสังหาริมทรัพย์'}">
        <div class="property-li-tag ${tagClass}">${property.tag || 'ขาย'}</div>
      </div>
      <div class="property-li-info">
        <div class="property-li-title">${property.tag || 'ขาย'} ${property.title || 'ไม่มีชื่อ'}</div>
        <div class="property-li-location">
          <i class="fas fa-map-marker-alt"></i> ${property.location || 'ไม่ระบุที่ตั้ง'}
        </div>
        <div class="property-li-price">฿${property.price || '-'}</div>
      </div>
    </div>
  `;
}
    // เพิ่ม Event Listeners สำหรับองค์ประกอบแบบโต้ตอบ
function addInteractiveListeners(richContentElement) {
    console.log('Setting up interactive elements');

    // ปุ่มและ chips
    const buttons = richContentElement.querySelectorAll('.chat-btn, .chip');

    // List Items
    const listItems = richContentElement.querySelectorAll('.list-item');
    listItems.forEach(item => {
        item.addEventListener('click', function() {
            const clickText = this.dataset.text;
            if (clickText) {
                console.log('List item clicked:', clickText);
                const messageId = Date.now();
                addMessage('user', clickText, '', messageId);

                sendToDialogflow(clickText, chatState.sessionId, messageId)
                    .then(handleDialogflowResponse)
                    .catch(handleDialogflowError);
            }
        });
    });

    // Property Cards
    const propertyCards = richContentElement.querySelectorAll('.property-card, .property-li-card');
    propertyCards.forEach(card => {
        card.addEventListener('click', function() {
            const clickText = this.dataset.text;
            const propertyId = this.dataset.propertyId;

            if (clickText) {
                console.log(`Property card clicked: ${clickText} (ID: ${propertyId})`);
                const messageId = Date.now();
                addMessage('user', clickText, '', messageId);

                sendToDialogflow(clickText, chatState.sessionId, messageId)
                    .then(handleDialogflowResponse)
                    .catch(handleDialogflowError);
            } else if (propertyId) {
                // ถ้าไม่มี clickText แต่มี propertyId
                const defaultText = `ขอดูรายละเอียดของอสังหาริมทรัพย์ ${propertyId}`;
                console.log(`Property card clicked with ID: ${propertyId}`);
                const messageId = Date.now();
                addMessage('user', defaultText, '', messageId);

                sendToDialogflow(defaultText, chatState.sessionId, messageId)
                    .then(handleDialogflowResponse)
                    .catch(handleDialogflowError);
            }
        });
    });
}
    // เลื่อนไปยังข้อความล่าสุด
    function scrollToBottom() {
        elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;
    }

    // สร้าง Session ID แบบสุ่ม
    function generateSessionId() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
            const r = Math.random() * 16 | 0;
            return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
        });
    }

    // เริ่มการทำงานของสคริปต์
    function init() {
        console.log('Initializing chat with session ID:', chatState.sessionId);
        setupEventListeners();
        setupAdminStatusIndicator(); // เพิ่มการตั้งค่า indicator

        // พยายามเชื่อมต่อกับ Socket.IO
        if (typeof io !== 'undefined') {
            connectSocket();
        } else {
            console.log('Socket.IO library not available, will attempt to connect when chat is opened');
        }
    }
    function addAdminStatusStyles() {
        const style = document.createElement('style');
        style.textContent = `
            .admin-status-indicator {
                position: absolute;
                top: 50px;
                left: 0;
                right: 0;
                text-align: center;
                background-color: #6F6158;
                color: white;
                padding: 5px 0;
                font-size: 12px;
                z-index: 10;
                border-bottom: 1px solid rgba(255,255,255,0.1);
            }

            .message.system-message {
                display: flex;
                justify-content: center;
                margin: 10px 0;
                max-width: 100%;
            }

            .message-content.system-notification {
                background-color: rgba(111, 97, 88, 0.1);
                color: #6F6158;
                padding: 5px 10px;
                border-radius: 10px;
                text-align: center;
                font-size: 12px;
            }
        `;
        document.head.appendChild(style);
    }

    // เรียกใช้การเริ่มต้นเมื่อโหลดหน้าเว็บ
    document.addEventListener('DOMContentLoaded', addAdminStatusStyles);
    document.addEventListener('DOMContentLoaded', init);
})();
