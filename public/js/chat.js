/**
 * chat.js - ระบบ Live Chat แบบครบวงจร
 * รวมฟังก์ชันการทำงานจาก server.js มาไว้ในไฟล์เดียว
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
        socketStatus: document.getElementById('socket-status'),
        adminStatusIndicator: document.createElement('div') // สร้าง element ใหม่สำหรับแสดงสถานะแอดมิน
    };

    let isChipProcessing = false;
    let lastProcessedChip = null;
    let lastChipClickTime = 0;
    let lastDialogflowTimestamp = 0;
    let lastDialogflowMessage = '';
    // สถานะการแชท
    const chatState = {
        isOpen: false,
        sessionId: generateSessionId(),
        webId: '001', // web_id สำหรับ API
        socket: null,
        adminActive: false,
        lastMessageSender: null,
        apiBaseUrl: 'https://ownwebdev1.livinginsider.com/api/v1', // Base URL สำหรับ API
        apiToken: 'b059a15197926350fb43271477779d0fc04f6a4701eb3367c999c59eeae1f890', // Bearer Token
        propertySearch: {
            transaction_type: null, // ประเภทธุรกรรม (เช่า/ซื้อ)
            building_type: null,    // ประเภทอสังหาริมทรัพย์
            location: null,         // ทำเลที่ตั้ง
            price: null,            // ราคา (และค้นหาทันที)
            isComplete: false,
            searchReady: false
        },
        currentStep: 1,
        messageSentCache: {},
        userInfo: {
            name: null,
            email: null,
            phone: null,
            timestamp: Date.now()
        },
        isSending : false,
    };

    // การลงทะเบียนตัวจัดการเหตุการณ์
    function setupEventListeners() {
    console.log('กำลังตั้งค่า Event Listeners...');

    if (elements.chatToggleBtn) {
        console.log('พบปุ่มแชท - เพิ่ม onclick');

        // ใช้ onclick แทน addEventListener (ตรงนี้สำคัญมาก)
        elements.chatToggleBtn.onclick = function(e) {
            console.log('ปุ่มแชทถูกคลิก (onclick)');
            if (e) e.preventDefault();
            toggleChat();
            return false;
        };

        console.log('ตั้งค่า onclick ให้กับปุ่มแชทเรียบร้อยแล้ว');
    } else {
        console.error('!!! ไม่พบปุ่มแชท (chatToggleBtn) !!!');
    }

    // ตั้งค่าปุ่มอื่นๆ โดยใช้ onclick แทน addEventListener
    if (elements.chatMinimizeBtn) {
        elements.chatMinimizeBtn.onclick = function() {
            console.log('คลิกปุ่มย่อ');
            toggleChat();
            return false;
        };
    }

    if (elements.chatSendBtn) {
            // ลบ event handlers เดิมก่อน
            elements.chatSendBtn.onclick = null;
            // เพิ่ม handler ใหม่
            elements.chatSendBtn.onclick = function(e) {
                if (e) e.preventDefault();
                sendMessage();
                return false;
            };
        }

    if (elements.chatNowBtn) {
        elements.chatNowBtn.onclick = function() {
            console.log('คลิกปุ่มเริ่มแชท');
            startChat();
            return false;
        };
    }

    if (elements.chatInput) {
            // ลบ event handlers เดิมก่อน
            elements.chatInput.onkeypress = null;

            // ฟังก์ชันจัดการ Enter key
            const handleEnterKey = function(e) {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    sendMessage();
                    return false;
                }
            };

            // เพิ่ม handler ใหม่
            elements.chatInput.removeEventListener('keypress', handleEnterKey);
            elements.chatInput.addEventListener('keypress', handleEnterKey);
        }

    // ติดตั้ง Event handler สำหรับ chip
    // หมายเหตุ: สำหรับ chip ยังคงต้องใช้ document.addEventListener เพราะ chip อาจถูกสร้างขึ้นมาในภายหลัง
    document.addEventListener('click', function(e) {
        if (e.target.classList.contains('chip')) {
            console.log('คลิกบน chip');
            handleChipClick(e.target);
        }
    });

    console.log('ติดตั้ง Event Listeners เสร็จเรียบร้อย');
}
    function isMessageDuplicate(message) {
       // สร้าง cache ถ้ายังไม่มี
       if (!chatState.messageCache) {
           chatState.messageCache = {
               idCache: {}, // เก็บตาม ID
               textCache: {}, // เก็บตามข้อความ
               intentCache: {} // เก็บตาม intent
           };
       }

       // ตรวจสอบพารามิเตอร์ที่ส่งเข้ามา
       if (typeof message === 'number') {
           // กรณีเก่าที่ส่งแค่ timestamp เข้ามา
           const messageId = message;
           if (chatState.messageCache.idCache[messageId]) {
               console.log(`พบข้อความที่มี ID ตรงกัน: ${messageId}`);
               return true;
           }
           // บันทึก ID ใหม่
           chatState.messageCache.idCache[messageId] = Date.now();
           return false;
       }

       // ต้องมีข้อมูลพื้นฐาน
       if (!message) return false;

       const messageId = message.timestamp || message.messageId;
       const sender = message.sender;
       const text = message.text || '';
       const intent = message.intent;

       // ถ้ามี ID ตรงกัน
       if (messageId && chatState.messageCache.idCache[messageId]) {
           console.log(`พบข้อความที่มี ID ตรงกัน: ${messageId}`);
           return true;
       }

       // ถ้าเป็นข้อความจากบอท ตรวจสอบความซ้ำซ้อนโดยใช้ intent และเนื้อหา
       if (sender === 'bot' && intent) {
           // สร้างคีย์จาก intent และ 20 อักขระแรกของข้อความ
           const intentKey = `${intent}-${text.substring(0, 20)}`;

           // ถ้ามี key นี้ใน cache แล้ว และเวลาไม่เกิน 5 วินาที
           const lastTime = chatState.messageCache.intentCache[intentKey];
           if (lastTime && (Date.now() - lastTime < 5000)) {
               console.log(`พบข้อความบอทที่มี intent ซ้ำในช่วงเวลาใกล้เคียง: ${intentKey}`);
               return true;
           }
       }

       // ข้อความทั่วไป ตรวจสอบโดยใช้ sender และเนื้อหา
       if (sender && text && text.length > 0) {
           // สร้างคีย์จาก sender และเนื้อหา
           const textKey = `${sender}-${text.substring(0, 30)}`;

           // ถ้ามี key นี้ใน cache แล้ว และเวลาไม่เกิน 3 วินาที
           const lastTime = chatState.messageCache.textCache[textKey];
           if (lastTime && (Date.now() - lastTime < 3000)) {
               console.log(`พบข้อความที่มีเนื้อหาซ้ำในช่วงเวลาใกล้เคียง: ${textKey}`);
               return true;
           }
       }

       // ถ้าผ่านการตรวจสอบทั้งหมด แสดงว่าไม่ซ้ำ
       // บันทึกข้อความนี้ลง cache
       if (messageId) {
           chatState.messageCache.idCache[messageId] = Date.now();
       }

       if (sender && text && text.length > 0) {
           const textKey = `${sender}-${text.substring(0, 30)}`;
           chatState.messageCache.textCache[textKey] = Date.now();
       }

       if (sender === 'bot' && intent) {
           const intentKey = `${intent}-${text.substring(0, 20)}`;
           chatState.messageCache.intentCache[intentKey] = Date.now();
       }

       return false;
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
                            'http://localhost:4000' :
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
                 if (isMessageDuplicate(message)) {
                        console.log('Duplicate message from socket, ignoring:', message);
                        return;
                    }

                    // เพิ่มบันทึกข้อความนี้ลงใน cache
                    if (!chatState.receivedMessages) chatState.receivedMessages = {};
                    const msgKey = `${message.sender}-${message.timestamp}`;
                    chatState.receivedMessages[msgKey] = true;
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

                        // บันทึกข้อมูลลง localStorage
                        saveChatToLocalStorage();
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

                                // บันทึกข้อมูลลง localStorage
                                saveChatToLocalStorage();
                            }
                            else if (message.type === "2" && message.options && Array.isArray(message.options)) {
                                // สร้าง UI chips จาก options
                                const chipsItem = {
                                    type: 'chips',
                                    options: message.options.map(option => ({
                                        text: option
                                    }))
                                };

                                // สร้าง HTML สำหรับ chips
                                const chipsHtml = renderChips(chipsItem);

                                // สร้าง message element
                                const messageElement = document.createElement('div');
                                messageElement.className = 'message bot-message';
                                messageElement.setAttribute('data-message-id', message.timestamp);
                                messageElement.innerHTML = `
                                    <div class="message-avatar">
                                        <img src="assets/icons/chat-avatar.jpg" alt="Bot">
                                    </div>
                                    <div class="message-content">
                                        <p>${escapeHTML(message.text || '')}</p>
                                        ${chipsHtml}
                                    </div>
                                `;

                                // เพิ่มลงใน DOM
                                elements.chatMessages.appendChild(messageElement);

                                // เพิ่ม Event Listeners สำหรับ chips
                                addInteractiveListeners(messageElement);

                                // เลื่อนไปที่ข้อความล่าสุด
                                scrollToBottom();

                                // บันทึกข้อมูลลง localStorage
                                saveChatToLocalStorage();
                            }
                            else if (message.text) {
                                // ถ้ามีข้อความธรรมดา
                                addMessage('bot', message.text, '', message.timestamp);
                            }
                        } else if (message.text) {
                            // ข้อความธรรมดาจากบอท
                            addMessage('bot', message.text, '', message.timestamp);
                        }
                    } else if (message.sender === 'system') {
                        // ข้อความระบบ
                        addSystemMessage(message.text);
                    }
            });

            // รับการแจ้งเตือนผลการค้นหาอสังหาริมทรัพย์
            chatState.socket.on('property_search_results', (data) => {
                console.log('Property search results received:', data);

                // ตรวจสอบว่ามีข้อมูลหรือไม่
                if (data.success && data.data) {
                    // ขณะนี้เซิร์ฟเวอร์จะส่งข้อความผ่าน new_message อยู่แล้ว
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

                addSystemMessage(message);
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

            // รับการแจ้งเตือนประวัติการสนทนา
            chatState.socket.on('conversation_history', (data) => {
                console.log('Received conversation history:', data);

                if (data.messages && data.messages.length > 0) {
                    // แสดงประวัติการสนทนา
                    displayChatHistory(data.messages);
                }
            });

            console.log('Socket.IO initialized, waiting for connection...');
            return true;
        } catch (error) {
            console.error('Error connecting to Socket.IO:', error);
            return false;
        }
    }

    // แสดงประวัติการสนทนา
    function displayChatHistory(messages) {
        if (!messages || messages.length === 0) {
            return;
        }

        // เรียงข้อความจากเก่าไปใหม่
        const sortedMessages = [...messages].sort((a, b) => {
            return (a.timestamp || a.create_date || 0) - (b.timestamp || b.create_date || 0);
        });

        // ล้างข้อความเดิมถ้าต้องการ (อาจไม่จำเป็นถ้าเราต้องการเก็บข้อความปัจจุบัน)
        // elements.chatMessages.innerHTML = '';

        // แสดงข้อความในประวัติ
        sortedMessages.forEach(msg => {
            const timestamp = msg.timestamp || msg.create_date || Date.now();

            // ข้ามข้อความที่มีอยู่แล้ว
            if (isMessageDuplicate(timestamp)) {
                return;
            }

            if (msg.sender === 'bot') {
                // ตรวจสอบว่ามี payload หรือไม่
                if (msg.payload) {
                    const richContentHtml = processRichContent(msg.payload);

                    if (richContentHtml) {
                        const messageElement = document.createElement('div');
                        messageElement.className = 'message bot-message';
                        messageElement.setAttribute('data-message-id', timestamp);
                        messageElement.innerHTML = `
                            <div class="message-avatar">
                                <img src="assets/icons/chat-avatar.jpg" alt="Bot">
                            </div>
                            <div class="message-content">
                                <p>${escapeHTML(msg.text || msg.message || '')}</p>
                                <div class="rich-content-container">${richContentHtml}</div>
                            </div>
                        `;
                        elements.chatMessages.appendChild(messageElement);
                        addInteractiveListeners(messageElement);
                    } else {
                        addMessage('bot', msg.text || msg.message || '', '', timestamp);
                    }
                } else {
                    addMessage('bot', msg.text || msg.message || '', '', timestamp);
                }
            } else if (msg.sender === 'admin') {
                const messageElement = document.createElement('div');
                messageElement.className = 'message bot-message';
                messageElement.setAttribute('data-message-id', timestamp);
                messageElement.innerHTML = `
                    <div class="message-avatar">
                        <img src="assets/icons/chat-avatar.jpg" alt="Admin">
                    </div>
                    <div class="message-content admin-message">
                        <p>${escapeHTML(msg.text || msg.message || '')}</p>
                        <small>${escapeHTML(msg.adminName || 'Admin')}</small>
                    </div>
                `;
                elements.chatMessages.appendChild(messageElement);
            } else if (msg.sender === 'system') {
                addSystemMessage(msg.text || msg.message || '');
            }
        });

        // เลื่อนไปที่ข้อความล่าสุด
        scrollToBottom();
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

    function toggleChat() {
        console.log('toggleChat() ถูกเรียกใช้');
        console.log('สถานะปัจจุบัน:', chatState.isOpen);

        // เช็คอิลิเมนต์อีกครั้งเพื่อความแน่ใจ
        const chatWindow = document.getElementById('chat-window');
        const chatToggleBtn = document.getElementById('chat-toggle-btn');

        console.log('ตรวจสอบอิลิเมนต์: chatWindow=', chatWindow, ', chatToggleBtn=', chatToggleBtn);

        // สลับสถานะ
        chatState.isOpen = !chatState.isOpen;
        console.log('สถานะใหม่:', chatState.isOpen);

        // ปรับการแสดงผลตามสถานะ
        if (chatState.isOpen) {
            console.log('กำลังเปิดหน้าต่างแชท...');

            // เปิดแชท
            if (chatWindow) {
                chatWindow.style.display = 'flex';
                chatWindow.classList.add('fade-in');

                // ตรวจสอบว่า style ถูกปรับจริงๆ
                console.log('การแสดงผลหน้าต่างแชทหลังปรับ:', chatWindow.style.display);

                setTimeout(function() {
                    scrollToBottom();
                    console.log('เลื่อนไปล่างสุดแล้ว');
                }, 100);
            } else {
                console.error('ไม่พบหน้าต่างแชท (chatWindow)');
            }

            if (chatToggleBtn) {
                chatToggleBtn.style.display = 'none';
                console.log('ซ่อนปุ่มแชทแล้ว');
            } else {
                console.error('ไม่พบปุ่มแชท (chatToggleBtn)');
            }

            // เชื่อมต่อ Socket.IO หากจำเป็น
            if (!chatState.socket) {
                console.log('เชื่อมต่อ Socket.IO');
                connectSocket();
            } else if (chatState.socket && chatState.socket.disconnected) {
                console.log('เชื่อมต่อ Socket.IO ใหม่');
                chatState.socket.connect();
            }
        } else {
            console.log('กำลังปิดหน้าต่างแชท...');

            // ปิดแชท
            if (chatWindow) {
                chatWindow.style.display = 'none';
                console.log('ซ่อนหน้าต่างแชทแล้ว');
            } else {
                console.error('ไม่พบหน้าต่างแชท (chatWindow)');
            }

            if (chatToggleBtn) {
                chatToggleBtn.style.display = 'flex';
                console.log('แสดงปุ่มแชทแล้ว');
            } else {
                console.error('ไม่พบปุ่มแชท (chatToggleBtn)');
            }
        }

        // บันทึกสถานะใหม่
        saveChatToLocalStorage();

        console.log('toggleChat() ทำงานเสร็จแล้ว');
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


    // แทนที่ฟังก์ชัน handleChipClick เดิม
    function handleChipClick(chipElement) {
        // ถ้ากำลังประมวลผลการคลิกอยู่แล้ว ให้ยกเลิกการทำงานซ้ำ
        if (isChipProcessing) {
            console.log('กำลังประมวลผลการคลิกอยู่แล้ว ข้ามการทำงานซ้ำ');
            return;
        }

        const clickText = chipElement.dataset.text;
        if (!clickText) return;

        // ตรวจสอบว่าเป็น chip เดิมที่คลิกซ้ำในเวลาใกล้เคียงหรือไม่
        if (lastProcessedChip && lastProcessedChip === chipElement) {
            const now = Date.now();
            if (now - lastChipClickTime < 2000) { // 2 วินาที
                console.log('คลิก chip ซ้ำเร็วเกินไป ข้ามการทำงาน');
                return;
            }
        }

        // กำหนดให้กำลังประมวลผล
        isChipProcessing = true;
        lastProcessedChip = chipElement;
        lastChipClickTime = Date.now();

        // ปิดการใช้งาน chip ชั่วคราว
        const allChips = document.querySelectorAll('.chip');
        allChips.forEach(chip => {
            chip.style.pointerEvents = 'none';
            chip.style.opacity = '0.6';
        });

        // กระบวนการส่งข้อความเมื่อคลิก chip
        const messageId = Date.now();

        // แสดงข้อความผู้ใช้
        addMessage('user', clickText, '', messageId);

        // ส่งข้อความไปยัง API
        sendToApi(clickText, messageId);

        // ถ้าแอดมินไม่ได้แอคทีฟจึงส่งไปยัง Dialogflow
        if (!chatState.adminActive) {
            sendToDialogflow(clickText, chatState.sessionId, messageId)
                .then(handleDialogflowResponse)
                .catch(handleDialogflowError);
        }

        // บันทึกข้อมูลลง localStorage
        saveChatToLocalStorage();

        // รีเซ็ตสถานะการประมวลผลหลังจาก 1.5 วินาที
        setTimeout(() => {
            isChipProcessing = false;

            // คืนค่าการใช้งาน chip
            allChips.forEach(chip => {
                chip.style.pointerEvents = '';
                chip.style.opacity = '';
            });
        }, 1500);
    }

    function sendBotMessageToApi(message) {
        // ตรวจสอบว่ามีข้อความหรือไม่
        if (!message.text && !message.richContent && !message.chips) {
            return; // ไม่มีข้อมูลที่จะส่ง
        }

        // กำหนดประเภทข้อความ
        let messageType = "1"; // ข้อความปกติ

        // ตรวจสอบว่ามี chips หรือไม่
        if (message.chips && message.chips.length > 0) {
            messageType = "2"; // ข้อความที่มีตัวเลือก (chips)
        } else if (message.richContent) {
            messageType = "3"; // ข้อความที่มี rich content
        }

        // สร้าง FormData สำหรับส่งข้อมูล
        const formData = new FormData();
        formData.append('room_id', chatState.sessionId);
        formData.append('web_id', chatState.webId);
        formData.append('detail', message.text || 'Bot message');
        formData.append('type', messageType);
        formData.append('sender', 'bot');

        // ถ้ามี chips ให้เพิ่มลงไป
        if (message.chips && message.chips.length > 0) {
            formData.append('options', JSON.stringify(message.chips));
        }

        // ส่งข้อมูลไปยัง API
        fetch(`${chatState.apiBaseUrl}/chat/send/sms`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${chatState.apiToken}`
            },
            body: formData
        })
        .then(response => response.json())
        .then(data => {
            console.log('ส่งข้อความบอทไปยัง API สำเร็จ:', data);
        })
        .catch(error => {
            console.error('เกิดข้อผิดพลาดในการส่งข้อความบอทไปยัง API:', error);
        });
    }

    // เพิ่มข้อความระบบ
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
        if (!message || chatState.isSending) return;

        try {
            // ตั้งสถานะเป็นกำลังส่ง
            chatState.isSending = true;

            const messageId = Date.now();

            // แสดงข้อความผู้ใช้
            addMessage('user', message, '', messageId);
            chatState.lastMessageSender = 'user';

            // เคลียร์ช่องข้อความ
            elements.chatInput.value = '';

            // ส่งข้อความไปยัง API
            sendToApi(message, messageId);

            // ตรวจสอบการส่งข้อความไปที่ไหน
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

            // บันทึกข้อมูลลง localStorage
            saveChatToLocalStorage();

            // ประมวลผลข้อมูลการสนทนาเพื่อค้นหาอสังหาริมทรัพย์
            processPropertySearchMessage(message);

        } finally {
            // รีเซ็ตสถานะหลังจาก 1 วินาที
            setTimeout(() => {
                chatState.isSending = false;
            }, 1000);
        }
    }

    // จัดการข้อผิดพลาดจาก Dialogflow
    function handleDialogflowError(error) {
        console.error('เกิดข้อผิดพลาดในการเชื่อมต่อ:', error);
        addMessage('bot', 'ขออภัย มีปัญหาในการเชื่อมต่อกับระบบ โปรดลองอีกครั้งในภายหลัง');
    }

    // เพิ่มข้อความ
    function addMessage(sender, text, senderName = '', messageId = null) {
        const timestamp = messageId || Date.now();

        // ตรวจสอบว่ามีข้อความนี้อยู่แล้วหรือไม่
        if (isMessageDuplicate(timestamp)) {
            console.log('ข้อความซ้ำ ไม่แสดงซ้ำ:', text);
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

        // ส่งข้อความผ่าน Socket.IO ในกรณีที่เป็นข้อความของผู้ใช้
        // แต่ต้องเช็คว่าไม่ใช่ข้อความที่มาจาก Socket.IO
        if (sender === 'user' && chatState.socket && chatState.socket.connected &&
            !messageElement.hasAttribute('from-socket')) {
            // เพิ่ม attribute เพื่อระบุว่าเป็นข้อความที่ส่งผ่าน Socket.IO แล้ว
            messageElement.setAttribute('from-socket', 'true');

            // ไม่ต้องส่งซ้ำถ้าข้อความนี้อยู่ใน chat cache แล้ว
            const cacheKey = `${sender}-${timestamp}`;
            if (!chatState.messageSentCache || !chatState.messageSentCache[cacheKey]) {
                // เก็บ cache ว่าข้อความนี้ถูกส่งแล้ว
                if (!chatState.messageSentCache) chatState.messageSentCache = {};
                chatState.messageSentCache[cacheKey] = true;

                chatState.socket.emit('new_message', {
                    sender: 'user',
                    text: text,
                    timestamp: timestamp,
                    room: chatState.sessionId
                });
            }
        }

        // บันทึกข้อมูลลง localStorage
        saveChatToLocalStorage();
    }

    // บันทึกข้อมูลแชทลง localStorage
    function saveChatToLocalStorage() {
        try {
            // เก็บข้อมูล session ID
            localStorage.setItem('chat_session_id', chatState.sessionId);

            // ตรวจสอบว่ามี sentMessages ใน localStorage หรือไม่
            let sentMessages = {};
            const savedSentMessages = localStorage.getItem('chat_sent_messages');
            if (savedSentMessages) {
                try {
                    sentMessages = JSON.parse(savedSentMessages);
                } catch (e) {
                    console.error('เกิดข้อผิดพลาดในการแปลงข้อมูล chat_sent_messages:', e);
                    sentMessages = {};
                }
            }

            // เก็บข้อมูลข้อความทั้งหมด
            const messages = Array.from(elements.chatMessages.querySelectorAll('.message')).map(msg => {
                // ดึงข้อมูลที่สำคัญจาก DOM
                const isBotMessage = msg.classList.contains('bot-message');
                const isUserMessage = msg.classList.contains('user-message');
                const isSystemMessage = msg.classList.contains('system-message');
                const messageContent = msg.querySelector('.message-content');
                const messageText = messageContent ? messageContent.querySelector('p')?.innerText : '';
                const timestamp = msg.dataset.messageId || Date.now();

                // ดึงข้อมูล chips (ถ้ามี)
                const chipsContainer = messageContent ? messageContent.querySelector('.chips-container') : null;
                const richContent = messageContent ? messageContent.querySelector('.rich-content-container')?.innerHTML : '';

                // สร้างออบเจ็กต์เก็บข้อมูลข้อความ
                const messageData = {
                    type: isBotMessage ? 'bot' : (isUserMessage ? 'user' : 'system'),
                    text: messageText || '',
                    richContent: richContent || '',
                    timestamp: timestamp,
                    hasChips: !!chipsContainer, // เก็บสถานะว่ามี chips หรือไม่
                    sentToApi: sentMessages[timestamp] === true // เก็บสถานะว่าส่งไป API แล้วหรือไม่ (ดึงจากข้อมูลที่บันทึกไว้)
                };

                // เก็บข้อมูล chips (ถ้ามี)
                if (chipsContainer) {
                    const chips = Array.from(chipsContainer.querySelectorAll('.chip')).map(chip => chip.textContent.trim());
                    messageData.chips = chips;
                }

                return messageData;
            });

            localStorage.setItem('chat_messages', JSON.stringify(messages));
            console.log('บันทึกข้อความทั้งหมด', messages.length, 'รายการลงใน localStorage');

            // ส่งข้อมูลไปยัง API สำหรับข้อความบอทที่ยังไม่ได้ส่งเท่านั้น
            messages.forEach(msg => {
                // ตรวจสอบว่าเป็นข้อความจากบอทและยังไม่เคยส่งไป API
                if (msg.type === 'bot' && !msg.sentToApi) {
                    // ส่งข้อมูลข้อความบอทไปยัง API
                    sendBotMessageToApi(msg);

                    // ทำเครื่องหมายว่าได้ส่งไป API แล้ว
                    msg.sentToApi = true;

                    // บันทึกสถานะการส่งลงใน localStorage
                    sentMessages[msg.timestamp] = true;
                }
            });

            // บันทึกรายการข้อความที่ส่งแล้วลงใน localStorage
            localStorage.setItem('chat_sent_messages', JSON.stringify(sentMessages));

            // เก็บข้อมูลสถานะต่างๆ
            const chatStateToSave = {
                adminActive: chatState.adminActive,
                isOpen: chatState.isOpen,
                propertySearch: chatState.propertySearch,
                currentStep: chatState.currentStep,
                userInfo: chatState.userInfo
            };
            localStorage.setItem('chat_state', JSON.stringify(chatStateToSave));

            return true;
        } catch (error) {
            console.error('เกิดข้อผิดพลาดในการบันทึกแชทลง localStorage:', error);
            return false;
        }
    }

    // โหลดข้อมูลแชทจาก localStorage
    function loadChatFromLocalStorage() {
        try {
            // ดึง Session ID
            const savedSessionId = localStorage.getItem('chat_session_id');
            if (savedSessionId) {
                chatState.sessionId = savedSessionId;
                console.log('โหลด Session ID จาก localStorage:', savedSessionId);
            }

            // ดึงข้อมูลสถานะการส่งข้อความ
            let sentMessages = {};
            const savedSentMessages = localStorage.getItem('chat_sent_messages');
            if (savedSentMessages) {
                try {
                    sentMessages = JSON.parse(savedSentMessages);
                    console.log('โหลดข้อมูลสถานะการส่งข้อความแล้ว:', Object.keys(sentMessages).length, 'รายการ');
                } catch (e) {
                    console.error('เกิดข้อผิดพลาดในการแปลงข้อมูล chat_sent_messages:', e);
                }
            }

            // ดึงข้อความทั้งหมด
            const savedMessages = localStorage.getItem('chat_messages');
            if (savedMessages) {
                const messages = JSON.parse(savedMessages);
                console.log('โหลดข้อความทั้งหมด', messages.length, 'รายการจาก localStorage');

                // ล้างข้อความเก่าก่อน
                elements.chatMessages.innerHTML = '';

                // แสดงข้อความทั้งหมด
                messages.forEach(msg => {
                    // ตรวจสอบสถานะการส่งข้อความ
                    if (sentMessages[msg.timestamp]) {
                        msg.sentToApi = true;
                    }

                    if (msg.type === 'user') {
                        addMessage('user', msg.text, '', msg.timestamp);
                    } else if (msg.type === 'bot') {
                        // ถ้ามี rich content
                        if (msg.richContent) {
                            const messageElement = document.createElement('div');
                            messageElement.className = 'message bot-message';
                            messageElement.setAttribute('data-message-id', msg.timestamp);
                            messageElement.innerHTML = `
                                <div class="message-avatar">
                                    <img src="assets/icons/chat-avatar.jpg" alt="Bot">
                                </div>
                                <div class="message-content">
                                    <p>${escapeHTML(msg.text)}</p>
                                    <div class="rich-content-container">${msg.richContent}</div>
                                </div>
                            `;
                            elements.chatMessages.appendChild(messageElement);
                            addInteractiveListeners(messageElement);
                        } else {
                            addMessage('bot', msg.text, '', msg.timestamp);
                        }
                    } else if (msg.type === 'system') {
                        addSystemMessage(msg.text);
                    }
                });

                // เลื่อนไปที่ข้อความล่าสุด
                setTimeout(scrollToBottom, 100);
            }

            // ดึงข้อมูลสถานะ
            const savedState = localStorage.getItem('chat_state');
            if (savedState) {
                const state = JSON.parse(savedState);
                chatState.adminActive = state.adminActive ?? false;

                // อัปเดตข้อมูลการค้นหาอสังหาริมทรัพย์และสถานะการแชท
                if (state.propertySearch) {
                    chatState.propertySearch = state.propertySearch;
                }

                if (state.currentStep) {
                    chatState.currentStep = state.currentStep;
                }

                if (state.userInfo) {
                    chatState.userInfo = state.userInfo;
                }

                // อัปเดตการแสดงสถานะแอดมิน
                updateAdminStatusDisplay(chatState.adminActive);

                // ถ้าแชทเปิดอยู่ก่อนรีเฟรช ให้เปิดแชทต่อ
                if (state.isOpen) {
                    toggleChat();
                }
            }

            return true;
        } catch (error) {
            console.error('เกิดข้อผิดพลาดในการโหลดแชทจาก localStorage:', error);
            return false;
        }
    }

    // ลบข้อมูลแชทออกจาก localStorage (ใช้เมื่อต้องการเริ่มใหม่ทั้งหมด)
    function clearChatCache() {
        try {
            localStorage.removeItem('chat_session_id');
            localStorage.removeItem('chat_messages');
            localStorage.removeItem('chat_state');
            localStorage.removeItem('chat_sent_messages'); // เพิ่มการลบข้อมูลสถานะการส่งข้อความ
            console.log('ลบข้อมูลแชทจาก localStorage เรียบร้อย');
            return true;
        } catch (error) {
            console.error('เกิดข้อผิดพลาดในการลบแคชแชท:', error);
            return false;
        }
    }

    function addClearCacheButton() {
        // 1.1 เพิ่ม CSS สำหรับปุ่มล้างแคช
        const style = document.createElement('style');
        style.textContent = `
            /* สไตล์สำหรับปุ่มล้างแคช */
            .clear-cache-btn {
                position: fixed;
                bottom: 20px;
                right: 95px; /* วางข้างๆ ปุ่มแชท */
                width: 42px;
                height: 42px;
                border-radius: 50%;
                background-color: #dc3545;
                color: white;
                display: flex;
                justify-content: center;
                align-items: center;
                cursor: pointer;
                box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
                z-index: 999;
                transition: all 0.3s ease;
            }

            .clear-cache-btn:hover {
                transform: scale(1.1);
                background-color: #c82333;
            }

            .clear-cache-btn i {
                font-size: 16px;
            }

            /* ทูลทิป */
            .clear-cache-btn .tooltip {
                position: absolute;
                top: -35px;
                left: 50%;
                transform: translateX(-50%);
                background-color: #333;
                color: white;
                padding: 5px 10px;
                border-radius: 4px;
                font-size: 12px;
                opacity: 0;
                visibility: hidden;
                transition: opacity 0.3s, visibility 0.3s;
                white-space: nowrap;
            }

            .clear-cache-btn:hover .tooltip {
                opacity: 1;
                visibility: visible;
            }

            /* รูปสามเหลี่ยมชี้ลงด้านล่าง */
            .clear-cache-btn .tooltip::after {
                content: '';
                position: absolute;
                top: 100%;
                left: 50%;
                transform: translateX(-50%);
                border-width: 5px;
                border-style: solid;
                border-color: #333 transparent transparent transparent;
            }
        `;
        document.head.appendChild(style);

        // 1.2 สร้างปุ่ม
        const clearCacheBtn = document.createElement('div');
        clearCacheBtn.className = 'clear-cache-btn';
        clearCacheBtn.innerHTML = `
            <i class="fas fa-trash"></i>
            <span class="tooltip">ล้างข้อมูลแชท</span>
        `;

        // 1.3 เพิ่มเหตุการณ์คลิก
        clearCacheBtn.addEventListener('click', function() {
            if (confirm('คุณต้องการล้างข้อมูลแชททั้งหมดใช่หรือไม่? การกระทำนี้ไม่สามารถยกเลิกได้')) {
                // เรียกใช้ฟังก์ชันล้างแคช
                if (clearChatCache()) {
                    // รีโหลดหน้าเพื่อเริ่มใหม่
                    location.reload();
                }
            }
        });

        // 1.4 เพิ่มปุ่มลงในหน้าเว็บ
        document.body.appendChild(clearCacheBtn);
        console.log('เพิ่มปุ่มล้างแคชแชทเรียบร้อยแล้ว');
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

        // อัปเดตสถานะ chatState ตาม intent ที่ได้รับ
        if (response.intent) {
            console.log('Detected intent:', response.intent);
            processIntentForPropertySearch(response.intent, response);
        }

        // ตรวจสอบ response message ว่ามี options สำหรับสร้าง chips หรือไม่
        if (response.options && Array.isArray(response.options)) {
            // สร้าง Chip UI จาก options
            const chipsItem = {
                type: 'chips',
                options: response.options.map(option => ({
                    text: option
                }))
            };

            // สร้าง HTML สำหรับ chips
            const chipsHtml = renderChips(chipsItem);

            // สร้าง message element
            const messageId = Date.now();
            const messageElement = document.createElement('div');
            messageElement.className = 'message bot-message';
            messageElement.setAttribute('data-message-id', messageId);
            messageElement.innerHTML = `
                <div class="message-avatar">
                    <img src="assets/icons/chat-avatar.jpg" alt="Bot">
                </div>
                <div class="message-content">
                    <p>${response.message ? escapeHTML(response.message) : ''}</p>
                    ${chipsHtml}
                </div>
            `;

            // เพิ่มลงใน DOM
            elements.chatMessages.appendChild(messageElement);

            // เพิ่ม Event Listeners สำหรับ chips
            addInteractiveListeners(messageElement);
            sendToApi(response.message || '', messageId, "2", response.options);

            // เลื่อนไปที่ข้อความล่าสุด
            scrollToBottom();

            // บันทึกข้อมูลลง localStorage
            saveChatToLocalStorage();
        }

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
                sendToApi('Bot rich content', payloadMessageId, "3");

                scrollToBottom();

                // บันทึกข้อมูลลง localStorage
                saveChatToLocalStorage();
            }
        }

        // ตรวจสอบข้อความธรรมดา
        if (response.message && !isMessageDuplicate(response.messageId || Date.now())) {
            addMessage('bot', response.message, '', response.messageId);
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
            <img src="${escapeHTML(item.rawUrl || (item.image && item.image.src ? item.image.src.rawUrl : ''))}"
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

    function renderPropertyCard(property, moreLink = null) {
        // กำหนดประเภทธุรกรรม (เช่า หรือ ขาย)
        const isRent = property.tag && property.tag.toLowerCase().includes('เช่า');
        const tagText = isRent ? 'เช่า' : 'ขาย';

        // กำหนดรูปภาพ
        const imageUrl = property.imageUrl || 'assets/images/property-placeholder.jpg';

        // กำหนดลิงก์
        const link = property.link || '#';

        // จากรูปต้นแบบ มีการใช้ชื่อที่สั้นกระชับ
        const propertyName = (property.title || property.building || 'คอนโดมิเนียม');

        // เพิ่มปุ่ม "ดูเพิ่มเติม" ถ้ามี moreLink
        const moreButton = moreLink ?
            `<div class="li-property-more-button">
                <a href="${moreLink.link}" target="_blank" class="li-more-link">
                    ${moreLink.txt || "ดูเพิ่มเติม"} <i class="fas fa-arrow-right"></i>
                </a>
            </div>` : '';

        // สร้าง HTML แบบเหมือนต้นแบบทุกประการ พร้อมปุ่ม "ดูเพิ่มเติม" (ถ้ามี)
        return `
            <div class="li-property-card" onclick="window.open('${link}', '_blank')">
                <div class="li-property-left">
                    <img src="${imageUrl}" alt="${propertyName}">
                </div>
                <div class="li-property-right">
                    <div class="li-property-badge">
                        <i class="fas fa-building"></i> ${tagText}
                    </div>
                    <div class="li-property-title">${tagText} ${propertyName}</div>
                    <div class="li-property-code">${property.id || 'ID-001'}</div>
                    <div class="li-property-location">
                        <i class="fas fa-map-marker-alt"></i> ${property.location || 'ที่ตั้ง'}
                    </div>
                    <div class="li-property-price">฿${property.price || '-'}</div>
                </div>
            </div>
                    ${moreButton}
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
            console.log('Processing rich content item:', item);

            switch (item.type) {
                case 'info':
                    richContentHTML += renderInfoCard(item);
                    break;
                case 'chips':
                    richContentHTML += renderChips(item);
                    break;
                case 'image':
                    richContentHTML += renderImage(item.image ? item.image.src : item);
                    break;
                case 'button':
                    richContentHTML += renderButton(item);
                    break;
                case 'list':
                    richContentHTML += renderList(item);
                    break;
                case 'custom_card':
                    // ส่ง more_link ไปด้วยถ้ามี
                    richContentHTML += renderPropertyCard(item.property_data, item.more_link);
                    break;
                default:
                    console.log('Unknown rich content type:', item.type);
            }
        });

        return richContentHTML;
    }

    // ส่งข้อความไปยัง API
    function sendToApi(message, messageId, type = "1", options = null) {
        // สร้าง FormData สำหรับส่งข้อมูล
        const formData = new FormData();
        formData.append('room_id', chatState.sessionId);
        formData.append('web_id', chatState.webId);
        formData.append('detail', message);
        formData.append('type', type); // 1 = ข้อความปกติ, 2 = options, 3 = item_list

        // กำหนด sender ตามประเภทข้อความ
        const sender = type === "1" ? 'user' : 'bot';
        formData.append('sender', sender);

        // ถ้ามี options ให้เพิ่มลงไป
        if (options) {
            // ตรวจสอบว่า options เป็น array หรือไม่
            const optionsData = Array.isArray(options) ? options : [options];
            formData.append('options', JSON.stringify(optionsData));
        }

        // ส่งข้อมูลไปยัง API
        fetch(`${chatState.apiBaseUrl}/chat/send/sms`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${chatState.apiToken}`
            },
            body: formData
        })
        .then(response => response.json())
        .then(data => {
            console.log('ส่งข้อความไปยัง API สำเร็จ:', data);

            // ตรวจสอบการตอบกลับจาก API
            if (data.status === "success" && data.message) {
                // ถ้า API ตอบกลับมาพร้อม options สำหรับ chips
                if (data.type === "2" && data.options && Array.isArray(data.options)) {
                    // สร้าง UI chips จาก options ที่ได้รับ
                    const chipsItem = {
                        type: 'chips',
                        options: data.options.map(option => ({
                            text: option
                        }))
                    };

                    // สร้าง HTML สำหรับ chips และแสดงผล
                    const chipsHtml = renderChips(chipsItem);

                    // สร้าง message element
                    const botMessageId = Date.now() + 1;  // + 1 เพื่อไม่ให้ซ้ำกับ messageId ของ user
                    const messageElement = document.createElement('div');
                    messageElement.className = 'message bot-message';
                    messageElement.setAttribute('data-message-id', botMessageId);
                    messageElement.innerHTML = `
                        <div class="message-avatar">
                            <img src="assets/icons/chat-avatar.jpg" alt="Bot">
                        </div>
                        <div class="message-content">
                            <p>${escapeHTML(data.message)}</p>
                            ${chipsHtml}
                        </div>
                    `;

                    // เพิ่มลงใน DOM
                    elements.chatMessages.appendChild(messageElement);

                    // เพิ่ม Event Listeners สำหรับ chips
                    addInteractiveListeners(messageElement);

                    // เลื่อนไปที่ข้อความล่าสุด
                    scrollToBottom();

                    // บันทึกข้อมูลลง localStorage
                    saveChatToLocalStorage();
                }
            }
        })
        .catch(error => {
            console.error('เกิดข้อผิดพลาดในการส่งข้อความไปยัง API:', error);
        });
    }

    function addInteractiveListeners(richContentElement) {
        console.log('Setting up interactive elements');

        // ค้นหาเฉพาะชิปในองค์ประกอบนี้เท่านั้น
        const chips = richContentElement.querySelectorAll('.chip');
        chips.forEach(chip => {
            // ล้าง event listener เดิม (ถ้ามี)
            if (chip._chipClickHandler) {
                chip.removeEventListener('click', chip._chipClickHandler);
            }

            // สร้าง handler ตัวใหม่
            const chipClickHandler = function(e) {
                e.preventDefault();
                e.stopPropagation(); // ป้องกันการ bubble
                handleChipClick(chip);
            };

            // เก็บ reference ของ handler
            chip._chipClickHandler = chipClickHandler;

            // เพิ่ม handler
            chip.addEventListener('click', chipClickHandler);
        });

        // โค้ดส่วนอื่นคงเดิม (ส่วนของ list items และ property cards)
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

                    // ประมวลผลข้อความเพื่อการค้นหาอสังหาริมทรัพย์
                    processPropertySearchMessage(clickText);
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

    // ส่งข้อความไปยัง Dialogflow
    async function sendToDialogflow(message, sessionId, messageId) {
    try {
        // ป้องกันการส่งข้อความซ้ำในระยะเวลาใกล้เคียง
        const now = Date.now();
        if (message === lastDialogflowMessage && now - lastDialogflowTimestamp < 2000) {
            console.log('ข้อความซ้ำส่งไปยัง Dialogflow เร็วเกินไป ข้ามการทำงาน');
            throw new Error('Duplicate message send attempt');
        }

        // บันทึกข้อความและเวลาล่าสุด
        lastDialogflowMessage = message;
        lastDialogflowTimestamp = now;

        // เตรียมข้อมูลที่จะส่ง
        const requestData = {
            query: message,
            sessionId: sessionId || chatState.sessionId,
            messageId: messageId,
            userInfo: chatState.userInfo
        };

        // ส่งคำขอไปยัง API Dialogflow
        const response = await fetch('/api/dialogflow', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestData)
        });

        // รับการตอบกลับจาก API
        const responseData = await response.json();

        if (!responseData.success) {
            throw new Error(responseData.message || 'เกิดข้อผิดพลาดในการเชื่อมต่อกับ Dialogflow');
        }

        console.log('Dialogflow response:', responseData);

        // อัปเดต session data ถ้ามี
        if (responseData.sessionData) {
            updateChatStateFromServerData(responseData.sessionData);
        }

        // สร้างข้อมูลการตอบกลับสำหรับ handler
        return {
            message: responseData.message,
            intent: responseData.intent,
            confidence: responseData.confidence,
            sessionId: responseData.sessionId,
            messageId: messageId,
            options: responseData.options,
            payload: responseData.payload
        };
    } catch (error) {
        console.error('เกิดข้อผิดพลาดในการส่งข้อความไปยัง Dialogflow:', error);
        throw error;
    }
}

    function updateChatStateFromServerData(sessionData) {
        if (!sessionData) return;

        // อัปเดตข้อมูลการค้นหา
        if (sessionData.propertySearch) {
            chatState.propertySearch = sessionData.propertySearch;
            console.log('อัปเดตข้อมูลการค้นหา:', chatState.propertySearch);
        }

        // อัปเดต step ปัจจุบัน
        if (sessionData.currentStep) {
            chatState.currentStep = sessionData.currentStep;
            console.log('อัปเดต current step:', chatState.currentStep);
        }

        // อัปเดตข้อมูลผู้ใช้
        if (sessionData.userInfo) {
            chatState.userInfo = sessionData.userInfo;
            console.log('อัปเดตข้อมูลผู้ใช้:', chatState.userInfo);
        }

        // บันทึกข้อมูลลง localStorage
        saveChatToLocalStorage();
    }

    // ประมวลผลข้อความเพื่อการค้นหาอสังหาริมทรัพย์
    function processPropertySearchMessage(message) {
        if (!message) return;

        const lowerMessage = message.toLowerCase();

        console.log('ประมวลผลข้อความสำหรับการค้นหา:', message);
        console.log('Step ปัจจุบัน:', chatState.currentStep);

        // ตรวจสอบคำสั่งรีเซ็ต
        if (lowerMessage.includes('เริ่มใหม่') ||
            lowerMessage.includes('รีเซ็ต') ||
            lowerMessage.includes('reset') ||
            lowerMessage.includes('ค้นหาใหม่')) {

            resetPropertySearch();
            return; // ออกจากฟังก์ชันเมื่อรีเซ็ต
        }

        // ตรวจสอบและกำหนดข้อมูลตาม step ปัจจุบัน
        switch (chatState.currentStep) {
            case 1:
                // Step 1: ตรวจสอบประเภทธุรกรรม (ซื้อ/เช่า)
                if (lowerMessage.includes('ซื้อ') || lowerMessage.includes('buy')) {
                    chatState.propertySearch.transaction_type = 'ซื้อ';
                    console.log('Step 1: ตรวจพบความตั้งใจซื้อ');
                    chatState.currentStep = 2; // เลื่อนไปยัง step ถัดไป
                } else if (lowerMessage.includes('เช่า') || lowerMessage.includes('rent')) {
                    chatState.propertySearch.transaction_type = 'เช่า';
                    console.log('Step 1: ตรวจพบความตั้งใจเช่า');
                    chatState.currentStep = 2; // เลื่อนไปยัง step ถัดไป
                } else {
                    console.log('Step 1: ไม่พบคำที่เกี่ยวข้องกับการซื้อหรือเช่า');
                    // ไม่เลื่อนไปยัง step ถัดไป เพราะไม่พบคำที่เกี่ยวข้อง
                }
                break;

            case 2:
                // Step 2: ตรวจหาประเภทอสังหาริมทรัพย์
                let foundBuildingType = false;

                if (lowerMessage.includes('คอนโด') || lowerMessage.includes('condo')) {
                    chatState.propertySearch.building_type = 'คอนโด';
                    console.log('Step 2: ตรวจพบประเภทคอนโด');
                    foundBuildingType = true;
                } else if (lowerMessage.includes('บ้าน') || lowerMessage.includes('house')) {
                    chatState.propertySearch.building_type = 'บ้าน';
                    console.log('Step 2: ตรวจพบประเภทบ้าน');
                    foundBuildingType = true;
                } else if (lowerMessage.includes('ทาวน์') || lowerMessage.includes('town')) {
                    chatState.propertySearch.building_type = 'ทาวน์โฮม';
                    console.log('Step 2: ตรวจพบประเภททาวน์โฮม');
                    foundBuildingType = true;
                } else if (lowerMessage.includes('ที่ดิน') || lowerMessage.includes('land')) {
                    chatState.propertySearch.building_type = 'ที่ดิน';
                    console.log('Step 2: ตรวจพบประเภทที่ดิน');
                    foundBuildingType = true;
                } else if (lowerMessage.includes('อพาร์ทเม้นท์') || lowerMessage.includes('apartment')) {
                    chatState.propertySearch.building_type = 'อพาร์ทเม้นท์';
                    console.log('Step 2: ตรวจพบประเภทอพาร์ทเม้นท์');
                    foundBuildingType = true;
                }

                if (foundBuildingType) {
                    chatState.currentStep = 3; // เลื่อนไปยัง step ถัดไป เมื่อพบประเภท
                } else {
                    console.log('Step 2: ไม่พบคำที่เกี่ยวข้องกับประเภทอสังหาริมทรัพย์');
                    // ไม่เลื่อนไปยัง step ถัดไป เพราะไม่พบคำที่เกี่ยวข้อง
                }
                break;

            case 3:
                // Step 3: ตรวจหาทำเล/พื้นที่
                // ตรวจสอบทำเลที่ตั้ง (ตัวอย่างเท่านั้น ควรขยายเพิ่มเติม)
                const locations = [
                    'กรุงเทพ', 'เชียงใหม่', 'ขอนแก่น', 'พัทยา', 'ลาดพร้าว', 'สุขุมวิท', 'บางนา',
                    'อโศก', 'รามคำแหง', 'รัชดา', 'เอกมัย', 'ทองหล่อ', 'พระราม9', 'รัตนาธิเบศร์',
                    'เพชรเกษม', 'ภูเก็ต', 'ชลบุรี', 'พระราม2', 'สาทร', 'สีลม', 'ราชดำริ', 'นนทบุรี'
                ];

                let locationFound = false;

                for (const loc of locations) {
                    if (lowerMessage.includes(loc.toLowerCase())) {
                        chatState.propertySearch.location = loc;
                        console.log('Step 3: ตรวจพบทำเล:', loc);
                        locationFound = true;
                        break;
                    }
                }

                // ตรวจสอบราคา
                const priceMatch = message.match(/(\d[\d,]*(?:\.\d+)?)\s*(?:-|ถึง|to)?\s*(\d[\d,]*(?:\.\d+)?)?/i);
                let priceFound = false;

                if (priceMatch) {
                    if (priceMatch[2]) {
                        // กรณีมีช่วงราคา
                        const startPrice = priceMatch[1].replace(/,/g, '');
                        const endPrice = priceMatch[2].replace(/,/g, '');
                        chatState.propertySearch.price = `${startPrice}-${endPrice}`;
                    } else {
                        // กรณีมีราคาเดียว
                        chatState.propertySearch.price = priceMatch[1].replace(/,/g, '');
                    }
                    console.log('Step 3: ตรวจพบราคา:', chatState.propertySearch.price);
                    priceFound = true;
                }

                // เลื่อนไป step ถัดไปเมื่อพบทำเลหรือราคา
                if (locationFound || priceFound) {
                    chatState.currentStep = 4; // เลื่อนไปยัง step ถัดไป
                } else {
                    console.log('Step 3: ไม่พบคำที่เกี่ยวข้องกับทำเลหรือราคา');
                    // ไม่เลื่อนไปยัง step ถัดไป เพราะไม่พบคำที่เกี่ยวข้อง
                }
                break;

            case 4:
                // Step 4: ตรวจสอบคำสั่งค้นหาหรือเก็บราคาเพิ่มเติม
                let searchCommand = false;

                if (lowerMessage.includes('ค้นหา') ||
                    lowerMessage.includes('search') ||
                    lowerMessage.includes('หา') ||
                    lowerMessage.includes('find')) {

                    console.log('Step 4: ตรวจพบคำสั่งค้นหา');
                    searchCommand = true;
                }

                // ตรวจสอบราคาอีกครั้ง (กรณีที่ยังไม่ได้ระบุในขั้นตอนที่ 3)
                if (!chatState.propertySearch.price) {
                    const priceMatch = message.match(/(\d[\d,]*(?:\.\d+)?)\s*(?:-|ถึง|to)?\s*(\d[\d,]*(?:\.\d+)?)?/i);
                    if (priceMatch) {
                        if (priceMatch[2]) {
                            const startPrice = priceMatch[1].replace(/,/g, '');
                            const endPrice = priceMatch[2].replace(/,/g, '');
                            chatState.propertySearch.price = `${startPrice}-${endPrice}`;
                        } else {
                            chatState.propertySearch.price = priceMatch[1].replace(/,/g, '');
                        }
                        console.log('Step 4: ตรวจพบราคา:', chatState.propertySearch.price);
                    }
                }

                // ถ้ามีคำสั่งค้นหา และมีข้อมูลเพียงพอ ให้ดำเนินการค้นหา
                if (searchCommand) {
                    const hasTransactionType = !!chatState.propertySearch.transaction_type;
                    const hasBuildingType = !!chatState.propertySearch.building_type;
                    const hasLocation = !!chatState.propertySearch.location;

                    if (hasTransactionType && (hasBuildingType || hasLocation)) {
                        // ถ้ายังไม่มีข้อมูลราคา ให้กำหนดค่าเริ่มต้น
                        if (!chatState.propertySearch.price) {
                            chatState.propertySearch.price = "1";
                            console.log('Step 4: กำหนดราคาเริ่มต้น');
                        }

                        chatState.propertySearch.isComplete = true;
                        chatState.propertySearch.searchReady = true;

                        console.log('Step 4: ข้อมูลครบถ้วน พร้อมค้นหา');

                        // ทำการค้นหาทันที
                        searchProperties();
                    }
                }
                break;
        }

        // บันทึกข้อมูลลง localStorage
        saveChatToLocalStorage();

        console.log('สถานะการค้นหาล่าสุด:', JSON.stringify(chatState.propertySearch));
        console.log('Step ปัจจุบันหลังประมวลผล:', chatState.currentStep);
    }

    // ฟังก์ชันจัดการ intent สำหรับการค้นหาอสังหาริมทรัพย์
    function processIntentForPropertySearch(intent, response) {
        console.log('Processing intent for property search:', intent);
        console.log('Current step:', chatState.currentStep);

        // ดึงข้อความที่ผู้ใช้พิมพ์หรือข้อความจาก response
        const message = response.message || response.query || '';
        const query = response.query || ''; // เก็บข้อความที่ผู้ใช้พิมพ์แยกไว้

        // แก้ไขการจัดการ intent ให้ทำงานตาม flow แบบเฉพาะเจาะจง
        switch (intent) {
            case 'step1_transaction_type':
                // กำหนด step ปัจจุบันเป็น 1 เสมอเมื่อเจอ intent นี้
                chatState.currentStep = 1;
                console.log('กำหนด step เป็น 1 จาก intent step1_transaction_type');

                // หาประเภทธุรกรรมจากข้อความ
                let transactionType = null;

                if (message.toLowerCase().includes('เช่า') || message.toLowerCase().includes('rent')) {
                    transactionType = 'เช่า';
                } else if (message.toLowerCase().includes('ซื้อ') || message.toLowerCase().includes('buy')) {
                    transactionType = 'ซื้อ';
                } else if (message.toLowerCase().includes('ขาย') || message.toLowerCase().includes('sell')) {
                    transactionType = 'ขาย';
                } else if (query.toLowerCase().includes('เช่า') || query.toLowerCase().includes('rent')) {
                    transactionType = 'เช่า';
                } else if (query.toLowerCase().includes('ซื้อ') || query.toLowerCase().includes('buy')) {
                    transactionType = 'ซื้อ';
                } else if (query.toLowerCase().includes('ขาย') || query.toLowerCase().includes('sell')) {
                    transactionType = 'ขาย';
                }

                // บันทึกข้อมูลเมื่อพบ
                if (transactionType) {
                    chatState.propertySearch.transaction_type = transactionType;
                    console.log('บันทึกประเภทธุรกรรม:', transactionType);
                    // เลื่อนไปยังขั้นตอนถัดไปเมื่อพบข้อมูลที่ต้องการ
                    chatState.currentStep = 2;
                }
                break;

            case 'step2_location':
                // กำหนด step ปัจจุบันเป็น 2 เสมอเมื่อเจอ intent นี้
                chatState.currentStep = 2;
                console.log('กำหนด step เป็น 2 จาก intent step2_location');

                // หาประเภทอสังหาริมทรัพย์
                let buildingType = null;

                if (message.toLowerCase().includes('คอนโด') || message.toLowerCase().includes('condo')) {
                    buildingType = 'คอนโด';
                } else if (message.toLowerCase().includes('บ้าน') || message.toLowerCase().includes('house')) {
                    buildingType = 'บ้าน';
                } else if (message.toLowerCase().includes('ทาวน์') || message.toLowerCase().includes('town')) {
                    buildingType = 'ทาวน์โฮม';
                } else if (message.toLowerCase().includes('ที่ดิน') || message.toLowerCase().includes('land')) {
                    buildingType = 'ที่ดิน';
                } else if (message.toLowerCase().includes('อพาร์ทเม้นท์') || message.toLowerCase().includes('apartment')) {
                    buildingType = 'อพาร์ทเม้นท์';
                } else if (query.toLowerCase().includes('คอนโด') || query.toLowerCase().includes('condo')) {
                    buildingType = 'คอนโด';
                } else if (query.toLowerCase().includes('บ้าน') || query.toLowerCase().includes('house')) {
                    buildingType = 'บ้าน';
                } else if (query.toLowerCase().includes('ทาวน์') || query.toLowerCase().includes('town')) {
                    buildingType = 'ทาวน์โฮม';
                } else if (query.toLowerCase().includes('ที่ดิน') || query.toLowerCase().includes('land')) {
                    buildingType = 'ที่ดิน';
                } else if (query.toLowerCase().includes('อพาร์ทเม้นท์') || query.toLowerCase().includes('apartment')) {
                    buildingType = 'อพาร์ทเม้นท์';
                } else {
                    // หากไม่พบประเภทที่ชัดเจน ใช้ข้อความทั้งหมด (แต่ต้องมีการพิมพ์ข้อความ)
                    buildingType = message || query;
                }

                // บันทึกข้อมูลเมื่อพบ
                if (buildingType) {
                    chatState.propertySearch.building_type = buildingType;
                    console.log('บันทึกประเภทอสังหาริมทรัพย์:', buildingType);
                    // เลื่อนไปยังขั้นตอนถัดไปเมื่อพบข้อมูลที่ต้องการ
                    chatState.currentStep = 3;
                }
                break;

            case 'step3_price':
                // กำหนด step ปัจจุบันเป็น 3 เสมอเมื่อเจอ intent นี้
                chatState.currentStep = 3;
                console.log('กำหนด step เป็น 3 จาก intent step3_price');

                // หาทำเลที่ตั้ง
                const locations = [
                    'กรุงเทพ', 'เชียงใหม่', 'ขอนแก่น', 'พัทยา', 'ลาดพร้าว', 'สุขุมวิท', 'บางนา',
                    'อโศก', 'รามคำแหง', 'รัชดา', 'เอกมัย', 'ทองหล่อ', 'พระราม9', 'รัตนาธิเบศร์',
                    'เพชรเกษม', 'ภูเก็ต', 'ชลบุรี', 'พระราม2', 'สาทร', 'สีลม', 'ราชดำริ', 'นนทบุรี'
                ];

                let location = null;
                let textToSearch = (message || query).toLowerCase();

                for (const loc of locations) {
                    if (textToSearch.includes(loc.toLowerCase())) {
                        location = loc;
                        break;
                    }
                }

                // หากไม่พบทำเลที่ชัดเจน ใช้ข้อความทั้งหมดเป็นทำเล
                if (!location && (message || query)) {
                    location = message || query;
                }

                // บันทึกข้อมูลเมื่อพบ
                if (location) {
                    chatState.propertySearch.location = location;
                    console.log('บันทึกทำเลที่ตั้ง:', location);
                    // เลื่อนไปยังขั้นตอนถัดไปเมื่อพบข้อมูลที่ต้องการ
                    chatState.currentStep = 4;
                }
                break;

            case 'search_property':
                // กำหนด step ปัจจุบันเป็น 4 เสมอเมื่อเจอ intent นี้
                chatState.currentStep = 4;
                console.log('กำหนด step เป็น 4 จาก intent search_property');

                // หาราคา
                const searchText = (message || query);
                const priceMatch = searchText.match(/(\d[\d,]*(?:\.\d+)?)\s*(?:-|ถึง|to)?\s*(\d[\d,]*(?:\.\d+)?)?/i);

                if (priceMatch) {
                    if (priceMatch[2]) {
                        // กรณีมีช่วงราคา
                        const startPrice = priceMatch[1].replace(/,/g, '');
                        const endPrice = priceMatch[2].replace(/,/g, '');
                        chatState.propertySearch.price = `${startPrice}-${endPrice}`;
                    } else {
                        // กรณีมีราคาเดียว
                        chatState.propertySearch.price = priceMatch[1].replace(/,/g, '');
                    }
                    console.log('บันทึกราคา:', chatState.propertySearch.price);
                } else {
                    // ถ้าไม่พบราคาในข้อความ ใช้ค่าเริ่มต้น
                    if (!chatState.propertySearch.price) {
                        chatState.propertySearch.price = "1";
                        console.log('กำหนดราคาเริ่มต้น: 1');
                    }
                }

                // ค้นหาทันที ถ้ามีคำสั่งค้นหา
                if (searchText.toLowerCase().includes('ค้นหา') ||
                    searchText.toLowerCase().includes('search') ||
                    searchText.toLowerCase().includes('หา')) {

                    // ตรวจสอบว่ามีข้อมูลเพียงพอ
                    const hasTransactionType = !!chatState.propertySearch.transaction_type;
                    const hasBuildingType = !!chatState.propertySearch.building_type;
                    const hasLocation = !!chatState.propertySearch.location;

                    if (hasTransactionType && (hasBuildingType || hasLocation)) {
                        chatState.propertySearch.isComplete = true;
                        chatState.propertySearch.searchReady = true;
                        console.log('ข้อมูลพร้อมสำหรับการค้นหา');

                        // ทำการค้นหาทันที
                        searchProperties();
                    }
                }
                break;

            case 're-search':
                // รีเซ็ตข้อมูลการค้นหา
                resetPropertySearch();

                // กำหนดให้ step เริ่มใหม่ที่ 1
                chatState.currentStep = 1;
                console.log('รีเซ็ต step เป็น 1 จาก intent re-search');
                break;
        }

        // บันทึกข้อมูลลง localStorage
        saveChatToLocalStorage();

        console.log('สถานะการค้นหาล่าสุด:', JSON.stringify(chatState.propertySearch));
        console.log('Step ปัจจุบัน:', chatState.currentStep);
    }

    // ดึงประเภทธุรกรรมจากข้อความ
    function getTransactionTypeFromMessage(message) {
        if (!message) return null;

        const lowerMessage = message.toLowerCase();

        if (lowerMessage.includes('เช่า') || lowerMessage.includes('rent')) {
            return 'เช่า';
        }

        if (lowerMessage.includes('ซื้อ') || lowerMessage.includes('buy')) {
            return 'ซื้อ';
        }

        if (lowerMessage.includes('ขาย') || lowerMessage.includes('sell') || lowerMessage.includes('sale')) {
            return 'ขาย';
        }

        // ถ้าไม่พบคำที่เกี่ยวข้อง ให้ return null
        return null;
    }

    // รีเซ็ตข้อมูลการค้นหา
    function resetPropertySearch() {
        chatState.propertySearch = {
            transaction_type: null,
            building_type: null,
            location: null,
            price: null,
            isComplete: false,
            searchReady: false
        };

        chatState.currentStep = 1;
        console.log('รีเซ็ตข้อมูลการค้นหาเรียบร้อย');

        // บันทึกข้อมูลลง localStorage
        saveChatToLocalStorage();
    }

    // ค้นหาอสังหาริมทรัพย์
    function searchProperties() {
        console.log('เริ่มค้นหาอสังหาริมทรัพย์...');

        // ถ้าข้อมูลไม่พร้อม ให้ยกเลิก
        if (!chatState.propertySearch.isComplete) {
            console.log('ข้อมูลไม่พร้อมสำหรับการค้นหา');
            return;
        }

        // แสดงข้อความกำลังค้นหา
        addMessage('bot', 'กำลังค้นหาอสังหาริมทรัพย์ตามเงื่อนไขของคุณ...');

        // แปลงข้อมูลสำหรับส่งไป API
        const searchData = {
            post_type: mapPropertyType(chatState.propertySearch.building_type),
            property_tag: mapTransactionType(chatState.propertySearch.transaction_type),
            zone: chatState.propertySearch.location,
            price: chatState.propertySearch.price
        };

        // ส่งคำขอค้นหาไปยัง API
        fetch(`${chatState.apiBaseUrl}/chat/prop_listing?web_id=001&room_id=a0289c60-2ca5-46d5-897d-0b747f4a9d1c&price=0&post_type=1&zone_id=14`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${chatState.apiToken}`,
                'Content-Type': 'application/json'
            }
        })
        .then(response => response.json())
        .then(data => {
            console.log('ผลการค้นหา:', data);

             if (data.result_code === 1 && data.data && data.data.length > 0) {
                // สร้าง payload สำหรับแสดงผลข้อมูลอสังหาริมทรัพย์
                displayPropertyResults(data);
            } else {
                // ไม่พบข้อมูล
                addMessage('bot', 'ขออภัย ไม่พบข้อมูลอสังหาริมทรัพย์ที่ตรงกับเงื่อนไขของคุณ กรุณาลองเปลี่ยนเงื่อนไขการค้นหา');

                // แสดงตัวเลือกเริ่มค้นหาใหม่
                const newSearchChips = {
                    type: 'chips',
                    options: [
                        { text: 'ค้นหาใหม่' },
                        { text: 'ปรับเงื่อนไขการค้นหา' },
                        { text: 'ติดต่อเจ้าหน้าที่' }
                    ]
                };

                // สร้าง HTML สำหรับ chips
                const chipsHtml = renderChips(newSearchChips);

                // สร้าง message element
                const messageId = Date.now() + 100;
                const messageElement = document.createElement('div');
                messageElement.className = 'message bot-message';
                messageElement.setAttribute('data-message-id', messageId);
                messageElement.innerHTML = `
                    <div class="message-avatar">
                        <img src="assets/icons/chat-avatar.jpg" alt="Bot">
                    </div>
                    <div class="message-content">
                        ${chipsHtml}
                    </div>
                `;

                // เพิ่มลงใน DOM
                elements.chatMessages.appendChild(messageElement);

                // เพิ่ม Event Listeners สำหรับ chips
                addInteractiveListeners(messageElement);

                // เลื่อนไปที่ข้อความล่าสุด
                scrollToBottom();
            }
        })
        .catch(error => {
            console.error('เกิดข้อผิดพลาดในการค้นหา:', error);
            addMessage('bot', 'ขออภัย เกิดข้อผิดพลาดในการค้นหา กรุณาลองใหม่อีกครั้ง');

            // แสดงข้อมูลตัวอย่างแทน
            displayMockPropertyResults();
        });
    }

    // แสดงผลลัพธ์การค้นหาอสังหาริมทรัพย์
    function displayPropertyResults(data) {
        // ตรวจสอบว่ามีข้อมูลหรือไม่
        if (!data.data || data.data.length === 0) {
            console.log('ไม่พบข้อมูลอสังหาริมทรัพย์');
            return;
        }

        // แปลงข้อมูลจาก API ให้อยู่ในรูปแบบที่ต้องการแสดงผล
        const properties = data.data.map((item, index) => {
            return {
                id: item.web_id || `prop-${index}`,
                imageUrl: item.web_photo || 'assets/images/property-placeholder.jpg',
                title: item.building_name || item.post_name || 'ไม่ระบุชื่อ',
                location: item.web_zone_name || 'ไม่ระบุที่ตั้ง',
                price: item.price_sort || '-',
                tag: item.web_post_type === 1 ? 'ขาย' : 'เช่า',
                link: item.web_link || '#',
                building: item.building_name || '',
                project_name: item.web_project_name || 'ไม่ระบุ'
            };
        });

        // สร้างข้อความสรุปการค้นหา
        let summaryText = 'ผลการค้นหาอสังหาริมทรัพย์';
        if (chatState.propertySearch.transaction_type) {
            summaryText += ` สำหรับ${chatState.propertySearch.transaction_type}`;
        }
        if (chatState.propertySearch.building_type) {
            summaryText += ` ประเภท${chatState.propertySearch.building_type}`;
        }
        if (chatState.propertySearch.location) {
            summaryText += ` บริเวณ${chatState.propertySearch.location}`;
        }
        if (chatState.propertySearch.price) {
            summaryText += ` ในช่วงราคา${chatState.propertySearch.price}`;
        }

        // ลองดูว่ามี more link หรือไม่
        const moreLink = data.more && data.more.link ? data.more : null;

        // สร้าง property_list สำหรับแสดงผลใน rich content
        // แก้ไขตรงนี้เพื่อส่ง moreLink ให้กับ property สุดท้าย
        const propertyListItems = properties.map((property, index) => {
            // กำหนดให้มีปุ่ม "ดูเพิ่มเติม" เฉพาะในการ์ดสุดท้าย
            const showMoreButton = (index === properties.length - 1) ? moreLink : null;

            return {
                type: "custom_card",
                property_data: property,
                more_link: showMoreButton
            };
        });

        // สร้าง rich content
        const richContent = {
            richContent: [
                [
                    {
                        type: "info",
                        title: summaryText,
                        subtitle: `พบทั้งหมด ${properties.length} รายการ`
                    },
                    ...propertyListItems
                ]
            ]
        };

        // สร้าง message element
        const messageId = Date.now();
        const messageElement = document.createElement('div');
        messageElement.className = 'message bot-message';
        messageElement.setAttribute('data-message-id', messageId);
        messageElement.innerHTML = `
            <div class="message-avatar">
                <img src="assets/icons/chat-avatar.jpg" alt="Bot">
            </div>
            <div class="message-content">
                <p>${data.sms || `พบอสังหาริมทรัพย์ทั้งหมด ${properties.length} รายการ`}</p>
                <div class="rich-content-container">
                    ${processRichContent(richContent)}
                </div>
            </div>
        `;

        // เพิ่มลงใน DOM
        elements.chatMessages.appendChild(messageElement);

        // เพิ่ม Event Listeners สำหรับองค์ประกอบแบบโต้ตอบ
        addInteractiveListeners(messageElement);

        // เลื่อนไปที่ข้อความล่าสุด
        scrollToBottom();

        // บันทึกข้อมูลลง localStorage
        saveChatToLocalStorage();

        // เพิ่มตัวเลือกเพิ่มเติม
        setTimeout(() => {
            const askMorePayload = {
                richContent: [
                    [
                        {
                            type: "chips",
                            options: [
                                {
                                    text: "ค้นหาเพิ่มเติม"
                                },
                                {
                                    text: "ฉันต้องการข้อมูลเพิ่มเติม"
                                },
                                {
                                    text: "ติดต่อเจ้าหน้าที่"
                                }
                            ]
                        }
                    ]
                ]
            };

            // สร้าง message element
            const askMoreId = Date.now() + 100;
            const askMoreElement = document.createElement('div');
            askMoreElement.className = 'message bot-message';
            askMoreElement.setAttribute('data-message-id', askMoreId);
            askMoreElement.innerHTML = `
                <div class="message-avatar">
                    <img src="assets/icons/chat-avatar.jpg" alt="Bot">
                </div>
                <div class="message-content">
                    <p>คุณต้องการข้อมูลเพิ่มเติมหรือไม่?</p>
                    <div class="rich-content-container">
                        ${processRichContent(askMorePayload)}
                    </div>
                </div>
            `;

            // เพิ่มลงใน DOM
            elements.chatMessages.appendChild(askMoreElement);

            // เพิ่ม Event Listeners สำหรับองค์ประกอบแบบโต้ตอบ
            addInteractiveListeners(askMoreElement);

            // เลื่อนไปที่ข้อความล่าสุด
            scrollToBottom();

            // บันทึกข้อมูลลง localStorage
            saveChatToLocalStorage();
        }, 1000);
    }

    // แปลงประเภทอสังหาริมทรัพย์เป็นรหัส
    function mapPropertyType(propertyType) {
        if (!propertyType) return null;

        if (typeof propertyType === 'number') {
            return propertyType;
        }

        const type = typeof propertyType === 'string' ? propertyType.toLowerCase() : '';

        if (type.includes('คอนโด') || type.includes('condo')) return 1;
        if (type.includes('บ้าน') || type.includes('บ้านเดี่ยว') || type.includes('house')) return 2;
        if (type.includes('ทาวน์เฮ้าส์') || type.includes('ทาวน์โฮม') || type.includes('townhouse') || type.includes('townhome')) return 3;
        if (type.includes('ที่ดิน') || type.includes('land')) return 4;
        if (type.includes('อพาร์ทเม้นท์') || type.includes('อพาร์ทเม้น') || type.includes('apartment')) return 5;

        return 1; // กรณีไม่พบประเภทที่ตรงกัน ใช้ค่าเริ่มต้น (คอนโด)
    }

    // แปลงประเภทธุรกรรมเป็น property_tag
    function mapTransactionType(transactionType) {
        if (!transactionType) return null;

        const type = typeof transactionType === 'string' ? transactionType.toLowerCase() : '';

        if (type.includes('ขาย') || type === 'sale' || type === 'buy' || type.includes('ซื้อ')) return 'ขาย';
        if (type.includes('เช่า') || type === 'rent') return 'เช่า';
        if (type.includes('เซ้ง')) return 'เซ้ง';

        return transactionType;
    }

    // เพิ่มฟังก์ชัน CSS สำหรับสถานะแอดมิน
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

            /* เพิ่ม CSS สำหรับ chip ที่ถูก disable */
            .chip.disabled {
                pointer-events: none;
                opacity: 0.6;
                cursor: default;
            }

            /* ป้องกันการคลิกซ้ำ */
            .chip[style*="pointer-events: none"] {
                cursor: default !important;
            }
        `;
        document.head.appendChild(style);
    }


    // รีเซ็ตสถานะแชท
    function resetChatState() {
        // กำหนดให้สถานะเริ่มต้นเป็น ปิด
        chatState.isOpen = false;

        // กำหนดให้ปุ่มแชทแสดง และหน้าต่างแชทซ่อน ตามสถานะเริ่มต้น
        if (elements.chatToggleBtn) {
            elements.chatToggleBtn.style.display = 'flex';
        }

        if (elements.chatWindow) {
            elements.chatWindow.style.display = 'none';
        }

        console.log('รีเซ็ตสถานะแชทเรียบร้อย:', {
            isOpen: chatState.isOpen,
            chatToggleBtn: elements.chatToggleBtn ? elements.chatToggleBtn.style.display : 'ไม่พบ element',
            chatWindow: elements.chatWindow ? elements.chatWindow.style.display : 'ไม่พบ element'
        });
    }

    // เริ่มการทำงานของสคริปต์
    // เริ่มการทำงานของสคริปต์
    function init() {
        console.log('เริ่มต้นการทำงานของแชท - Session ID:', chatState.sessionId);

        // เช็คอิลิเมนต์อีกครั้ง (ป้องกันกรณีเรียกก่อนที่ DOM จะพร้อม)
        elements.chatToggleBtn = document.getElementById('chat-toggle-btn');
        elements.chatWindow = document.getElementById('chat-window');
        elements.chatMessages = document.getElementById('chat-messages');
        elements.chatInput = document.getElementById('chat-input');
        elements.chatSendBtn = document.getElementById('chat-send-btn');
        elements.chatNowBtn = document.getElementById('chat-now-btn');
        elements.chatInputArea = document.getElementById('chat-input-area');
        elements.chatMinimizeBtn = document.querySelector('.chat-minimize-btn');
        elements.socketStatus = document.getElementById('socket-status');

        // ตรวจสอบการเชื่อมต่อปุ่มที่สำคัญ
        console.log('ตรวจสอบการเชื่อมต่อปุ่ม:');
        console.log('- chatToggleBtn:', elements.chatToggleBtn);
        console.log('- chatWindow:', elements.chatWindow);

        // โหลดข้อมูลแชทจาก localStorage
        loadChatFromLocalStorage();

        // ตั้งค่า Event Listeners
        setupEventListeners();

        // ตั้งค่าสถานะแอดมิน
        setupAdminStatusIndicator();

        // รีเซ็ตสถานะให้ถูกต้อง (ถ้าไม่ได้โหลดจาก localStorage)
        if (!localStorage.getItem('chat_state')) {
            resetInitialState();
        }

        // เชื่อมต่อกับ Socket.IO หากจำเป็น
        if (typeof io !== 'undefined') {
            connectSocket();
        } else {
            console.log('Socket.IO library not available, will attempt to connect when chat is opened');
        }

        // ตั้งค่าบันทึกข้อมูลแชทก่อนรีเฟรชหน้า
        window.addEventListener('beforeunload', function() {
            saveChatToLocalStorage();
        });

        addClearCacheButton();

    }
    function resetInitialState() {
        console.log('เริ่มต้นรีเซ็ตสถานะแชท');

        // กำหนดให้สถานะเริ่มต้นเป็น ปิด
        chatState.isOpen = false;

        // กำหนดให้ปุ่มแชทแสดง และหน้าต่างแชทซ่อน
        if (elements.chatToggleBtn) {
            elements.chatToggleBtn.style.display = 'flex';
            console.log('ตั้งค่าปุ่มแชทให้แสดง');
        } else {
            console.error('ไม่พบปุ่มแชท (chatToggleBtn) สำหรับรีเซ็ตสถานะ');
        }

        if (elements.chatWindow) {
            elements.chatWindow.style.display = 'none';
            console.log('ตั้งค่าหน้าต่างแชทให้ซ่อน');
        } else {
            console.error('ไม่พบหน้าต่างแชท (chatWindow) สำหรับรีเซ็ตสถานะ');
        }

        console.log('รีเซ็ตสถานะแชทเรียบร้อยแล้ว');
    }

    // เรียกใช้การเริ่มต้นเมื่อโหลดหน้าเว็บ
    document.addEventListener('DOMContentLoaded', function() {
        console.log('DOM Content Loaded');

        // เพิ่ม styles ก่อน
        addAdminStatusStyles();

        // ทดสอบเลือก elements
        const chatToggleBtn = document.getElementById('chat-toggle-btn');
        console.log('เช็คปุ่มแชทตอนโหลดหน้า:', chatToggleBtn);

        // เริ่มการทำงานหลัก
        init();
    });
})();
