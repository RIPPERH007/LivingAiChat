/**
 * LiveChat Bot Widget (ปรับปรุง)
 * ระบบแชทสด สำหรับการสนทนาอัจฉริยะ
 */
(function () {
    // เชื่อมต่อ Socket
    const socket = io('http://localhost:3000');

    // การกำหนดองค์ประกอบ DOM
    const elements = {
        chatToggleBtn: document.getElementById('chat-toggle-btn'),
        chatWindow: document.getElementById('chat-window'),
        chatMessages: document.getElementById('chat-messages'),
        chatInput: document.getElementById('chat-input'),
        chatSendBtn: document.getElementById('chat-send-btn'),
        chatInputArea: document.getElementById('chat-input-area'),
        chatMinimizeBtn: document.querySelector('.chat-minimize-btn')
    };

    // สถานะการแชท
    const chatState = {
        isOpen: false,
        sessionId: generateSessionId()
    };

    // เชื่อมต่อ Socket และลงทะเบียน Session
    socket.on('connect', () => {
        socket.emit('user-connect', chatState.sessionId);
    });

    // การลงทะเบียนตัวจัดการเหตุการณ์
    function setupEventListeners() {
        elements.chatSendBtn.addEventListener('click', sendMessage);

        elements.chatInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                sendMessage();
            }
        });

        if (elements.chatToggleBtn) {
                   elements.chatToggleBtn.addEventListener('click', () => {
                       toggleChat(true);
                   });
               }

               // ตรวจสอบและเพิ่ม Event Listener สำหรับปุ่มปิดแชท
               if (elements.chatMinimizeBtn) {
                   elements.chatMinimizeBtn.addEventListener('click', () => {
                       toggleChat(false);
                   });
               }
        const chips = document.querySelectorAll('.chip');
        chips.forEach(chip => {
            chip.addEventListener('click', handleChipClick);
        });
    }

    // รับข้อความจากแอดมิน
    socket.on('new-admin-message', (data) => {
        addMessage('admin', data.message, data.adminName);
    });

    // ส่งข้อความ
    function sendMessage() {
        const message = elements.chatInput.value.trim();
        if (!message) return;

        addMessage('user', message);

        // ส่งข้อความไปยัง Dialogflow
        sendToDialogflow(message, chatState.sessionId)
            .then(handleDialogflowResponse)
            .catch(handleDialogflowError);

        // ส่งข้อความผ่าน Socket
        socket.emit('user-message', {
            sessionId: chatState.sessionId,
            message: message,
            timestamp: Date.now()
        });

        elements.chatInput.value = '';
    }

    // จัดการการตอบกลับจาก Dialogflow
    function handleDialogflowResponse(response) {
        // แสดงข้อความบอท
        addMessage('bot', response.message);

        // ส่งข้อมูลผ่าน Socket เพื่อให้แอดมินทราบ
        socket.emit('bot-message', {
            sessionId: chatState.sessionId,
            message: response.message,
            payload: response.payload
        });

        // จัดการ Rich Content
        if (response.payload) {
            const richContentHtml = processRichContent(response.payload);
            if (richContentHtml) {
                const messageElement = document.createElement('div');
                messageElement.className = 'message bot-message';
                messageElement.innerHTML = `
                    <div class="message-avatar">
                        <img src="assets/icons/chat-avatar.jpg" alt="Bot">
                    </div>
                    <div class="message-content">
                        ${richContentHtml}
                    </div>
                `;
                elements.chatMessages.appendChild(messageElement);
                scrollToBottom();
            }
        }
    }

    // จัดการการคลิกชิป
    function handleChipClick(event) {
        const clickText = event.target.dataset.text;
        if (clickText) {
            // โชว์ข้อความในช่องแชท
            addMessage('user', clickText);

            // ส่งคำถามไปยัง Dialogflow
            sendToDialogflow(clickText, chatState.sessionId)
                .then(handleDialogflowResponse)
                .catch(handleDialogflowError);
        }
    }

    // สลับหน้าต่างแชท

    function toggleChat(openChat) {
            // อัปเดตสถานะการเปิด/ปิด
            chatState.isOpen = openChat;

            // แสดง/ซ่อนหน้าต่างแชท
            if (elements.chatWindow) {
                elements.chatWindow.style.display = chatState.isOpen ? 'flex' : 'none';
            }

            // ซ่อน/แสดงปุ่มเปิดแชท
            if (elements.chatToggleBtn) {
                elements.chatToggleBtn.style.display = chatState.isOpen ? 'none' : 'flex';
            }

            // เพิ่มเอฟเฟกต์การแสดงผล
            if (chatState.isOpen) {
                elements.chatWindow.classList.add('fade-in');
            }
        }

    // ส่งข้อความ
    function sendMessage() {
        const message = elements.chatInput.value.trim();
        if (!message) return;

        // แสดงข้อความผู้ใช้
        addMessage('user', message);

        // ส่งข้อความไปยัง Dialogflow
        sendToDialogflow(message, chatState.sessionId)
            .then(handleDialogflowResponse)
            .catch(handleDialogflowError);

        // ล้างช่องข้อความ
        elements.chatInput.value = '';
    }

    // จัดการข้อผิดพลาดจาก Dialogflow
    function handleDialogflowError(error) {
        console.error('เกิดข้อผิดพลาดในการเชื่อมต่อ:', error);
        addMessage('bot', 'ขออภัย มีปัญหาในการเชื่อมต่อกับระบบ โปรดลองอีกครั้งในภายหลัง');
    }

    // เพิ่มข้อความลงในช่องแชท
    function addMessage(sender, text) {
        const messageElement = document.createElement('div');
        messageElement.className = `message ${sender}-message`;

        if (sender === 'user') {
            messageElement.innerHTML = `
                <div class="message-content">
                    <p>${escapeHTML(text)}</p>
                </div>
                <div class="message-avatar">
                    <i class="fa-solid fa-user"></i>
                </div>
            `;
        } else {
            messageElement.innerHTML = `
                <div class="message-avatar">
                    <img src="assets/icons/chat-avatar.jpg" alt="Bot">
                </div>
                <div class="message-content">
                    <p>${escapeHTML(text)}</p>
                </div>
            `;
        }

        elements.chatMessages.appendChild(messageElement);
        scrollToBottom();
    }

    // ป้องกันการโจมตีแบบ XSS
    function escapeHTML(unsafe) {
        return unsafe
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
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
            <div class="chips-container">
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
                 style="max-width:100%; border-radius: 8px;">
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
        // โครงสร้างแบบเดิม
        else {
            const icon = item.icon ? `<i class="fa-solid fa-${escapeHTML(item.icon)}"></i>` : '';
            const colorClass = item.color ? `chat-btn-${escapeHTML(item.color)}` : 'chat-btn-primary';
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
            }
        });

        return richContentHTML;
    }

    /**
     * จัดการการตอบกลับจาก Dialogflow และแสดงผล
     * @param {Object} response - ข้อมูลการตอบกลับจาก Dialogflow
     */
    function handleDialogflowResponse(response) {
        console.log('Handling Dialogflow response:', response);

        // แสดงข้อความตอบกลับ
        if (response.message) {
            addMessage('bot', response.message);
        }

        // จัดการ Rich Content
        if (response.payload) {
            console.log('Processing payload:', response.payload);
            const richContentHtml = processRichContent(response.payload);

            if (richContentHtml) {
                console.log('Rich content HTML generated:', richContentHtml);
                const messageElement = document.createElement('div');
                messageElement.className = 'message bot-message';
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

                // เพิ่ม Event Listeners
                addInteractiveListeners(messageElement);

                scrollToBottom();
            }
        }
    }

    // เพิ่ม Event Listeners สำหรับองค์ประกอบแบบโต้ตอบ
    function addInteractiveListeners(richContentElement) {
        // Chips
        const chips = richContentElement.querySelectorAll('.chip');
        chips.forEach(chip => {
            chip.addEventListener('click', function() {
                const clickText = this.dataset.text;
                if (clickText) {
                    addMessage('user', clickText);
                    sendToDialogflow(clickText, chatState.sessionId)
                        .then(handleDialogflowResponse)
                        .catch(handleDialogflowError);
                }
            });
        });

        // Buttons
        const buttons = richContentElement.querySelectorAll('.chat-btn');
        buttons.forEach(button => {
            button.addEventListener('click', function() {
                const clickText = this.dataset.text;
                if (clickText) {
                    addMessage('user', clickText);
                    sendToDialogflow(clickText, chatState.sessionId)
                        .then(handleDialogflowResponse)
                        .catch(handleDialogflowError);
                }
            });
        });

        // List Items
        const listItems = richContentElement.querySelectorAll('.list-item');
        listItems.forEach(item => {
            item.addEventListener('click', function() {
                const clickText = this.dataset.text;
                if (clickText) {
                    addMessage('user', clickText);
                    sendToDialogflow(clickText, chatState.sessionId)
                        .then(handleDialogflowResponse)
                        .catch(handleDialogflowError);
                }
            });
        });

        // Property Cards
        const propertyCards = richContentElement.querySelectorAll('.property-card');
        propertyCards.forEach(card => {
            card.addEventListener('click', function() {
                const clickText = this.dataset.text;
                if (clickText) {
                    addMessage('user', clickText);
                    sendToDialogflow(clickText, chatState.sessionId)
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
        setupEventListeners();
        // ถ้าต้องการเปิดแชทโดยอัตโนมัติเมื่อโหลดหน้า สามารถเพิ่มโค้ดด้านล่างนี้
        // setTimeout(toggleChat, 2000);

        if (elements.chatWindow) {
            elements.chatWindow.style.display = 'none';
        }
    }


// ตรวจสอบว่ามีข้อความจากแอดมินหรือไม่
const checkAdminMessages = setInterval(async () => {
  if (!chatState.sessionId) return;

  try {
    // ดึงข้อมูลการสนทนา
    const response = await fetch(`/api/conversations/${chatState.sessionId}`);
    if (!response.ok) return;

    const data = await response.json();
    if (!data.success) return;

    const conversation = data.conversation;
    const messages = conversation.messages || [];

    // กรองเฉพาะข้อความจากแอดมินที่ยังไม่ได้แสดง
    const adminMessages = messages.filter(msg =>
      msg.sender === 'admin' &&
      !document.querySelector(`[data-message-id="${msg.timestamp}"]`)
    );

    // แสดงข้อความจากแอดมิน
    adminMessages.forEach(msg => {
      addMessage('admin', msg.text, msg.timestamp);
    });
  } catch (error) {
    console.error('Error checking admin messages:', error);
  }
}, 5000); // ตรวจสอบทุก 5 วินาที

// ปรับปรุงฟังก์ชัน addMessage ให้รองรับข้อความจากแอดมิน
function addMessage(sender, text, messageId) {
  const messageElement = document.createElement('div');
  messageElement.className = `message ${sender}-message`;
  messageElement.setAttribute('data-message-id', messageId || Date.now());

  if (sender === 'user') {
    messageElement.innerHTML = `
      <div class="message-content">
        <p>${escapeHTML(text)}</p>
      </div>
      <div class="message-avatar">
        <i class="fa-solid fa-user"></i>
      </div>
    `;
  } else if (sender === 'admin') {
    messageElement.innerHTML = `
      <div class="message-avatar">
        <img src="assets/icons/admin-avatar.jpg" alt="Admin">
      </div>
      <div class="message-content admin-message">
        <p>${escapeHTML(text)}</p>
        <small>แอดมิน</small>
      </div>
    `;
  } else {
    messageElement.innerHTML = `
      <div class="message-avatar">
        <img src="assets/icons/chat-avatar.jpg" alt="Bot">
      </div>
      <div class="message-content">
        <p>${escapeHTML(text)}</p>
      </div>
    `;
  }

  elements.chatMessages.appendChild(messageElement);
  scrollToBottom();
}
    // เรียกใช้การเริ่มต้นเมื่อโหลดหน้าเว็บ
    document.addEventListener('DOMContentLoaded', init);
})();
