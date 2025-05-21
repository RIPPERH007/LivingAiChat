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

        // ตรวจสอบกรณีพิเศษ: ปุ่มค้นหา
        if (clickText === 'ค้นหาเลย' || clickText === 'ยืนยันการค้นหา' || clickText === 'ค้นหา') {
            // ตั้งค่าสถานะให้พร้อมค้นหา
            chatState.propertySearch.isComplete = true;
            chatState.propertySearch.searchReady = true;

            // ทำการค้นหาทันที
            searchProperties();
        }
        // ตรวจสอบกรณีพิเศษ: ปุ่มแก้ไขข้อมูล
        else if (clickText === 'แก้ไขข้อมูล') {
            // รีเซ็ตกลับไปขั้นตอนแรก
            resetPropertySearch();

            // แสดงตัวเลือกประเภทธุรกรรม
            showTransactionTypeOptions();
        }
        // กรณีทั่วไป: ประมวลผลตามขั้นตอน
        else {
            // ประมวลผลข้อความเพื่อการค้นหาอสังหาริมทรัพย์
            processPropertySearchMessage(clickText);
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
        if (!message.text && !message.chipsHTML && !message.richContentHTML) {
            return; // ไม่มีข้อมูลที่จะส่ง
        }

        // กำหนดประเภทข้อความ
        let messageType = "1"; // ข้อความปกติ

        // ตรวจสอบว่ามี chips หรือไม่
        if (message.chips && message.chips.length > 0) {
            messageType = "2"; // ข้อความที่มีตัวเลือก (chips)
        } else if (message.richContentHTML) {
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

           // ประมวลผลข้อความเพื่อการค้นหาอสังหาริมทรัพย์
           processPropertySearchMessage(message);

           // บันทึกข้อมูลลง localStorage
           saveChatToLocalStorage();

       } finally {
           // รีเซ็ตสถานะหลังจาก 1 วินาที
           setTimeout(() => {
               chatState.isSending = false;
           }, 1000);
       }
   }


    // แก้ไขฟังก์ชัน addMessage ให้ส่ง Socket จากทั้งฝั่ง User และ Bot
    function addMessage(sender, text, senderName = '', messageId = null, options = null, richContent = null) {
    const timestamp = messageId || Date.now();

    // ตรวจสอบว่ามีข้อความนี้อยู่แล้วหรือไม่
    if (isMessageDuplicate(timestamp)) {
        console.log('ข้อความซ้ำ ไม่แสดงซ้ำ:', text);
        return timestamp;
    }

    const messageElement = document.createElement('div');
    messageElement.className = `message ${sender}-message`;
    messageElement.setAttribute('data-message-id', timestamp);

    // สร้าง HTML content ตามประเภทของข้อความ
    let contentHTML = `
        <div class="message-avatar">
            ${sender === 'user'
            ? '<i class="fa-solid fa-user"></i>'
            : '<img src="assets/icons/chat-avatar.jpg" alt="Bot">'
        }
        </div>
        <div class="message-content">
            <p>${escapeHTML(text)}</p>
    `;

    // ถ้ามี options (chips) ให้เพิ่ม chips HTML
    if (options && Array.isArray(options) && options.length > 0) {
        const chipsItem = {
            type: 'chips',
            options: options
        };
        contentHTML += renderChips(chipsItem);
    }

    // ถ้ามี richContent ให้เพิ่ม HTML ของ richContent
    if (richContent) {
        const richContentHtml = processRichContent(richContent);
        if (richContentHtml) {
            contentHTML += `<div class="rich-content-container">${richContentHtml}</div>`;
        }
    }

    // ปิด div
    contentHTML += '</div>';

    // เพิ่ม HTML ลงใน message element
    messageElement.innerHTML = contentHTML;

    // เพิ่มลงใน DOM
    elements.chatMessages.appendChild(messageElement);

    // เพิ่ม event listeners สำหรับองค์ประกอบแบบโต้ตอบ
    if (options || richContent) {
        addInteractiveListeners(messageElement);
    }

    // เลื่อนไปที่ข้อความล่าสุด
    scrollToBottom();

    // ส่งข้อความผ่าน Socket.IO ทั้งฝั่ง user และ bot
    if ((sender === 'user' || sender === 'bot') && chatState.socket && chatState.socket.connected &&
        !messageElement.hasAttribute('from-socket')) {
        // เพิ่ม attribute เพื่อระบุว่าเป็นข้อความที่ส่งผ่าน Socket.IO แล้ว
        messageElement.setAttribute('from-socket', 'true');

        // ไม่ต้องส่งซ้ำถ้าข้อความนี้อยู่ใน chat cache แล้ว
        const cacheKey = `${sender}-${timestamp}`;
        if (!chatState.messageSentCache || !chatState.messageSentCache[cacheKey]) {
            // เก็บ cache ว่าข้อความนี้ถูกส่งแล้ว
            if (!chatState.messageSentCache) chatState.messageSentCache = {};
            chatState.messageSentCache[cacheKey] = true;

            // สร้างข้อมูลสำหรับส่ง socket
            let socketData = {
                sender: sender,
                text: text,
                timestamp: timestamp,
                room: chatState.sessionId
            };

            // ถ้ามี options ให้เพิ่มข้อมูล options และ type
            if (options && Array.isArray(options) && options.length > 0) {
                socketData.type = "2"; // ประเภทข้อความที่มีตัวเลือก (chips)
                socketData.options = options.map(opt => typeof opt === 'object' ? opt.text || opt : opt);
            }

            // ถ้ามี richContent ให้เพิ่มข้อมูล payload และ type
            if (richContent) {
                socketData.type = "3"; // ประเภทข้อความที่มี rich content
                socketData.payload = richContent;
            }

            // ส่งข้อมูลผ่าน socket
            chatState.socket.emit('new_message', socketData);
            console.log(`ส่งข้อความ ${sender} ${options ? 'ที่มี chips' : ''} ${richContent ? 'ที่มี rich content' : ''} ผ่าน socket:`, socketData);
        }
    }

    // บันทึกข้อมูลลง localStorage
    saveChatToLocalStorage();

    return timestamp;
}


    // แก้ไขฟังก์ชัน saveChatToLocalStorage ให้เก็บข้อมูล chips อย่างถูกต้อง
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

                // ดึงข้อมูล chips และ rich content (ถ้ามี)
                const chipsContainer = messageContent ? messageContent.querySelector('.chips-container') : null;
                const richContentContainer = messageContent ? messageContent.querySelector('.rich-content-container') : null;

                // เก็บทั้ง HTML ของ chips และ rich content
                const chipsHTML = chipsContainer ? chipsContainer.outerHTML : '';
                const richContentHTML = richContentContainer ? richContentContainer.outerHTML : '';

                // สร้างออบเจ็กต์เก็บข้อมูลข้อความ
                const messageData = {
                    type: isBotMessage ? 'bot' : (isUserMessage ? 'user' : 'system'),
                    text: messageText || '',
                    chipsHTML: chipsHTML || '',  // เก็บ HTML ของ chips
                    richContentHTML: richContentHTML || '',  // เก็บ HTML ของ rich content
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
                        // ข้อความจากผู้ใช้
                        addMessage('user', msg.text, '', msg.timestamp);
                    } else if (msg.type === 'bot') {
                        // กรณีมี chips หรือ rich content
                        if (msg.chipsHTML || msg.richContentHTML) {
                            const messageElement = document.createElement('div');
                            messageElement.className = 'message bot-message';
                            messageElement.setAttribute('data-message-id', msg.timestamp);

                            // สร้าง HTML สำหรับข้อความที่มี chips หรือ rich content
                            let contentHTML = `
                                <div class="message-avatar">
                                    <img src="assets/icons/chat-avatar.jpg" alt="Bot">
                                </div>
                                <div class="message-content">
                                    <p>${escapeHTML(msg.text)}</p>
                            `;

                            // เพิ่ม chips (ถ้ามี)
                            if (msg.chipsHTML) {
                                contentHTML += msg.chipsHTML;
                            }

                            // เพิ่ม rich content (ถ้ามี)
                            if (msg.richContentHTML) {
                                contentHTML += msg.richContentHTML;
                            }

                            // ปิด div
                            contentHTML += '</div>';

                            messageElement.innerHTML = contentHTML;
                            elements.chatMessages.appendChild(messageElement);
                            addInteractiveListeners(messageElement);
                        } else {
                            // ข้อความทั่วไปจาก bot
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

    function isMessageDuplicateByContent(type, content) {
        if (!chatState.recentMessages) {
            chatState.recentMessages = [];
        }

        // ตรวจสอบว่าเนื้อหาซ้ำกับข้อความล่าสุดหรือไม่
        const now = Date.now();

        // ลบข้อความเก่าออกจาก cache (เก่ากว่า 10 วินาที)
        chatState.recentMessages = chatState.recentMessages.filter(msg =>
            now - msg.timestamp < 10000
        );

        // ตรวจสอบว่ามีข้อความที่มีเนื้อหาเหมือนกันและเป็นประเภทเดียวกันหรือไม่
        for (const msg of chatState.recentMessages) {
            if (msg.type === type && msg.content === content) {
                console.log('พบข้อความซ้ำซ้อน:', type, content);
                return true;
            }
        }

        // เพิ่มข้อความใหม่เข้าไปใน cache
        chatState.recentMessages.push({
            type: type,
            content: content,
            timestamp: now
        });

        return false;
    }


    function showGreetingMessage() {
        // สร้าง message element ใหม่
        const messageId = Date.now();
        const messageElement = document.createElement('div');
        messageElement.className = 'message bot-message';
        messageElement.setAttribute('data-message-id', messageId);

        // กำหนด HTML สำหรับ greeting message
        messageElement.innerHTML = `
            <div class="message-avatar">
                <img src="assets/icons/chat-avatar.jpg" alt="Bot">
            </div>
            <div class="message-content welcome-message">
                <p>👋 สวัสดีค่ะ ฉันคือผู้ช่วยอัจฉริยะของ My Property พร้อมช่วยคุณค้นหา ซื้อ ขาย หรือเช่าอสังหาฯ แบบง่าย ๆ สนใจเรื่องไหน ถามกับฉันได้เลย!</p>

                <div class="chips-container">
                    <div class="chip" data-text="ต้องการหาซื้อ">ต้องการหาซื้อ</div>
                    <div class="chip" data-text="ต้องการหาเช่า">ต้องการหาเช่า</div>
                    <div class="chip" data-text="ติดต่อเจ้าหน้าที่">ติดต่อเจ้าหน้าที่</div>
                </div>
            </div>
        `;

        // เพิ่มข้อความลงใน DOM
        elements.chatMessages.appendChild(messageElement);

        // เพิ่ม Event Listeners สำหรับ chips
        addInteractiveListeners(messageElement);

        // เลื่อนไปที่ข้อความล่าสุด
        scrollToBottom();

        addMessage('bot', messageText, '', null, options);

    }
    function showTransactionTypeOptions() {
        const chipsItem = {
            type: 'chips',
            options: [
                { text: 'ต้องการซื้อ' },
                { text: 'ต้องการเช่า' },
                { text: 'ต้องการขาย' }
            ]
        };

        // สร้าง HTML สำหรับ chips
        const chipsHtml = renderChips(chipsItem);

        // สร้างข้อความคำถาม (แก้ไขจาก summaryText เป็นการกำหนดค่าโดยตรง)
        const messageText = 'คุณสนใจอสังหาริมทรัพย์ประเภทไหนคะ?';

        // สร้าง message element
        const messageId = Date.now() + 1;
        const messageElement = document.createElement('div');
        messageElement.className = 'message bot-message';
        messageElement.setAttribute('data-message-id', messageId);
        messageElement.innerHTML = `
            <div class="message-avatar">
                <img src="assets/icons/chat-avatar.jpg" alt="Bot">
            </div>
            <div class="message-content">
                <p>${messageText}</p>
                ${chipsHtml}
            </div>
        `;

        // เพิ่มลงใน DOM
        elements.chatMessages.appendChild(messageElement);

        // เพิ่ม Event Listeners สำหรับ chips
        addInteractiveListeners(messageElement);

        // เลื่อนไปที่ข้อความล่าสุด
        scrollToBottom();

        addMessage('bot', messageText, '', null, chipsItem.options);

        // บันทึกข้อมูลลง localStorage
        saveChatToLocalStorage();
    }

    function showPropertyTypeOptions() {
        const chipsItem = {
            type: 'chips',
            options: [
                { text: 'คอนโด' },
                { text: 'บ้าน' },
                { text: 'ทาวน์โฮม' },
                { text: 'ที่ดิน' },
                { text: 'อพาร์ทเม้นท์' }
            ]
        };

        // สร้าง HTML สำหรับ chips
        const chipsHtml = renderChips(chipsItem);

        // สร้างข้อความให้เหมาะสมกับประเภทธุรกรรม
        let messageText = 'คุณสนใจอสังหาริมทรัพย์ประเภทไหนคะ?';
        if (chatState.propertySearch.transaction_type === 'ซื้อ') {
            messageText = 'คุณสนใจซื้ออสังหาริมทรัพย์ประเภทไหนคะ?';
        } else if (chatState.propertySearch.transaction_type === 'เช่า') {
            messageText = 'คุณสนใจเช่าอสังหาริมทรัพย์ประเภทไหนคะ?';
        } else if (chatState.propertySearch.transaction_type === 'ขาย') {
            messageText = 'คุณสนใจขายอสังหาริมทรัพย์ประเภทไหนคะ?';
        }

        // สร้าง message element
        const messageId = Date.now() + 1;
        const messageElement = document.createElement('div');
        messageElement.className = 'message bot-message';
        messageElement.setAttribute('data-message-id', messageId);
        messageElement.innerHTML = `
            <div class="message-avatar">
                <img src="assets/icons/chat-avatar.jpg" alt="Bot">
            </div>
            <div class="message-content">
                <p>${messageText}</p>
                ${chipsHtml}
            </div>
        `;

        // เพิ่มลงใน DOM
        elements.chatMessages.appendChild(messageElement);

        // เพิ่ม Event Listeners สำหรับ chips
        addInteractiveListeners(messageElement);

        // เลื่อนไปที่ข้อความล่าสุด
        scrollToBottom();

        addMessage('bot', messageText, '', null, chipsItem.options);

        // บันทึกข้อมูลลง localStorage
        saveChatToLocalStorage();
    }
    function showLocationOptions() {
        // เพิ่มการตรวจสอบว่ามีข้อความทำเลอยู่แล้วหรือไม่
        const lastLocationMessage = checkForExistingLocationMessage();
        if (lastLocationMessage) {
            console.log('พบข้อความคำถามทำเลที่แสดงอยู่แล้ว ไม่แสดงซ้ำ');
            return; // ออกจากฟังก์ชันโดยไม่แสดงข้อความซ้ำ
        }

        const popularLocations = [
            'กรุงเทพ', 'เชียงใหม่', 'ภูเก็ต', 'พัทยา', 'หัวหิน',
            'รัชดา', 'สุขุมวิท', 'ลาดพร้าว', 'อโศก', 'ทองหล่อ'
        ];

        // สร้าง chips สำหรับทำเลยอดนิยม
        const chipsItem = {
            type: 'chips',
            options: popularLocations.map(location => ({ text: location }))
        };

        // สร้าง HTML สำหรับ chips
        const chipsHtml = renderChips(chipsItem);

        // สร้างข้อความให้เหมาะสม
        let messageText = 'คุณสนใจทำเลไหนคะ? หรือพิมพ์ชื่อทำเลที่ต้องการได้เลย';

        const propertyType = chatState.propertySearch.building_type || 'อสังหาริมทรัพย์';
        if (chatState.propertySearch.transaction_type === 'ซื้อ') {
            messageText = `คุณสนใจซื้อ${propertyType}ในทำเลไหนคะ? เลือกจากตัวเลือกหรือพิมพ์ชื่อทำเลได้เลย`;
        } else if (chatState.propertySearch.transaction_type === 'เช่า') {
            messageText = `คุณสนใจเช่า${propertyType}ในทำเลไหนคะ? เลือกจากตัวเลือกหรือพิมพ์ชื่อทำเลได้เลย`;
        } else if (chatState.propertySearch.transaction_type === 'ขาย') {
            messageText = `${propertyType}ที่ต้องการขายอยู่ในทำเลไหนคะ? เลือกจากตัวเลือกหรือพิมพ์ชื่อทำเลได้เลย`;
        }

        // สร้าง message element ที่มี attribute เฉพาะเพื่อใช้ตรวจสอบซ้ำ
        const messageId = Date.now() + 1;
        const messageElement = document.createElement('div');
        messageElement.className = 'message bot-message';
        messageElement.setAttribute('data-message-id', messageId);
        messageElement.setAttribute('data-message-type', 'location-options'); // เพิ่ม attribute ระบุประเภทข้อความ
        messageElement.innerHTML = `
            <div class="message-avatar">
                <img src="assets/icons/chat-avatar.jpg" alt="Bot">
            </div>
            <div class="message-content">
                <p>${messageText}</p>
                ${chipsHtml}
            </div>
        `;

        // เพิ่มลงใน DOM
        elements.chatMessages.appendChild(messageElement);

        // เพิ่ม Event Listeners สำหรับ chips
        addInteractiveListeners(messageElement);

        // เลื่อนไปที่ข้อความล่าสุด
        scrollToBottom();

        // บันทึกเวลาแสดงข้อความไว้เพื่อป้องกันการซ้ำในระยะเวลาใกล้เคียงกัน
        if (!chatState.lastLocationMessageTime) {
            chatState.lastLocationMessageTime = {};
        }
        chatState.lastLocationMessageTime.timestamp = Date.now();
        chatState.lastLocationMessageTime.messageId = messageId;


        addMessage('bot', messageText, '', null, chipsItem.options);

        // บันทึกข้อมูลลง localStorage
        saveChatToLocalStorage();
    }


    function showPriceOptions() {
        // กำหนดตัวเลือกราคาตามประเภทธุรกรรมและประเภทอสังหาริมทรัพย์
        let priceOptions = [];
         if (chatState.lastPriceOptionsTime && (Date.now() - chatState.lastPriceOptionsTime < 5000)) {
                console.log('เพิ่งแสดงตัวเลือกราคาไปเมื่อไม่นาน ไม่แสดงซ้ำ');
                return;
            }

            // บันทึกเวลาแสดงตัวเลือกราคา
            chatState.lastPriceOptionsTime = Date.now();

            // ตรวจสอบข้อความซ้ำในการสนทนา
            const recentMessages = Array.from(elements.chatMessages.querySelectorAll('.message.bot-message'));
            const lastFiveMessages = recentMessages.slice(-5);

            for (const msg of lastFiveMessages) {
                const msgContent = msg.querySelector('.message-content p');
                if (msgContent && msgContent.textContent.includes('ช่วงราคาเท่าไหร่')) {
                    console.log('พบข้อความเกี่ยวกับราคาที่แสดงอยู่แล้ว ไม่แสดงซ้ำ');
                    return;
                }

                // ตรวจสอบ chips เกี่ยวกับราคา
                const chips = msg.querySelectorAll('.chip');
                for (const chip of chips) {
                    const chipText = chip.textContent.trim();
                    if (chipText.includes('ล้านบาท') || chipText.includes('ไม่จำกัดราคา')) {
                        console.log('พบตัวเลือกเกี่ยวกับราคาที่แสดงอยู่แล้ว ไม่แสดงซ้ำ');
                        return;
                    }
                }
            }

        if (chatState.propertySearch.transaction_type === 'เช่า') {
            // ตัวเลือกสำหรับเช่า
            priceOptions = [
                { text: 'ต่ำกว่า 5,000 บาท' },
                { text: '5,000 - 10,000 บาท' },
                { text: '10,000 - 20,000 บาท' },
                { text: '20,000 - 50,000 บาท' },
                { text: 'มากกว่า 50,000 บาท' },
                { text: 'ไม่จำกัดราคา' }
            ];
        } else {
            // ตัวเลือกสำหรับซื้อ/ขาย
            priceOptions = [
                { text: 'ต่ำกว่า 1 ล้านบาท' },
                { text: '1 - 3 ล้านบาท' },
                { text: '3 - 5 ล้านบาท' },
                { text: '5 - 10 ล้านบาท' },
                { text: 'มากกว่า 10 ล้านบาท' },
                { text: 'ไม่จำกัดราคา' }
            ];
        }

        // สร้าง chips สำหรับตัวเลือกราคา
        const chipsItem = {
            type: 'chips',
            options: priceOptions
        };

        // สร้าง HTML สำหรับ chips
        const chipsHtml = renderChips(chipsItem);

        // สร้างข้อความให้เหมาะสม
        let messageText = 'คุณสนใจในช่วงราคาเท่าไหร่คะ? เลือกจากตัวเลือกหรือพิมพ์ราคาได้เลย';

        const propertyType = chatState.propertySearch.building_type || 'อสังหาริมทรัพย์';
        const location = chatState.propertySearch.location ? `ในพื้นที่${chatState.propertySearch.location}` : '';

        if (chatState.propertySearch.transaction_type === 'ซื้อ') {
            messageText = `คุณสนใจซื้อ${propertyType}${location}ในช่วงราคาเท่าไหร่คะ?`;
        } else if (chatState.propertySearch.transaction_type === 'เช่า') {
            messageText = `คุณสนใจเช่า${propertyType}${location}ในช่วงราคาเท่าไหร่คะ?`;
        } else if (chatState.propertySearch.transaction_type === 'ขาย') {
            messageText = `${propertyType}${location}ที่ต้องการขายอยู่ในช่วงราคาเท่าไหร่คะ?`;
        }

        // สร้าง message element
        const messageId = Date.now() + 1;
        const messageElement = document.createElement('div');
        messageElement.className = 'message bot-message';
        messageElement.setAttribute('data-message-id', messageId);
        messageElement.innerHTML = `
            <div class="message-avatar">
                <img src="assets/icons/chat-avatar.jpg" alt="Bot">
            </div>
            <div class="message-content">
                <p>${messageText}</p>
                ${chipsHtml}
            </div>
        `;

        // เพิ่มลงใน DOM
        elements.chatMessages.appendChild(messageElement);

        // เพิ่ม Event Listeners สำหรับ chips
        addInteractiveListeners(messageElement);

        // เลื่อนไปที่ข้อความล่าสุด
        scrollToBottom();

        addMessage('bot', messageText, '', null, chipsItem.options);
        // บันทึกข้อมูลลง localStorage
        saveChatToLocalStorage();
    }

    function showSearchConfirmation() {
            // สร้างข้อความสรุปข้อมูลการค้นหา
            let summaryText = 'ดิฉันจะช่วยค้นหา';

            if (chatState.propertySearch.transaction_type) {
                if (chatState.propertySearch.transaction_type === 'ซื้อ') {
                    summaryText += ' อสังหาริมทรัพย์สำหรับซื้อ';
                } else if (chatState.propertySearch.transaction_type === 'เช่า') {
                    summaryText += ' อสังหาริมทรัพย์สำหรับเช่า';
                } else if (chatState.propertySearch.transaction_type === 'ขาย') {
                    summaryText += ' อสังหาริมทรัพย์สำหรับขาย';
                }
            }

            if (chatState.propertySearch.building_type) {
                summaryText += ` ประเภท${chatState.propertySearch.building_type}`;
            }

            if (chatState.propertySearch.location) {
                summaryText += ` บริเวณ${chatState.propertySearch.location}`;
            }

            if (chatState.propertySearch.price) {
                let priceText = chatState.propertySearch.price;
                // ตรวจสอบว่าเป็นช่วงราคาหรือไม่
                if (priceText.includes('-')) {
                    summaryText += ` ในช่วงราคา ${priceText} บาท`;
                } else if (priceText === '1') {
                    summaryText += ' ไม่จำกัดราคา';
                } else {
                    summaryText += ` ราคา ${priceText} บาท`;
                }
            } else {
                summaryText += ' ไม่จำกัดราคา';
            }

            summaryText += ' ให้คุณนะคะ';

            // เพิ่มปุ่มยืนยันการค้นหา
            const chipsItem = {
                type: 'chips',
                options: [
                    { text: 'ค้นหาเลย' },
                    { text: 'แก้ไขข้อมูล' }
                ]
            };


        // สร้าง HTML สำหรับ chips
        const chipsHtml = renderChips(chipsItem);

        // สร้าง message element
        const messageId = Date.now() + 1;
     const messageElement = document.createElement('div');
     messageElement.className = 'message bot-message';
     messageElement.setAttribute('data-message-id', messageId);
     messageElement.innerHTML = `
         <div class="message-avatar">
             <img src="assets/icons/chat-avatar.jpg" alt="Bot">
         </div>
         <div class="message-content">
             <p>${summaryText}</p>
             ${chipsHtml}
         </div>
     `;

     // เพิ่มลงใน DOM
     elements.chatMessages.appendChild(messageElement);

     // เพิ่ม Event Listeners สำหรับ chips
     addInteractiveListeners(messageElement);

     // เลื่อนไปที่ข้อความล่าสุด
     scrollToBottom();

     addMessage('bot', summaryText, '', null, chipsItem.options);
     // บันทึกข้อมูลลง localStorage
     saveChatToLocalStorage();
     }


    // ฟังก์ชันใหม่เพื่อตรวจสอบว่ามีข้อความคำถามทำเลที่แสดงอยู่แล้วหรือไม่
    function checkForExistingLocationMessage() {
        // 1. ตรวจสอบข้อความล่าสุดที่มีในพื้นที่แชท
        const recentMessages = Array.from(elements.chatMessages.querySelectorAll('.message.bot-message'));

        // กรณีไม่มีข้อความใดๆ
        if (recentMessages.length === 0) return null;

        // 2. ตรวจสอบจากข้อความ 5 ข้อความล่าสุด
        const lastMessages = recentMessages.slice(-5);

        // 3. ตรวจสอบว่ามีข้อความที่เกี่ยวกับทำเลหรือไม่
        for (const msg of lastMessages) {
            // ตรวจสอบจาก attribute ที่เราตั้งไว้
            if (msg.getAttribute('data-message-type') === 'location-options') {
                return msg;
            }

            // ตรวจสอบจากเนื้อหาข้อความ (กรณีที่ไม่มี attribute)
            const msgContent = msg.querySelector('.message-content p');
            if (msgContent &&
                (msgContent.textContent.includes('ทำเลไหน') ||
                 msgContent.textContent.includes('ในทำเลไหน'))) {
                return msg;
            }

            // ตรวจสอบจาก chips เกี่ยวกับทำเล
            const chips = msg.querySelectorAll('.chip');
            for (const chip of chips) {
                const chipText = chip.textContent.trim();
                if (['กรุงเทพ', 'เชียงใหม่', 'ภูเก็ต', 'พัทยา', 'รัชดา', 'สุขุมวิท'].includes(chipText)) {
                    return msg;
                }
            }
        }

        // 4. ตรวจสอบจากเวลาการแสดงข้อความล่าสุด
        if (chatState.lastLocationMessageTime && chatState.lastLocationMessageTime.timestamp) {
            const timeDiff = Date.now() - chatState.lastLocationMessageTime.timestamp;
            if (timeDiff < 5000) { // ถ้าเพิ่งแสดงข้อความไปไม่เกิน 5 วินาที ถือว่าซ้ำ
                return { id: chatState.lastLocationMessageTime.messageId };
            }
        }

        return null;
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

                } else if (propertyId) {
                    // ถ้าไม่มี clickText แต่มี propertyId
                    const defaultText = `ขอดูรายละเอียดของอสังหาริมทรัพย์ ${propertyId}`;
                    console.log(`Property card clicked with ID: ${propertyId}`);
                    const messageId = Date.now();
                    addMessage('user', defaultText, '', messageId);

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


    function processPropertySearchMessage(message) {
        if (!message) return;

        // ป้องกันการเรียกฟังก์ชันซ้ำซ้อนในระยะเวลาใกล้เคียงกัน
        if (chatState.isProcessingMessage) {
            console.log('กำลังประมวลผลข้อความอื่นอยู่ ไม่ประมวลผลข้อความนี้');
            return;
        }

        chatState.isProcessingMessage = true;

        try {
            const lowerMessage = message.toLowerCase();

            console.log('ประมวลผลข้อความสำหรับการค้นหา:', message);
            console.log('Step ปัจจุบัน:', chatState.currentStep);

            // ตรวจสอบคำสั่งรีเซ็ต
            if (lowerMessage.includes('เริ่มใหม่') ||
                            lowerMessage.includes('รีเซ็ต') ||
                            lowerMessage.includes('reset') ||
                            lowerMessage.includes('ค้นหาใหม่') ||
                            lowerMessage === 'ค้นหาใหม่' ||
                            lowerMessage === 'แก้ไขข้อมูล') {

                            // เพิ่มข้อความแจ้งว่ากำลังเริ่มค้นหาใหม่
                            addMessage('bot', 'เริ่มการค้นหาใหม่ค่ะ');

                            // รีเซ็ตข้อมูลการค้นหา
                            resetPropertySearch();

                            return; // ออกจากฟังก์ชันเมื่อรีเซ็ต
                        }

                       if (analyzeFullSentence(message)) {
                           console.log('พบข้อมูลจากการวิเคราะห์ประโยคเต็ม');

                           if (checkForSearchReady()) {
                               return;
                           }
                       }
            // ตรวจสอบและกำหนดข้อมูลตาม step ปัจจุบัน
            switch (chatState.currentStep) {
                        case 1:
                            // Step 1: ประเภทธุรกรรม (เช่า/ซื้อ)
                            if (lowerMessage.includes('ซื้อ') || lowerMessage.includes('buy')) {
                                chatState.propertySearch.transaction_type = 'ซื้อ';
                                console.log('Step 1: ตรวจพบความตั้งใจซื้อ');
                                chatState.currentStep = 2; // เลื่อนไปยัง step ถัดไป

                                // แสดงตัวเลือกประเภทอสังหาริมทรัพย์
                                showPropertyTypeOptions();
                            } else if (lowerMessage.includes('เช่า') || lowerMessage.includes('rent')) {
                                chatState.propertySearch.transaction_type = 'เช่า';
                                console.log('Step 1: ตรวจพบความตั้งใจเช่า');
                                chatState.currentStep = 2; // เลื่อนไปยัง step ถัดไป

                                // แสดงตัวเลือกประเภทอสังหาริมทรัพย์
                                showPropertyTypeOptions();
                            } else if (lowerMessage.includes('ขาย') || lowerMessage.includes('sell') || lowerMessage.includes('sale')) {
                                chatState.propertySearch.transaction_type = 'ขาย';
                                console.log('Step 1: ตรวจพบความตั้งใจขาย');
                                chatState.currentStep = 2; // เลื่อนไปยัง step ถัดไป

                                // แสดงตัวเลือกประเภทอสังหาริมทรัพย์
                                showPropertyTypeOptions();
                            } else {
                                console.log('Step 1: ไม่พบคำที่เกี่ยวข้องกับการซื้อหรือเช่า แสดงตัวเลือก');
                                // ถ้าไม่พบคำเกี่ยวกับซื้อหรือเช่า ให้แสดงตัวเลือก
                                showTransactionTypeOptions();
                            }
                            break;

                        case 2:
                            // Step 2: ประเภทอสังหาริมทรัพย์
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
                            } else if (lowerMessage.includes('อพาร์ทเม้นท์') || lowerMessage.includes('อพาร์ทเม้น') || lowerMessage.includes('apartment')) {
                                chatState.propertySearch.building_type = 'อพาร์ทเม้นท์';
                                console.log('Step 2: ตรวจพบประเภทอพาร์ทเม้นท์');
                                foundBuildingType = true;
                            }

                            if (foundBuildingType) {
                                chatState.currentStep = 3; // เลื่อนไปยัง step ถัดไป เมื่อพบประเภท

                                // แสดงตัวเลือกสำหรับทำเล/พื้นที่
                                showLocationOptions();
                            } else {
                                console.log('Step 2: ไม่พบคำที่เกี่ยวข้องกับประเภทอสังหาริมทรัพย์ แสดงตัวเลือก');
                                // ถ้าไม่พบประเภทที่ชัดเจน ให้แสดงตัวเลือก
                                showPropertyTypeOptions();
                            }
                            break;

                       case 3:
                           // Step 3: ทำเล/พื้นที่
                           // ตรวจสอบทำเลที่ตั้ง
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

                           // เลื่อนไป step ถัดไปเมื่อพบทำเล หรือถ้าไม่พบให้แสดงตัวเลือก
                           if (locationFound) {
                               chatState.currentStep = 4; // เลื่อนไปยัง step ถัดไป

                               // แสดงตัวเลือกราคาด้วย setTimeout เพื่อให้มีการแสดงผลเป็นลำดับ
                               setTimeout(() => {
                                   showPriceOptions();
                               }, 1000);
                           } else {
                               console.log('Step 3: ไม่พบคำที่เกี่ยวข้องกับทำเล แสดงตัวเลือก');
                                 if (isMessageDuplicateByContent('location-options', message)) {
                                                   console.log('พบการแสดงข้อความเกี่ยวกับทำเลซ้ำซ้อน ข้ามการแสดงซ้ำ');
                                               } else {
                                                   showLocationOptions();
                                               }
                           }
                           break;

                        case 4:
                            // Step 4: ราคาและการค้นหา
                            let searchCommand = false;
                            let priceMatch = null; // เพิ่มการประกาศตัวแปร priceMatch

                            if (lowerMessage.includes('ค้นหา') ||
                                lowerMessage.includes('search') ||
                                lowerMessage.includes('หา') ||
                                lowerMessage.includes('find') ||
                                lowerMessage.includes('ยืนยัน') ||
                                lowerMessage.includes('ตกลง') ||
                                lowerMessage.includes('ok')) {
                                console.log('Step 4: ตรวจพบคำสั่งค้นหา');
                                searchCommand = true;
                            }

                            // ตรวจสอบราคาอีกครั้ง (กรณีที่ยังไม่ได้ระบุในขั้นตอนที่ 3)
                            if (!chatState.propertySearch.price) {
                                priceMatch = message.match(/(\d[\d,]*(?:\.\d+)?)\s*(?:-|ถึง|to)?\s*(\d[\d,]*(?:\.\d+)?)?/i);
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

                            // ถ้ามีคำสั่งค้นหา หรือมีการระบุราคาใหม่ ให้ดำเนินการค้นหา
                            if (searchCommand || priceMatch) {
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
                                } else {
                                    // ถ้าข้อมูลไม่ครบ ให้ขอข้อมูลเพิ่มเติม
                                    addMessage('bot', 'ขออภัย ข้อมูลยังไม่ครบถ้วนสำหรับการค้นหา กรุณาระบุข้อมูลเพิ่มเติม');

                                    if (!hasTransactionType) {
                                        chatState.currentStep = 1;
                                        showTransactionTypeOptions();
                                    } else if (!hasBuildingType) {
                                        chatState.currentStep = 2;
                                        showPropertyTypeOptions();
                                    } else if (!hasLocation) {
                                        chatState.currentStep = 3;
                                        showLocationOptions();
                                    }
                                }
                            } else {
                                // ถ้าไม่มีคำสั่งค้นหาหรือราคา แสดงตัวเลือกยืนยันการค้นหา
                                showPriceOptions();
                            }
                            break;
                    }

            // บันทึกข้อมูลลง localStorage
            saveChatToLocalStorage();
        } finally {
            // หลังจากทำงานเสร็จแล้ว รีเซ็ตสถานะการประมวลผล
            setTimeout(() => {
                chatState.isProcessingMessage = false;
            }, 1000); // รอ 1 วินาทีก่อนรีเซ็ตสถานะเพื่อป้องกันการเรียกซ้ำซ้อนในช่วงเวลาสั้นๆ
        }
    }

    // ประมวลผลข้อความเพื่อการค้นหาอสังหาริมทรัพย์

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

        // เพิ่มส่วนนี้: แสดง greeting message ใหม่
        showGreetingMessage();

        // บันทึกข้อมูลลง localStorage
        saveChatToLocalStorage();
    }


    // ค้นหาอสังหาริมทรัพย์
    function searchProperties() {
        console.log('เริ่มค้นหาอสังหาริมทรัพย์...');

        // ถ้าข้อมูลไม่พร้อม ให้ยกเลิก
        if (!chatState.propertySearch.transaction_type || (!chatState.propertySearch.building_type && !chatState.propertySearch.location)) {
            console.log('ข้อมูลไม่พร้อมสำหรับการค้นหา');
            addMessage('bot', 'ขออภัยค่ะ ข้อมูลยังไม่เพียงพอสำหรับการค้นหา');

            // กลับไปถามข้อมูลที่ขาด
            if (!chatState.propertySearch.transaction_type) {
                chatState.currentStep = 1;
                showTransactionTypeOptions();
            } else if (!chatState.propertySearch.building_type) {
                chatState.currentStep = 2;
                showPropertyTypeOptions();
            } else if (!chatState.propertySearch.location) {
                chatState.currentStep = 3;
                showLocationOptions();
            }
            return;
        }

        // ถ้าไม่มีราคา ให้กำหนดค่าเริ่มต้น
        if (!chatState.propertySearch.price) {
            chatState.propertySearch.price = "1"; // 1 หมายถึงไม่จำกัดราคา
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
        fetch(`${chatState.apiBaseUrl}/chat/prop_listing?web_id=001&room_id=${chatState.sessionId}&price=${chatState.propertySearch.price}&post_type=${mapPropertyType(chatState.propertySearch.building_type)}&zone_id=${encodeURIComponent(chatState.propertySearch.location || '')}`, {
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
                        <p>คุณต้องการดำเนินการอย่างไรต่อไป?</p>
                        ${chipsHtml}
                    </div>
                `;

                // เพิ่มลงใน DOM
                elements.chatMessages.appendChild(messageElement);

                // เพิ่ม Event Listeners สำหรับ chips
                addInteractiveListeners(messageElement);

                // เลื่อนไปที่ข้อความล่าสุด
                scrollToBottom();

                // รีเซ็ต step เพื่อเริ่มการค้นหาใหม่
                chatState.currentStep = 1;
            }
        })
        .catch(error => {
            console.error('เกิดข้อผิดพลาดในการค้นหา:', error);
            addMessage('bot', 'ขออภัย เกิดข้อผิดพลาดในการค้นหา กรุณาลองใหม่อีกครั้ง');

            // แสดงตัวเลือกเริ่มค้นหาใหม่
            const newSearchChips = {
                type: 'chips',
                options: [
                    { text: 'ค้นหาใหม่' },
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
                    <p>คุณต้องการดำเนินการอย่างไรต่อไป?</p>
                    ${chipsHtml}
                </div>
            `;

            // เพิ่มลงใน DOM
            elements.chatMessages.appendChild(messageElement);

            // เพิ่ม Event Listeners สำหรับ chips
            addInteractiveListeners(messageElement);

            // เลื่อนไปที่ข้อความล่าสุด
            scrollToBottom();
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
        if (chatState.propertySearch.price && chatState.propertySearch.price !== '1') {
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

        // รีเซ็ต step เพื่อพร้อมสำหรับการค้นหาใหม่
        chatState.currentStep = 1;

        // เพิ่มตัวเลือกหลังการค้นหา
        setTimeout(() => {
                const askMorePayload = {
                    richContent: [
                        [
                            {
                                type: "chips",
                                options: [
                                    {
                                        text: "ค้นหาใหม่"
                                    },
                                    {
                                        text: "ดูข้อมูลเพิ่มเติม"
                                    },
                                    {
                                        text: "ติดต่อตัวแทนขาย"
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
                        <p>คุณสนใจข้อมูลเพิ่มเติมหรือต้องการค้นหาใหม่ไหมคะ?</p>
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


    function checkForSearchReady() {
        // ตรวจสอบว่ามีข้อมูลที่จำเป็นสำหรับการค้นหาหรือไม่
        // จำเป็นต้องมีอย่างน้อย: ประเภทธุรกรรม และ (ประเภทอสังหา หรือ ทำเล)
        const hasTransactionType = !!chatState.propertySearch.transaction_type;
        const hasBuildingType = !!chatState.propertySearch.building_type;
        const hasLocation = !!chatState.propertySearch.location;

        console.log('ตรวจสอบความพร้อมการค้นหา:');
        console.log('- ประเภทธุรกรรม:', chatState.propertySearch.transaction_type);
        console.log('- ประเภทอสังหา:', chatState.propertySearch.building_type);
        console.log('- ทำเล:', chatState.propertySearch.location);
        console.log('- ราคา:', chatState.propertySearch.price);
        console.log('- Step ปัจจุบัน:', chatState.currentStep);

        // ถ้าไม่มีประเภทธุรกรรม ให้ถามก่อน
        if (!hasTransactionType) {
            showTransactionTypeOptions();
            return true;
        }

        // ถ้ามีประเภทธุรกรรมแล้ว แต่ยังไม่มีประเภทอสังหา ให้ถามต่อ
        if (hasTransactionType && !hasBuildingType) {
//            showPropertyTypeOptions();
            return true;
        }

        // มีประเภทธุรกรรมและประเภทอสังหา แต่ยังไม่มีทำเล
        if (hasTransactionType && hasBuildingType && !hasLocation) {
            console.log('มีข้อมูลประเภทธุรกรรมและประเภทอสังหาแล้ว แต่ยังไม่มีทำเล ขอข้อมูลทำเล');
            chatState.currentStep = 3;
            showLocationOptions();
            return true;
        }

        // มีทำเลแล้ว แต่ยังไม่มีราคา
        if (hasTransactionType && (hasBuildingType || hasLocation) && hasLocation && !chatState.propertySearch.price) {
            console.log('มีข้อมูลทำเลแล้ว แต่ยังไม่มีราคา ขอข้อมูลราคา');
            chatState.currentStep = 4;
            showPriceOptions();
            return true;
        }

        // ถ้ามีข้อมูลครบถ้วน
        if (hasTransactionType && (hasBuildingType || hasLocation) && hasLocation) {
            console.log('มีข้อมูลเพียงพอสำหรับการค้นหา');

            // ถ้ามีราคาแล้ว หรือ อยู่ในขั้นตอนที่ 4 แล้ว ให้แสดงปุ่มยืนยันการค้นหา
//            if (chatState.propertySearch.price || chatState.currentStep >= 4) {
//                showSearchConfirmation();
//                return true;
//            }
        }

        return false;
    }


    function analyzeFullSentence(message) {
        if (!message) return false;

        // Prevent duplicate processing
        if (chatState.isAnalyzingMessage) {
            console.log('กำลังวิเคราะห์ข้อความอื่นอยู่ ไม่วิเคราะห์ข้อความนี้');
            return false;
        }

        chatState.isAnalyzingMessage = true;

        try {
            const lowerMessage = message.toLowerCase();
            let foundNewInfo = false;
            let detectedInfo = {
                transactionType: null,
                buildingType: null,
                location: null,
                price: null
            };

            // Step 1: Detect transaction type (buy/rent/sell)
            if (lowerMessage.includes('ซื้อ') || lowerMessage.includes('buy')) {
                detectedInfo.transactionType = 'ซื้อ';
                console.log('ตรวจพบความตั้งใจซื้อ');
                if (!chatState.propertySearch.transaction_type) {
                    chatState.propertySearch.transaction_type = 'ซื้อ';
                    foundNewInfo = true;
                }
            } else if (lowerMessage.includes('เช่า') || lowerMessage.includes('rent')) {
                detectedInfo.transactionType = 'เช่า';
                console.log('ตรวจพบความตั้งใจเช่า');
                if (!chatState.propertySearch.transaction_type) {
                    chatState.propertySearch.transaction_type = 'เช่า';
                    foundNewInfo = true;
                }
            } else if (lowerMessage.includes('ขาย') || lowerMessage.includes('sell') || lowerMessage.includes('sale')) {
                detectedInfo.transactionType = 'ขาย';
                console.log('ตรวจพบความตั้งใจขาย');
                if (!chatState.propertySearch.transaction_type) {
                    chatState.propertySearch.transaction_type = 'ขาย';
                    foundNewInfo = true;
                }
            }

            // Step 2: Detect property type
            if (lowerMessage.includes('คอนโด') || lowerMessage.includes('condo')) {
                detectedInfo.buildingType = 'คอนโด';
                console.log('ตรวจพบประเภทคอนโด');
                if (!chatState.propertySearch.building_type) {
                    chatState.propertySearch.building_type = 'คอนโด';
                    foundNewInfo = true;
                }
            } else if (lowerMessage.includes('บ้าน') || lowerMessage.includes('house')) {
                detectedInfo.buildingType = 'บ้าน';
                console.log('ตรวจพบประเภทบ้าน');
                if (!chatState.propertySearch.building_type) {
                    chatState.propertySearch.building_type = 'บ้าน';
                    foundNewInfo = true;
                }
            } else if (lowerMessage.includes('ทาวน์') || lowerMessage.includes('town')) {
                detectedInfo.buildingType = 'ทาวน์โฮม';
                console.log('ตรวจพบประเภททาวน์โฮม');
                if (!chatState.propertySearch.building_type) {
                    chatState.propertySearch.building_type = 'ทาวน์โฮม';
                    foundNewInfo = true;
                }
            } else if (lowerMessage.includes('ที่ดิน') || lowerMessage.includes('land')) {
                detectedInfo.buildingType = 'ที่ดิน';
                console.log('ตรวจพบประเภทที่ดิน');
                if (!chatState.propertySearch.building_type) {
                    chatState.propertySearch.building_type = 'ที่ดิน';
                    foundNewInfo = true;
                }
            } else if (lowerMessage.includes('อพาร์ทเม้นท์') || lowerMessage.includes('อพาร์ทเม้น') || lowerMessage.includes('apartment')) {
                detectedInfo.buildingType = 'อพาร์ทเม้นท์';
                console.log('ตรวจพบประเภทอพาร์ทเม้นท์');
                if (!chatState.propertySearch.building_type) {
                    chatState.propertySearch.building_type = 'อพาร์ทเม้นท์';
                    foundNewInfo = true;
                }
            }

            // Step 3: Detect location
            const locations = [
                'กรุงเทพ', 'เชียงใหม่', 'ขอนแก่น', 'พัทยา', 'ลาดพร้าว', 'สุขุมวิท', 'บางนา',
                'อโศก', 'รามคำแหง', 'รัชดา', 'เอกมัย', 'ทองหล่อ', 'พระราม9', 'รัตนาธิเบศร์',
                'เพชรเกษม', 'ภูเก็ต', 'ชลบุรี', 'พระราม2', 'สาทร', 'สีลม', 'ราชดำริ', 'นนทบุรี'
            ];

            for (const loc of locations) {
                if (lowerMessage.includes(loc.toLowerCase())) {
                    detectedInfo.location = loc;
                    console.log('ตรวจพบทำเล:', loc);
                    if (!chatState.propertySearch.location) {
                        chatState.propertySearch.location = loc;
                        foundNewInfo = true;
                    }
                    break;
                }
            }

            // Step 4: Detect price
            // Check if price is already detected by processPriceFromMessage function
            if (processPriceFromMessage(message)) {
                detectedInfo.price = chatState.propertySearch.price;
                console.log('ตรวจพบราคา:', detectedInfo.price);
                foundNewInfo = true;
            }

            // Determine the next step based on detected information
            if (foundNewInfo) {
                console.log('ข้อมูลที่ตรวจพบ:', detectedInfo);

                // Update currentStep based on the most advanced information detected
                if (detectedInfo.transactionType && !chatState.propertySearch.transaction_type) {
                    chatState.currentStep = 1;
                }
                if (detectedInfo.buildingType && chatState.currentStep <= 2) {
                    chatState.currentStep = 3;
                }
                if (detectedInfo.location && chatState.currentStep <= 3) {
                    chatState.currentStep = 4;
                }
                if (detectedInfo.price && chatState.currentStep <= 4) {
                    chatState.currentStep = 5;
                    // If price is the last piece of information, mark as complete
                    if (chatState.propertySearch.transaction_type &&
                        chatState.propertySearch.building_type &&
                        chatState.propertySearch.location) {
                        chatState.propertySearch.isComplete = true;
                        chatState.propertySearch.searchReady = true;
                    }
                }

                // Count how many required pieces of information we've gathered
                const infoCount = [
                    chatState.propertySearch.transaction_type,
                    chatState.propertySearch.building_type,
                    chatState.propertySearch.location,
                    chatState.propertySearch.price
                ].filter(Boolean).length;

                // If we've collected 3+ pieces of information, show search confirmation
                if (infoCount >= 3) {
                    showSearchConfirmation();
                    return true;
                }

                // Determine what information to ask for next
                if (!chatState.propertySearch.transaction_type) {
                    showTransactionTypeOptions();
                } else if (!chatState.propertySearch.building_type) {
                    showPropertyTypeOptions();
                } else if (!chatState.propertySearch.location) {
                    showLocationOptions();
                } else if (!chatState.propertySearch.price) {
                    showPriceOptions();
                }
            }

            return foundNewInfo;
        } finally {
            // Reset analysis state after processing
            setTimeout(() => {
                chatState.isAnalyzingMessage = false;
            }, 1000);
        }
    }

    function processPriceFromMessage(message) {
        if (!message) return false;

        // ตรวจสอบคำที่เกี่ยวกับไม่จำกัดราคาก่อน
        if (message.toLowerCase().includes('ไม่จำกัด') ||
            message.toLowerCase().includes('ไม่ระบุ') ||
            message.toLowerCase().includes('any price')) {
            chatState.propertySearch.price = '1'; // ใช้ค่า 1 แทนไม่จำกัดราคา
            console.log('ตรวจพบคำสั่งไม่จำกัดราคา');
            return true;
        }

        // ตรวจสอบช่วงราคา
        // 1. ช่วงราคาแบบ 1-3 ล้าน หรือ 1,000-3,000
        const rangePattern = /(\d[\d,]*(?:\.\d+)?)\s*(?:-|ถึง|to)\s*(\d[\d,]*(?:\.\d+)?)/i;
        const rangeMatch = message.match(rangePattern);
        if (rangeMatch) {
            const startPrice = rangeMatch[1].replace(/,/g, '');
            const endPrice = rangeMatch[2].replace(/,/g, '');

            // ตรวจสอบหน่วย "ล้าน"
            if (message.includes('ล้าน')) {
                // แปลงจากล้านเป็นบาท
                chatState.propertySearch.price = `${startPrice * 1000000}-${endPrice * 1000000}`;
            } else {
                chatState.propertySearch.price = `${startPrice}-${endPrice}`;
            }

            console.log('ตรวจพบราคาช่วง:', chatState.propertySearch.price);
            return true;
        }

        // 2. ราคาแบบตัวเลขเดียว เช่น 3 ล้าน หรือ 3000
        const singlePattern = /(\d[\d,]*(?:\.\d+)?)\s*(ล้าน|บาท|k|m)?/i;
        const singleMatch = message.match(singlePattern);
        if (singleMatch) {
            let price = singleMatch[1].replace(/,/g, '');
            const unit = singleMatch[2] ? singleMatch[2].toLowerCase() : '';

            // แปลงตามหน่วย
            if (unit === 'ล้าน' || unit === 'm') {
                price = price * 1000000;
            } else if (unit === 'k') {
                price = price * 1000;
            }

            chatState.propertySearch.price = price.toString();
            console.log('ตรวจพบราคาเดี่ยว:', chatState.propertySearch.price);
            return true;
        }

        // 3. ตัวเลือกที่ผู้ใช้เลือกจาก chips
        if (message.includes('ต่ำกว่า')) {
            const numPattern = /(\d[\d,]*(?:\.\d+)?)/;
            const numMatch = message.match(numPattern);
            if (numMatch) {
                let limit = numMatch[1].replace(/,/g, '');

                if (message.includes('ล้าน')) {
                    limit = limit * 1000000;
                }

                chatState.propertySearch.price = `0-${limit}`;
                console.log('ตรวจพบราคาต่ำกว่า:', chatState.propertySearch.price);
                return true;
            }
        }

        if (message.includes('มากกว่า')) {
            const numPattern = /(\d[\d,]*(?:\.\d+)?)/;
            const numMatch = message.match(numPattern);
            if (numMatch) {
                let limit = numMatch[1].replace(/,/g, '');

                if (message.includes('ล้าน')) {
                    limit = limit * 1000000;
                }

                chatState.propertySearch.price = `${limit}-100000000`; // สมมติว่าราคาสูงสุดคือ 100 ล้าน
                console.log('ตรวจพบราคามากกว่า:', chatState.propertySearch.price);
                return true;
            }
        }

        return false;
    }

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
