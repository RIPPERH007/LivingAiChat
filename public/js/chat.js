/**
 * LiveChat Bot Widget
 * ระบบแชทสด สำหรับการสนทนาอัจฉริยะ
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
        chatMinimizeBtn: document.querySelector('.chat-minimize-btn')
    };

    // สถานะการแชท
    const chatState = {
        isOpen: false,
        sessionId: generateSessionId()
    };

    // การลงทะเบียนตัวจัดการเหตุการณ์
    function setupEventListeners() {
        elements.chatToggleBtn.addEventListener('click', toggleChat);
        elements.chatMinimizeBtn.addEventListener('click', toggleChat);
        elements.chatSendBtn.addEventListener('click', sendMessage);
        elements.chatNowBtn.addEventListener('click', startChat);

        // จัดการการส่งข้อความด้วย Enter
        elements.chatInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                sendMessage();
            }
        });
    }

    // สลับหน้าต่างแชท
    function toggleChat() {
        chatState.isOpen = !chatState.isOpen;
        elements.chatWindow.style.display = chatState.isOpen ? 'flex' : 'none';
        elements.chatToggleBtn.style.display = chatState.isOpen ? 'none' : 'flex';

        if (chatState.isOpen) {
            elements.chatWindow.classList.add('fade-in');
        }
    }

    // เริ่มการสนทนา
    function startChat() {
        elements.chatNowBtn.style.display = 'none';
        elements.chatInputArea.classList.remove('hidden');
        elements.chatInput.focus();
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
        messageElement.innerHTML = `
            <div class="message-avatar">
                ${sender === 'user'
                ? '<i class="fa-solid fa-user"></i>'
                : '<img src="assets/icons/bot-avatar.jpg" alt="Bot">'
            }
            </div>
            <div class="message-content">
                <p>${escapeHTML(text)}</p>
            </div>
        `;
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
        const clickText = item.title || item.accessibilityText || 'Card';

        return `
            <div class="rich-content info-card">
                <h4>${escapeHTML(item.title || '')}</h4>
                <p>${escapeHTML(item.subtitle || '')}</p>
            </div>
        `;
    }

    function renderChips(item) {
        const clickText = item.title || item.accessibilityText || 'Chip';

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
        const clickText = item.title || item.accessibilityText || 'Image';
        return `
        <div class="rich-content image-container">
            <img src="${escapeHTML(item.rawUrl)}"
                 alt="${escapeHTML(item.accessibilityText || 'Image')}"
                 data-text="${escapeHTML(clickText)}"
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
                            <button class="chat-btn ${colorClass}" data-text="${escapeHTML(buttonText)}" onclick="handleButtonClick(this)">
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
            const colorClass = item.color ? `chat-btn-${escapeHTML(item.color)}` : 'chat-btn-primary';
            const buttonText = item.text || "Button";

            return `
                <div class="rich-content button-container">
                    <button class="chat-btn ${colorClass}" data-text="${escapeHTML(buttonText)}" onclick="handleButtonClick(this)">
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

    // เพิ่มฟังก์ชันนี้ในขอบเขตที่สามารถเข้าถึงได้ทั่วไป (global scope)
    function handleButtonClick(button) {
        console.log('Button clicked via inline handler');
        const clickText = button.dataset.text;
        if (clickText) {
            console.log('Sending text:', clickText);
            addMessage('user', clickText);

            const sessionId = chatState.sessionId;
            sendToDialogflow(clickText, sessionId)
                .then(handleDialogflowResponse)
                .catch(handleDialogflowError);
        } else {
            console.error('No text data found in button');
        }
    }

    // เพิ่ม Event Listeners สำหรับองค์ประกอบแบบโต้ตอบ
    function addInteractiveListeners(richContentElement) {
        console.log('Setting up event listeners for interactive elements');

        // Chips
        const chips = richContentElement.querySelectorAll('.chip');
        console.log('Found', chips.length, 'chips');
        chips.forEach(chip => {
            chip.addEventListener('click', handleInteractiveClick);
        });

        // ปรับเปลี่ยนตัวเลือกให้ทำงานกับทั้ง class เก่าและใหม่
        const buttons = richContentElement.querySelectorAll('.rich-button, .chat-btn');
        console.log('Found', buttons.length, 'buttons');
        buttons.forEach(button => {
            button.addEventListener('click', handleInteractiveClick);
            console.log('Added click event to button:', button.textContent.trim());
        });

        // List Items
        const listItems = richContentElement.querySelectorAll('.list-item');
        console.log('Found', listItems.length, 'list items');
        listItems.forEach(item => {
            item.addEventListener('click', handleInteractiveClick);
        });

        // Property Cards
        const propertyCards = richContentElement.querySelectorAll('.property-card');
        console.log('Found', propertyCards.length, 'property cards');
        propertyCards.forEach(card => {
            card.addEventListener('click', handleInteractiveClick);
        });
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
                        <img src="assets/icons/bot-avatar.jpg" alt="Bot">
                    </div>
                    <div class="message-content">
                        ${richContentHtml}
                    </div>
                `;

                // เพิ่มลงใน DOM
                elements.chatMessages.appendChild(messageElement);

                console.log('Adding interactive listeners');
                // เพิ่ม Event Listeners
                addInteractiveListeners(messageElement);

                // ตรวจสอบว่าปุ่มมีการเพิ่ม event listener หรือไม่
                const buttons = messageElement.querySelectorAll('.rich-button, .chat-btn');
                if (buttons.length > 0) {
                    console.log(`Found ${buttons.length} buttons after adding to DOM`);
                    buttons.forEach((btn, index) => {
                        console.log(`Button ${index + 1}: text="${btn.dataset.text}", has click listener=${btn.onclick !== null}`);
                    });
                }

                scrollToBottom();
            }
        }
    }

    // จัดการการคลิกองค์ประกอบแบบโต้ตอบ
    function handleInteractiveClick(event) {
        event.preventDefault(); // ป้องกันการ submit form หรือการนำทางที่ไม่ต้องการ

        console.log('Interactive element clicked');
        console.log('this:', this);
        console.log('dataset:', this.dataset);

        const clickText = this.dataset.text;
        if (!clickText) {
            console.error('No text data found in the clicked element');
            return;
        }

        console.log('Sending text:', clickText);
        addMessage('user', clickText);

        sendToDialogflow(clickText, chatState.sessionId)
            .then(response => {
                console.log('Dialogflow response:', response);
                handleDialogflowResponse(response);
            })
            .catch(error => {
                console.error('Dialogflow error:', error);
                handleDialogflowError(error);
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
    }

    // เรียกใช้การเริ่มต้นเมื่อโหลดหน้าเว็บ
    document.addEventListener('DOMContentLoaded', init);
})();
