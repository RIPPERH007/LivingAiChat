
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
        apiBaseUrl: window.env.BASE_API_URL, // เพิ่ม Base URL สำหรับ API
        apiToken: window.env.TOKEN_API, // เพิ่ม Bearer Token
        propertySearch: {
            post_type: null, // ประเภทธุรกรรม (เช่า/ซื้อ)
            building_type: null,    // ประเภทอสังหาริมทรัพย์
            keyword: null,         // ทำเลที่ตั้ง
            price: null,            // ราคา (และค้นหาทันที)
            zone_id: null,
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


    if (elements.chatNowBtn) {
        elements.chatNowBtn.onclick = function() {
            console.log('คลิกปุ่มเริ่มแชท');
            startChat();
            return false;
        };
    }

    if (elements.chatSendBtn) {
        console.log('Setting up chat send button listener');

        // ลบ event handlers เดิมก่อน
        elements.chatSendBtn.onclick = null;

        // เพิ่ม handler ใหม่
        elements.chatSendBtn.onclick = function(e) {
            console.log('Send button clicked!');
            if (e) e.preventDefault();
            sendMessage();
            return false;
        };
    } else {
        console.error('Chat send button not found!');
    }

    // ตรวจสอบ Enter key
    if (elements.chatInput) {
        console.log('Setting up chat input enter listener');

        // ลบ event handlers เดิมก่อน
        elements.chatInput.onkeypress = null;

        // ฟังก์ชันจัดการ Enter key
        const handleEnterKey = function(e) {
            if (e.key === 'Enter') {
                console.log('Enter key pressed!');
                e.preventDefault();
                sendMessage();
                return false;
            }
        };

        // เพิ่ม handler ใหม่
        elements.chatInput.removeEventListener('keypress', handleEnterKey);
        elements.chatInput.addEventListener('keypress', handleEnterKey);
    } else {
        console.error('Chat input not found!');
    }

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
    function connectSocket() {
        console.log('=== Debug PieSocket v5 ===');
        console.log('PieSocket type:', typeof PieSocket);
        console.log('PieSocket object:', PieSocket);

        if (typeof PieSocket === 'undefined') {
            console.error('PieSocket library not loaded!');
            return false;
        }

        try {
            const clusterId = 's8661.sgp1';
            const apiKey = 'mOGIGJTyKOmsesgjpchKEECKLekVGmuCSwNv2wpl';
            const jwtToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJwdWJsaWMtY2hhbm5lbC1vd253ZWItZGV2ZWxvcG1lbnQiLCJwbGF0Zm9ybSI6Im93bndlYiIsImlhdCI6MTc0NzkwMDg0MSwiZXhwIjoyMDYzMjYwODQxfQ.-QO3q_RExUV9NjOMpPuJXqnisGaH1934nN8xvlDJgZU';

            if (chatState.socket && chatState.currentChannel) {
                console.log('PieSocket is already connected');
                return true;
            }

            console.log('Creating PieSocket v5 instance...');
            let pieSocketInstance;

            if (typeof PieSocket === 'function') {
                pieSocketInstance = new PieSocket({
                    clusterId: clusterId,
                    apiKey: apiKey,
                    notifySelf: 1,
                    forceAuth: true,
                    jwt: jwtToken
                });
            } else if (PieSocket && typeof PieSocket.default === 'function') {
                pieSocketInstance = new PieSocket.default({
                    clusterId: clusterId,
                    apiKey: apiKey,
                    notifySelf: 1,
                    forceAuth: true,
                    jwt: jwtToken
                });
            } else {
                pieSocketInstance = PieSocket({
                    clusterId: clusterId,
                    apiKey: apiKey,
                    notifySelf: 1,
                    forceAuth: true,
                    jwt: jwtToken
                });
            }

            if (!pieSocketInstance) {
                throw new Error('Failed to create PieSocket instance');
            }

            chatState.socket = pieSocketInstance;
            console.log('PieSocket v5 instance created:', chatState.socket);

            // 🔥 แก้ไขตรงนี้: ใช้ sessionId เป็น channel name
            const environment = 'development';
            const channelName = `chat-room-${chatState.sessionId}`; // แยก channel ตาม sessionId

            console.log('Subscribing to PRIVATE channel:', channelName);
            console.log('Session ID:', chatState.sessionId);

            // Subscribe to channel แยกตาม sessionId
            const subscribePromise = chatState.socket.subscribe(channelName, {
                platform: 'ownweb',
                sessionId: chatState.sessionId, // ส่ง sessionId ไปด้วย
                roomId: chatState.sessionId     // ส่ง roomId ไปด้วย
            });

            subscribePromise.then((channel) => {
                console.log('Connected to PRIVATE PieSocket channel:', channelName);
                console.log('Only this session will receive messages:', chatState.sessionId);
                chatState.currentChannel = channel;

                // อัปเดตสถานะการเชื่อมต่อ
                if (elements.socketStatus) {
                    elements.socketStatus.textContent = 'Connected';
                    elements.socketStatus.classList.add('connected');
                    elements.socketStatus.classList.remove('disconnected');
                }

                // 🔥 เมื่อมีข้อความใหม่ - ตรวจสอบ sessionId/roomId
                channel.listen('new_message', (message) => {
                    console.log('=== CLIENT RECEIVED MESSAGE ===');
                    console.log('Message data:', message);
                    console.log('Target room:', message.room);
                    console.log('Current session:', chatState.sessionId);

                    // ⚠️ ตรวจสอบว่าข้อความนี้เป็นของ session นี้หรือไม่
                    if (message.room && message.room !== chatState.sessionId) {
                        console.log('❌ Message not for this session, ignoring');
                        return;
                    }

                    // เช็คว่าเป็นข้อความที่แสดงไปแล้วหรือไม่
                    if (isMessageDuplicate(message)) {
                        console.log('Duplicate message, ignoring:', message);
                        return;
                    }

                    // แสดงข้อความตามประเภท
                    if (message.sender === 'admin') {
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
                        saveChatToLocalStorage();
                    }
                    else if (message.sender === 'system') {
                        addSystemMessage(message.text);
                    }
                });

                // เมื่อมีการอัปเดตสถานะแอดมิน
                channel.listen('admin_status_change', (data) => {
                    console.log('Admin status changed:', data);

                    // ⚠️ ตรวจสอบว่าเป็นสำหรับ session นี้หรือไม่
                    if (data.room && data.room !== chatState.sessionId) {
                        console.log('❌ Admin status change not for this session, ignoring');
                        return;
                    }

                    chatState.adminActive = data.adminActive;
                    updateAdminStatusDisplay(data.adminActive, data.adminName);

                    if (data.adminActive) {
                        const message = `${data.adminName || 'แอดมิน'}กำลังให้บริการคุณอยู่`;
                        addSystemMessage(message);
                    } else {
                        addSystemMessage('แชทบอทกลับมาให้บริการแล้ว');
                    }
                });

                // รับการแจ้งเตือนประวัติการสนทนา
                channel.listen('conversation_history', (data) => {
                    console.log('Received conversation history:', data);
                    // ⚠️ ตรวจสอบว่าเป็นสำหรับ session นี้หรือไม่
                    if (data.room && data.room !== chatState.sessionId) {
                        console.log('❌ Conversation history not for this session, ignoring');
                        return;
                    }

                    if (data.messages && data.messages.length > 0) {
                        displayChatHistory(data.messages);
                    }
                });

            }).catch((error) => {
                console.error('Error subscribing to PieSocket:', error);

                // ลองเชื่อมต่อใหม่หลังจาก 3 วินาที
                setTimeout(() => {
                    console.log('Retrying PieSocket connection...');
                    connectSocket();
                }, 3000);

                if (elements.socketStatus) {
                    elements.socketStatus.textContent = 'Reconnecting...';
                    elements.socketStatus.classList.add('disconnected');
                    elements.socketStatus.classList.remove('connected');
                }
            });

            console.log('PieSocket v5 initialized for session:', chatState.sessionId);
            return true;
        } catch (error) {
            console.error('Error connecting to PieSocket v5:', error);
            console.error('Error details:', error.message);
            console.error('PieSocket object structure:', PieSocket);
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

            if (!chatState.socket) {
                console.log('เชื่อมต่อ Pie.Socket');
                connectSocket();
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

        if (!shouldBotRespond()) {
                console.log('แอดมินกำลังเปิดใช้งานอยู่ บอทจะไม่ตอบสนองต่อการคลิก chip');
                return;
            }


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


    function sendMessage() {
        console.log('=== sendMessage() called ===');

        const message = elements.chatInput.value.trim();
        console.log('Message to send:', message);

        if (!message || chatState.isSending) {
            console.log('Message empty or already sending');
            return;
        }

        try {
            console.log('Processing message...');

            // ตั้งสถานะเป็นกำลังส่ง
            chatState.isSending = true;

            const messageId = Date.now();
            console.log('Generated messageId:', messageId);

            // แสดงข้อความผู้ใช้ (ตรงนี้สำคัญ - ต้องเรียก addMessage)
            console.log('Calling addMessage for user...');
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
    console.log('=== addMessage() called ===');
        console.log('Sender:', sender);
        console.log('Text:', text);
        console.log('MessageId:', messageId);

        const timestamp = messageId || Date.now();

        // ตรวจสอบว่ามีข้อความนี้อยู่แล้วหรือไม่
        if (isMessageDuplicate(timestamp)) {
            console.log('ข้อความซ้ำ ไม่แสดงซ้ำ:', text);
            return timestamp;
        }

        console.log('Creating message element...');

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

    // หาส่วนท้ายของฟังก์ชัน addMessage() (ประมาณบรรทัด 850-950)
    // เพิ่ม debug ตรงนี้:

    if ((sender === 'user' || sender === 'bot') && chatState.currentChannel) {
        console.log('=== SENDING SOCKET IMMEDIATELY ===');

        // สร้างข้อมูลสำหรับส่ง socket
        const socketData = {
            sender: sender,
            text: text,
            timestamp: timestamp,
            room: chatState.sessionId,
            sessionId: chatState.sessionId,
            platform: 'ownweb'
        };

        console.log('Socket data:', socketData);

        // ส่งทันที
        try {
            chatState.currentChannel.publish('new_message', socketData);
            console.log(`ส่งข้อความ ${sender} ผ่าน PieSocket สำเร็จ`);
        } catch (error) {
            console.error('Error sending socket message:', error);
        }
    } else {
        console.log('=== SOCKET NOT SENT ===');
        console.log('Sender:', sender);
        console.log('Has channel:', !!chatState.currentChannel);
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
        if (!shouldBotRespond()) {
                console.log('แอดมินกำลังเปิดใช้งานอยู่ บอทจะไม่แสดง greeting message');
                return;
        }

        const chipsItem = {
                    type: 'chips',
                    options: [
                        { text: 'ต้องการหาซื้อ' },
                        { text: 'ต้องการหาเช่า' },
                        { text: 'ติดต่อเจ้าหน้าที่' }
                    ]
                };
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
//        elements.chatMessages.appendChild(messageElement);

        // เพิ่ม Event Listeners สำหรับ chips
        addInteractiveListeners(messageElement);

        // เลื่อนไปที่ข้อความล่าสุด
        scrollToBottom();
        const messageText = '👋 สวัสดีค่ะ ฉันคือผู้ช่วยอัจฉริยะของ My Property พร้อมช่วยคุณค้นหา ซื้อ ขาย หรือเช่าอสังหาฯ แบบง่าย ๆ สนใจเรื่องไหน ถามกับฉันได้เลย!';

        addMessage('bot', messageText, '', null, chipsItem.options);

    }
    function showTransactionTypeOptions() {
        if (!shouldBotRespond()) {
                console.log('แอดมินกำลังเปิดใช้งานอยู่ บอทจะไม่แสดงตัวเลือกประเภทธุรกรรม');
                return;
        }
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
//        elements.chatMessages.appendChild(messageElement);

        // เพิ่ม Event Listeners สำหรับ chips
        addInteractiveListeners(messageElement);

        // เลื่อนไปที่ข้อความล่าสุด
        scrollToBottom();

        addMessage('bot', messageText, '', null, chipsItem.options);

        // บันทึกข้อมูลลง localStorage
        saveChatToLocalStorage();
    }

    function showPropertyTypeOptions() {
        if (!shouldBotRespond()) {
                console.log('แอดมินกำลังเปิดใช้งานอยู่ บอทจะไม่แสดงตัวเลือกประเภทอสังหาริมทรัพย์');
                return;
            }
        const chipsItem = {
            type: 'chips',
            options: [
                { text: 'คอนโด' },
                { text: 'บ้าน' },
                { text: 'ทาวน์โฮม' },
                { text: 'อาคารพาณิชย์' },
                { text: 'อพาร์ทเม้นท์' }
            ]
        };

        // สร้าง HTML สำหรับ chips
        const chipsHtml = renderChips(chipsItem);

        // สร้างข้อความให้เหมาะสมกับประเภทธุรกรรม
        let messageText = 'คุณสนใจอสังหาริมทรัพย์ประเภทไหนคะ?';
        if (chatState.propertySearch.post_type === 'ซื้อ') {
            messageText = 'คุณสนใจซื้ออสังหาริมทรัพย์ประเภทไหนคะ?';
        } else if (chatState.propertySearch.post_type === 'เช่า') {
            messageText = 'คุณสนใจเช่าอสังหาริมทรัพย์ประเภทไหนคะ?';
        } else if (chatState.propertySearch.post_type === 'ขาย') {
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
//        elements.chatMessages.appendChild(messageElement);

        // เพิ่ม Event Listeners สำหรับ chips
        addInteractiveListeners(messageElement);

        // เลื่อนไปที่ข้อความล่าสุด
        scrollToBottom();

        addMessage('bot', messageText, '', null, chipsItem.options);

        // บันทึกข้อมูลลง localStorage
        saveChatToLocalStorage();
    }
    function showLocationOptions() {

         if (!shouldBotRespond()) {
                console.log('แอดมินกำลังเปิดใช้งานอยู่ บอทจะไม่แสดงตัวเลือกทำเล');
                return;
            }
        // เพิ่มการตรวจสอบว่ามีข้อความทำเลอยู่แล้วหรือไม่
        const lastLocationMessage = checkForExistingLocationMessage();
        if (lastLocationMessage) {
            console.log('พบข้อความคำถามทำเลที่แสดงอยู่แล้ว ไม่แสดงซ้ำ');
            return; // ออกจากฟังก์ชันโดยไม่แสดงข้อความซ้ำ
        }

         const popularLocations = chatState.popularLocations || [
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
        if (chatState.propertySearch.post_type === 'ซื้อ') {
            messageText = `คุณสนใจซื้อ${propertyType}ในทำเลไหนคะ? เลือกจากตัวเลือกหรือพิมพ์ชื่อทำเลได้เลย`;
        } else if (chatState.propertySearch.post_type === 'เช่า') {
            messageText = `คุณสนใจเช่า${propertyType}ในทำเลไหนคะ? เลือกจากตัวเลือกหรือพิมพ์ชื่อทำเลได้เลย`;
        } else if (chatState.propertySearch.post_type === 'ขาย') {
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
//        elements.chatMessages.appendChild(messageElement);

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

        if (!shouldBotRespond()) {
                console.log('แอดมินกำลังเปิดใช้งานอยู่ บอทจะไม่แสดงตัวเลือกราคา');
                return;
            }
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

        if (chatState.propertySearch.post_type === 'เช่า') {
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
        const location = chatState.propertySearch.keyword ? `ในพื้นที่${chatState.propertySearch.keyword}` : '';

        if (chatState.propertySearch.post_type === 'ซื้อ') {
            messageText = `คุณสนใจซื้อ${propertyType}${location}ในช่วงราคาเท่าไหร่คะ?`;
        } else if (chatState.propertySearch.post_type === 'เช่า') {
            messageText = `คุณสนใจเช่า${propertyType}${location}ในช่วงราคาเท่าไหร่คะ?`;
        } else if (chatState.propertySearch.post_type === 'ขาย') {
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
//        elements.chatMessages.appendChild(messageElement);

        // เพิ่ม Event Listeners สำหรับ chips
        addInteractiveListeners(messageElement);

        // เลื่อนไปที่ข้อความล่าสุด
        scrollToBottom();

        addMessage('bot', messageText, '', null, chipsItem.options);
        // บันทึกข้อมูลลง localStorage
        saveChatToLocalStorage();
    }

    function showSearchConfirmation() {

            if (!shouldBotRespond()) {
                    console.log('แอดมินกำลังเปิดใช้งานอยู่ บอทจะไม่แสดงยืนยันการค้นหา');
                    return;
                }
            // สร้างข้อความสรุปข้อมูลการค้นหา
            let summaryText = 'ดิฉันจะช่วยค้นหา';

            if (chatState.propertySearch.post_type) {
                if (chatState.propertySearch.post_type === 'ซื้อ') {
                    summaryText += ' อสังหาริมทรัพย์สำหรับซื้อ';
                } else if (chatState.propertySearch.post_type === 'เช่า') {
                    summaryText += ' อสังหาริมทรัพย์สำหรับเช่า';
                } else if (chatState.propertySearch.post_type === 'ขาย') {
                    summaryText += ' อสังหาริมทรัพย์สำหรับขาย';
                }
            }

            if (chatState.propertySearch.building_type) {
                summaryText += ` ประเภท${chatState.propertySearch.building_type}`;
            }

            if (chatState.propertySearch.keyword) {
                summaryText += ` บริเวณ${chatState.propertySearch.keyword}`;
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
//     elements.chatMessages.appendChild(messageElement);

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

            // ตรวจสอบจาก chips เกี่ยวกับทำเล (ใช้ข้อมูลจาก API)
            const chips = msg.querySelectorAll('.chip');
            for (const chip of chips) {
                const chipText = chip.textContent.trim();
                // ใช้ชื่อทำเลจาก API อย่างน้อย 6 รายการ
                const popularNames = (chatState.popularLocations || []).slice(0, 6);
                if (popularNames.includes(chipText)) {
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
        // ตรวจสอบสถานะแอดมินก่อน - ถ้าแอดมินเปิดใช้งาน ไม่ส่งข้อความ
        if (!shouldBotRespond()) {
            console.log('แอดมินกำลังเปิดใช้งานอยู่ ไม่ส่งข้อความไปยัง API');
            return;
        }

        // สร้าง FormData สำหรับส่งข้อมูล
        const formData = new FormData();
        formData.append('room_id', chatState.sessionId);
        formData.append('web_id', chatState.webId);
        formData.append('detail', message);
        formData.append('type', type);

        const sender = type === "1" ? 'user' : 'bot';
        formData.append('sender', sender);

        if (options) {
            const optionsData = Array.isArray(options) ? options : [options];
            formData.append('options', JSON.stringify(optionsData));
        }

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

            // ตรวจสอบการตอบกลับจาก API - เฉพาะเมื่อแอดมินไม่เปิดใช้งาน
            if (shouldBotRespond() && data.status === "success" && data.message) {
                if (data.type === "2" && data.options && Array.isArray(data.options)) {
                    const chipsItem = {
                        type: 'chips',
                        options: data.options.map(option => ({ text: option }))
                    };

                    const chipsHtml = renderChips(chipsItem);
                    const botMessageId = Date.now() + 1;
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

                    elements.chatMessages.appendChild(messageElement);
                    addInteractiveListeners(messageElement);
                    scrollToBottom();
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


    async function processPropertySearchMessage(message) {
        if (!message) return;

        // ตรวจสอบสถานะแอดมินก่อนประมวลผล
        if (!shouldBotRespond()) {
            console.log('แอดมินกำลังเปิดใช้งานอยู่ บอทจะไม่ประมวลผลข้อความ');
            return;
        }

        // ป้องกันการเรียกฟังก์ชันซ้ำซ้อนในระยะเวลาใกล้เคียงกัน
        if (chatState.isProcessingMessage) {
            console.log('กำลังประมวลผลข้อความอื่นอยู่ ไม่ประมวลผลข้อความนี้');
            return;
        }

        chatState.isProcessingMessage = true;

        try {
            const lowerMessage = message.toLowerCase();
            console.log('ประมวลผลข้อความสำหรับการค้นหา:', message);

            // ตรวจสอบคำสั่งรีเซ็ต
            if (lowerMessage.includes('เริ่มใหม่') ||
                lowerMessage.includes('รีเซ็ต') ||
                lowerMessage.includes('ค้นหาใหม่') ||
                lowerMessage === 'แก้ไขข้อมูล') {

                addMessage('bot', 'เริ่มการค้นหาใหม่ค่ะ');
                resetPropertySearch();
                return;
            }

            if (lowerMessage.includes('ติดต่อเจ้าหน้าที่')) {
                contactAdmin();
                return;
            }

            if (analyzeFullSentence(message)) {
                console.log('พบข้อมูลจากการวิเคราะห์ประโยคเต็ม');
                if (checkForSearchReady()) {
                    return;
                }
            }

            // ประมวลผลตาม step ปัจจุบัน
            switch (chatState.currentStep) {
                case 1:
                    // ประมวลผลประเภทธุรกรรม
                    if (lowerMessage.includes('ซื้อ') || lowerMessage.includes('buy')) {
                        chatState.propertySearch.post_type = 'ซื้อ';
                        chatState.currentStep = 2;
                        showPropertyTypeOptions();
                    } else if (lowerMessage.includes('เช่า') || lowerMessage.includes('rent')) {
                        chatState.propertySearch.post_type = 'เช่า';
                        chatState.currentStep = 2;
                        showPropertyTypeOptions();
                    } else if (lowerMessage.includes('ขาย') || lowerMessage.includes('sell')) {
                        chatState.propertySearch.post_type = 'ขาย';
                        chatState.currentStep = 2;
                        showPropertyTypeOptions();
                    } else {
                        showTransactionTypeOptions();
                    }
                    break;

                case 2:
                    // ประมวลผลประเภทอสังหาริมทรัพย์
                    let foundBuildingType = false;

                    if (lowerMessage.includes('คอนโด')) {
                        chatState.propertySearch.building_type = 'คอนโด';
                        foundBuildingType = true;
                    } else if (lowerMessage.includes('บ้าน')) {
                        chatState.propertySearch.building_type = 'บ้าน';
                        foundBuildingType = true;
                    } else if (lowerMessage.includes('ทาวน์')) {
                        chatState.propertySearch.building_type = 'ทาวน์โฮม';
                        foundBuildingType = true;
                    }

                    if (foundBuildingType) {
                        chatState.currentStep = 3;
                        showLocationOptions();
                    } else {
                        showPropertyTypeOptions();
                    }
                    break;

                case 3:
                    // ประมวลผลทำเล
                    const locations = chatState.locationList || [];
                    let locationFound = false;

                    for (const loc of locations) {
                        if (lowerMessage.includes(loc.toLowerCase())) {
                            chatState.propertySearch.keyword = loc;
                            const zoneId = await getZoneIdFromAPI(loc);
                            chatState.propertySearch.zone_id = zoneId;
                            locationFound = true;
                            break;
                        }
                    }

                    if (locationFound) {
                        chatState.currentStep = 4;
                        setTimeout(() => showPriceOptions(), 1000);
                    } else {
                        showLocationOptions();
                    }
                    break;

                case 4:
                    // ประมวลผลราคาและการค้นหา
                    let searchCommand = false;
                    if (lowerMessage.includes('ค้นหา') ||
                        lowerMessage.includes('ยืนยัน') ||
                        lowerMessage.includes('ตกลง')) {
                        searchCommand = true;
                    }

                    if (searchCommand) {
                        if (!chatState.propertySearch.price) {
                            chatState.propertySearch.price = "1";
                        }
                        chatState.propertySearch.isComplete = true;
                        chatState.propertySearch.searchReady = true;
                        searchProperties();
                    } else {
                        showPriceOptions();
                    }
                    break;
            }

            saveChatToLocalStorage();
        } finally {
            setTimeout(() => {
                chatState.isProcessingMessage = false;
            }, 1000);
        }
    }

    // ประมวลผลข้อความเพื่อการค้นหาอสังหาริมทรัพย์

    // รีเซ็ตข้อมูลการค้นหา
    function resetPropertySearch() {
        chatState.propertySearch = {
            post_type: null,
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

// ฟังก์ชันติดต่อเจ้าหน้าที่ (Call Center)
async function contactAdmin() {
    try {
        console.log('ผู้ใช้ต้องการติดต่อเจ้าหน้าที่');

        // แสดงข้อความกำลังดำเนินการ
        addMessage('bot', 'กำลังติดต่อเจ้าหน้าที่ให้คุณ กรุณารอสักครู่...');

        // เรียก API เพื่อแจ้งเจ้าหน้าที่
        const response = await fetch(`${chatState.apiBaseUrl}/chat/callcenter`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${chatState.apiToken}`,
            },
        });

        const data = await response.json();
        console.log('ผลการติดต่อเจ้าหน้าที่:', data);

        // ถ้าติดต่อสำเร็จ
        if (data.status === "success" || data.result_code === 1) {
            // แสดงข้อความแจ้งผู้ใช้
            const successMessage = `ขอบคุณที่ติดต่อเรา เจ้าหน้าที่ของเราจะเข้ามาตอบคำถามของคุณในไม่ช้า

ระหว่างรอการตอบกลับ คุณสามารถแจ้งรายละเอียดเพิ่มเติมหรือคำถามที่สงสัยไว้ล่วงหน้าได้ เพื่อให้เจ้าหน้าที่สามารถช่วยเหลือคุณได้อย่างรวดเร็วและตรงประเด็น`;

            // แสดงข้อความตอบกลับพร้อมตัวเลือก
            const followUpOptions = {
                type: 'chips',
                options: [
                    { text: 'กลับไปค้นหาอสังหาริมทรัพย์' },
                    { text: 'ดูรายการอสังหาริมทรัพย์ยอดนิยม' }
                ]
            };

            // แสดงข้อความและตัวเลือก
            addMessage('bot', successMessage, '', null, followUpOptions.options);

            // เพิ่มข้อความระบบแจ้งเตือน
            addSystemMessage('กำลังเชื่อมต่อกับเจ้าหน้าที่');

            return true;
        } else {
            // กรณีติดต่อไม่สำเร็จ
            const errorMessage = 'ขออภัย ระบบไม่สามารถติดต่อเจ้าหน้าที่ได้ในขณะนี้ คุณสามารถลองอีกครั้งในภายหลัง หรือติดต่อเราทางช่องทางอื่นได้ที่ support@myproperty.com หรือโทร 02-XXX-XXXX';
            addMessage('bot', errorMessage);

            // ตัวเลือกหลังแสดงข้อความผิดพลาด
            const errorOptions = {
                type: 'chips',
                options: [
                    { text: 'ลองอีกครั้ง' },
                    { text: 'กลับไปค้นหาอสังหาริมทรัพย์' }
                ]
            };

            // แสดงตัวเลือกหลังข้อความผิดพลาด
            setTimeout(() => {
                addMessage('bot', 'คุณต้องการทำอย่างไรต่อไป?', '', null, errorOptions.options);
            }, 1000);

            return false;
        }
    } catch (error) {
        console.error('เกิดข้อผิดพลาดในการติดต่อเจ้าหน้าที่:', error);

        // กรณีเกิด error
        const fallbackMessage = 'ขออภัย เกิดข้อผิดพลาดในการติดต่อเจ้าหน้าที่ คุณสามารถลองอีกครั้งในภายหลัง หรือติดต่อเราผ่านช่องทางอื่น';
        addMessage('bot', fallbackMessage);

        return false;
    }
}
    // ค้นหาอสังหาริมทรัพย์
    async function searchProperties() {
        console.log('เริ่มค้นหาอสังหาริมทรัพย์...');

        // ถ้าข้อมูลไม่พร้อม ให้ยกเลิก
        if (!chatState.propertySearch.post_type || (!chatState.propertySearch.building_type && !chatState.propertySearch.keyword)) {
            console.log('ข้อมูลไม่พร้อมสำหรับการค้นหา');
            addMessage('bot', 'ขออภัยค่ะ ข้อมูลยังไม่เพียงพอสำหรับการค้นหา');

            // กลับไปถามข้อมูลที่ขาด
            if (!chatState.propertySearch.post_type) {
                chatState.currentStep = 1;
                showTransactionTypeOptions();
            } else if (!chatState.propertySearch.building_type) {
                chatState.currentStep = 2;
                showPropertyTypeOptions();
            } else if (!chatState.propertySearch.keyword) {
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
            property_tag: mapTransactionType(chatState.propertySearch.post_type),
            zone: chatState.propertySearch.keyword,
            price: chatState.propertySearch.price
        };
         const priceId = mapPriceToId(chatState.propertySearch.price, chatState.propertySearch.post_type);

        // แปลงข้อมูลสำหรับส่งไป API
        const buildingType = mapPropertyType(chatState.propertySearch.building_type);

        let postType = '';
        if (chatState.propertySearch.post_type) {
                        if (chatState.propertySearch.post_type === 'ซื้อ') {
                            postType = 1;
                        } else if (chatState.propertySearch.post_type === 'เช่า') {
                            postType = 2;
                        } else if (chatState.propertySearch.post_type === 'ขาย') {
                            postType = 3;
                        }
                    }


        // ส่งคำขอค้นหาไปยัง API โดยใช้รหัส ID ของราคาแทนค่าราคาโดยตรง
        const apiUrl = `${chatState.apiBaseUrl}/chat/prop_listing?web_id=001&room_id=${chatState.sessionId}&price=${priceId}&post_type=${postType}&zone_id=${chatState.propertySearch.zone_id}&building_type=${buildingType}`;

        console.log('เรียก API:', apiUrl);
        console.log('ข้อมูลที่ส่ง: ราคา ID =', priceId, 'ประเภท =', postType, 'โซน =', zoneId);

        // ส่งคำขอค้นหาไปยัง API
        fetch(apiUrl, {
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
        if (chatState.propertySearch.post_type) {
            summaryText += ` สำหรับ${chatState.propertySearch.post_type}`;
        }
        if (chatState.propertySearch.building_type) {
            summaryText += ` ประเภท${chatState.propertySearch.building_type}`;
        }
        if (chatState.propertySearch.keyword) {
            summaryText += ` บริเวณ${chatState.propertySearch.keyword}`;
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
        if (type.includes('ทาวน์เฮ้าส์') || type.includes('ทาวน์โฮม') || type.includes('townhouse') || type.includes('townhome')) return 6;
        if (type.includes('อาคารพาณิชย์') || type.includes('land')) return 4;
        if (type.includes('อพาร์ทเม้นท์') || type.includes('อพาร์ทเม้น') || type.includes('apartment')) return 5;
        if (type.includes('บ้านแฝด') || type.includes('บ้านแฝด') || type.includes('apartment')) return 13;
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
        const hasTransactionType = !!chatState.propertySearch.post_type;
        const hasBuildingType = !!chatState.propertySearch.building_type;
        const hasLocation = !!chatState.propertySearch.keyword;

        console.log('ตรวจสอบความพร้อมการค้นหา:');
        console.log('- ประเภทธุรกรรม:', chatState.propertySearch.post_type);
        console.log('- ประเภทอสังหา:', chatState.propertySearch.building_type);
        console.log('- ทำเล:', chatState.propertySearch.keyword);
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


    async function analyzeFullSentence(message) {
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
                if (!chatState.propertySearch.post_type) {
                    chatState.propertySearch.post_type = 'ซื้อ';
                    foundNewInfo = true;
                }
            } else if (lowerMessage.includes('เช่า') || lowerMessage.includes('rent')) {
                detectedInfo.transactionType = 'เช่า';
                console.log('ตรวจพบความตั้งใจเช่า');
                if (!chatState.propertySearch.post_type) {
                    chatState.propertySearch.post_type = 'เช่า';
                    foundNewInfo = true;
                }
            } else if (lowerMessage.includes('ขาย') || lowerMessage.includes('sell') || lowerMessage.includes('sale')) {
                detectedInfo.transactionType = 'ขาย';
                console.log('ตรวจพบความตั้งใจขาย');
                if (!chatState.propertySearch.post_type) {
                    chatState.propertySearch.post_type = 'ขาย';
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
            } else if (lowerMessage.includes('อาคารพาณิชย์') || lowerMessage.includes('land')) {
                detectedInfo.buildingType = 'อาคารพาณิชย์';
                console.log('ตรวจพบประเภทอาคารพาณิชย์');
                if (!chatState.propertySearch.building_type) {
                    chatState.propertySearch.building_type = 'อาคารพาณิชย์';
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
            const locations = chatState.locationList || [
                'กรุงเทพ', 'เชียงใหม่', 'ขอนแก่น', 'พัทยา', 'ลาดพร้าว', 'สุขุมวิท', 'บางนา',
                'อโศก', 'รามคำแหง', 'รัชดา', 'เอกมัย', 'ทองหล่อ', 'พระราม9', 'รัตนาธิเบศร์',
                'เพชรเกษม', 'ภูเก็ต', 'ชลบุรี', 'พระราม2', 'สาทร', 'สีลม', 'ราชดำริ', 'นนทบุรี'
            ];

            for (const loc of locations) {
                if (lowerMessage.includes(loc.toLowerCase())) {
                    detectedInfo.location = loc;
                    console.log('ตรวจพบทำเล:', loc);
                    if (!chatState.propertySearch.keyword) {
                        chatState.propertySearch.keyword = loc;
                        zoneId = await getZoneIdFromAPI(chatState.propertySearch.keyword);
                        chatState.propertySearch.zone_id = zoneId;
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
                if (detectedInfo.transactionType && !chatState.propertySearch.post_type) {
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
                    if (chatState.propertySearch.post_type &&
                        chatState.propertySearch.building_type &&
                        chatState.propertySearch.keyword) {
                        chatState.propertySearch.isComplete = true;
                        chatState.propertySearch.searchReady = true;
                    }
                }

                // Count how many required pieces of information we've gathered
                const infoCount = [
                    chatState.propertySearch.post_type,
                    chatState.propertySearch.building_type,
                    chatState.propertySearch.keyword,
                    chatState.propertySearch.price
                ].filter(Boolean).length;

                // If we've collected 3+ pieces of information, show search confirmation
                if (infoCount >= 3) {
                    showSearchConfirmation();
                    return true;
                }

                // Determine what information to ask for next
                if (!chatState.propertySearch.post_type) {
                    showTransactionTypeOptions();
                } else if (!chatState.propertySearch.building_type) {
                    showPropertyTypeOptions();
                } else if (!chatState.propertySearch.keyword) {
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

    // ฟังก์ชันแปลงค่าราคาเป็นรหัส ID
    function mapPriceToId(price, transactionType) {
        // ตรวจสอบว่าเป็นประเภทการเช่าหรือการซื้อ
        const isRent = transactionType === 'เช่า' || transactionType === 'rent';

        // ถ้าไม่มีข้อมูลราคา หรือราคาเป็น 1 (หมายถึงไม่จำกัดราคา) ให้ส่งค่า 0 (ไม่ระบุ)
        if (!price || price === '1' || price === 1) {
            return 0;
        }

        // ถ้าราคามีช่วง (มีเครื่องหมาย -)
        if (typeof price === 'string' && price.includes('-')) {
            const [minPrice, maxPrice] = price.split('-').map(p => parseFloat(p.replace(/,/g, '')));
            return findPriceRangeId(minPrice, maxPrice, isRent);
        }

        // ถ้าราคาเป็นตัวเลขหรือสตริงที่ระบุเพียงค่าเดียว
        const numericPrice = parseFloat(price.toString().replace(/,/g, ''));

        // หาช่วงราคาที่เหมาะสม
        return findClosestPriceRangeId(numericPrice, isRent);
    }

    // ฟังก์ชันช่วยหารหัส ID จากช่วงราคาที่ระบุ
    function findPriceRangeId(minPrice, maxPrice, isRent) {
        if (isRent) {
            // สำหรับราคาเช่า
            return findRentPriceRangeId(minPrice, maxPrice);
        } else {
            // สำหรับราคาซื้อ
            return findBuyPriceRangeId(minPrice, maxPrice);
        }
    }

    // ฟังก์ชันช่วยหารหัส ID ที่ใกล้เคียงที่สุดสำหรับราคาที่ระบุเพียงค่าเดียว
    function findClosestPriceRangeId(price, isRent) {
        if (isRent) {
            // สำหรับราคาเช่า
            return findClosestRentPriceRangeId(price);
        } else {
            // สำหรับราคาซื้อ
            return findClosestBuyPriceRangeId(price);
        }
    }

    // ฟังก์ชันช่วยหารหัส ID สำหรับช่วงราคาเช่า
    function findRentPriceRangeId(minPrice, maxPrice) {
        const rentRanges = [
            { id: 0, min: null, max: null, name: 'ไม่ระบุ' },
            { id: 1, min: 0, max: 5000, name: 'น้อยกว่า 5,000' },
            { id: 2, min: 5000, max: 10000, name: '5,000 - 10,000' },
            { id: 3, min: 10000, max: 20000, name: '10,000 - 20,000' },
            { id: 4, min: 20000, max: 30000, name: '20,000 - 30,000' },
            { id: 5, min: 30000, max: 40000, name: '30,000 - 40,000' },
            { id: 6, min: 40000, max: 50000, name: '40,000 - 50,000' },
            { id: 7, min: 50000, max: 60000, name: '50,000 - 60,000' },
            { id: 8, min: 60000, max: 70000, name: '60,000 - 70,000' },
            { id: 9, min: 70000, max: 80000, name: '70,000 - 80,000' },
            { id: 10, min: 80000, max: 90000, name: '80,000 - 90,000' },
            { id: 11, min: 90000, max: 100000, name: '90,000 - 100,000' },
            { id: 12, min: 100000, max: 150000, name: '100,000 - 150,000' },
            { id: 13, min: 150000, max: 200000, name: '150,000 - 200,000' },
            { id: 14, min: 200000, max: 250000, name: '200,000 - 250,000' },
            { id: 15, min: 250000, max: 300000, name: '250,000 - 300,000' },
            { id: 16, min: 300000, max: 350000, name: '300,000 - 350,000' },
            { id: 17, min: 350000, max: 400000, name: '350,000 - 400,000' },
            { id: 18, min: 400000, max: 450000, name: '400,000 - 450,000' },
            { id: 19, min: 450000, max: 500000, name: '450,000 - 500,000' },
            { id: 20, min: 0, max: 500000, name: 'น้อยกว่า 500,000' },
            { id: 21, min: 500000, max: 1000000, name: '500,000 - 1,000,000' },
            { id: 22, min: 1000000, max: Infinity, name: 'มากกว่า 1 ล้าน' }
        ];

        // ตรวจสอบช่วงราคาที่ตรงกับเงื่อนไข
        for (const range of rentRanges) {
            // ถ้ามีทั้ง min และ max กำหนดไว้ ให้ตรวจสอบว่าราคาที่ระบุอยู่ในช่วงหรือไม่
            if (range.min !== null && range.max !== null) {
                if (minPrice >= range.min && maxPrice <= range.max) {
                    return range.id;
                }
            }
        }

        // ถ้าไม่พบช่วงที่ตรงกัน
        return 0; // ไม่ระบุ
    }

    // ฟังก์ชันช่วยหารหัส ID สำหรับช่วงราคาซื้อ
    function findBuyPriceRangeId(minPrice, maxPrice) {
        const buyRanges = [
            { id: 0, min: null, max: null, name: 'ไม่ระบุ' },
            { id: 23, min: 0, max: 1000000, name: 'น้อยกว่า 1 ล้าน' },
            { id: 24, min: 1000000, max: 1500000, name: '1 ล้าน - 1.5 ล้าน' },
            { id: 25, min: 1500000, max: 2000000, name: '1.5 ล้าน - 2 ล้าน' },
            { id: 26, min: 2000000, max: 2500000, name: '2 ล้าน - 2.5 ล้าน' },
            { id: 27, min: 2500000, max: 3000000, name: '2.5 ล้าน - 3 ล้าน' },
            { id: 28, min: 3000000, max: 3500000, name: '3 ล้าน - 3.5 ล้าน' },
            { id: 29, min: 3500000, max: 4000000, name: '3.5 ล้าน - 4 ล้าน' },
            { id: 30, min: 4000000, max: 4500000, name: '4 ล้าน - 4.5 ล้าน' },
            { id: 31, min: 4500000, max: 5000000, name: '4.5 ล้าน - 5 ล้าน' },
            { id: 32, min: 5000000, max: 5500000, name: '5 ล้าน - 5.5 ล้าน' },
            { id: 33, min: 5500000, max: 6000000, name: '5.5 ล้าน - 6 ล้าน' },
            { id: 34, min: 6000000, max: 6500000, name: '6 ล้าน - 6.5 ล้าน' },
            { id: 35, min: 6500000, max: 7000000, name: '6.5 ล้าน - 7 ล้าน' },
            { id: 36, min: 7000000, max: 7500000, name: '7 ล้าน - 7.5 ล้าน' },
            { id: 37, min: 7500000, max: 8000000, name: '7.5 ล้าน - 8 ล้าน' },
            { id: 38, min: 8000000, max: 8500000, name: '8 ล้าน - 8.5 ล้าน' },
            { id: 39, min: 8500000, max: 9000000, name: '8.5 ล้าน - 9 ล้าน' },
            { id: 40, min: 9000000, max: 9500000, name: '9 ล้าน - 9.5 ล้าน' },
            { id: 41, min: 9500000, max: 10000000, name: '9.5 ล้าน - 10 ล้าน' },
            { id: 42, min: 10000000, max: 11000000, name: '10 ล้าน - 11 ล้าน' },
            { id: 43, min: 11000000, max: 12000000, name: '11 ล้าน - 12 ล้าน' },
            { id: 44, min: 12000000, max: 13000000, name: '12 ล้าน - 13 ล้าน' },
            { id: 45, min: 13000000, max: 14000000, name: '13 ล้าน - 14 ล้าน' },
            { id: 46, min: 14000000, max: 15000000, name: '14 ล้าน - 15 ล้าน' },
            { id: 47, min: 15000000, max: 16000000, name: '15 ล้าน - 16 ล้าน' },
            { id: 48, min: 16000000, max: 17000000, name: '16 ล้าน - 17 ล้าน' },
            { id: 49, min: 17000000, max: 18000000, name: '17 ล้าน - 18 ล้าน' },
            { id: 50, min: 18000000, max: 19000000, name: '18 ล้าน - 19 ล้าน' },
            { id: 51, min: 19000000, max: 20000000, name: '19 ล้าน - 20 ล้าน' },
            { id: 52, min: 20000000, max: 25000000, name: '20 ล้าน - 25 ล้าน' },
            { id: 53, min: 25000000, max: 30000000, name: '25 ล้าน - 30 ล้าน' },
            { id: 54, min: 30000000, max: 35000000, name: '30 ล้าน - 35 ล้าน' },
            { id: 55, min: 35000000, max: 40000000, name: '35 ล้าน - 40 ล้าน' },
            { id: 56, min: 40000000, max: 45000000, name: '40 ล้าน - 45 ล้าน' },
            { id: 57, min: 45000000, max: 50000000, name: '45 ล้าน - 50 ล้าน' },
            { id: 58, min: 50000000, max: 60000000, name: '50 ล้าน - 60 ล้าน' },
            { id: 59, min: 60000000, max: 70000000, name: '60 ล้าน - 70 ล้าน' },
            { id: 60, min: 70000000, max: 80000000, name: '70 ล้าน - 80 ล้าน' },
            { id: 61, min: 80000000, max: 90000000, name: '80 ล้าน - 90 ล้าน' },
            { id: 62, min: 90000000, max: 100000000, name: '90 ล้าน - 100 ล้าน' },
            { id: 63, min: 100000000, max: Infinity, name: 'มากกว่า 100 ล้าน' }
        ];

        // ตรวจสอบช่วงราคาที่ตรงกับเงื่อนไข
        for (const range of buyRanges) {
            // ถ้ามีทั้ง min และ max กำหนดไว้ ให้ตรวจสอบว่าราคาที่ระบุอยู่ในช่วงหรือไม่
            if (range.min !== null && range.max !== null) {
                if (minPrice >= range.min && maxPrice <= range.max) {
                    return range.id;
                }
            }
        }

        // ถ้าไม่พบช่วงที่ตรงกัน
        return 0; // ไม่ระบุ
    }

    // ฟังก์ชันช่วยหารหัส ID ที่ใกล้เคียงที่สุดสำหรับราคาเช่า
    function findClosestRentPriceRangeId(price) {
        const rentRanges = [
            { id: 0, min: null, max: null, name: 'ไม่ระบุ' },
            { id: 1, min: 0, max: 5000, name: 'น้อยกว่า 5,000' },
            { id: 2, min: 5000, max: 10000, name: '5,000 - 10,000' },
            { id: 3, min: 10000, max: 20000, name: '10,000 - 20,000' },
            { id: 4, min: 20000, max: 30000, name: '20,000 - 30,000' },
            { id: 5, min: 30000, max: 40000, name: '30,000 - 40,000' },
            { id: 6, min: 40000, max: 50000, name: '40,000 - 50,000' },
            { id: 7, min: 50000, max: 60000, name: '50,000 - 60,000' },
            { id: 8, min: 60000, max: 70000, name: '60,000 - 70,000' },
            { id: 9, min: 70000, max: 80000, name: '70,000 - 80,000' },
            { id: 10, min: 80000, max: 90000, name: '80,000 - 90,000' },
            { id: 11, min: 90000, max: 100000, name: '90,000 - 100,000' },
            { id: 12, min: 100000, max: 150000, name: '100,000 - 150,000' },
            { id: 13, min: 150000, max: 200000, name: '150,000 - 200,000' },
            { id: 14, min: 200000, max: 250000, name: '200,000 - 250,000' },
            { id: 15, min: 250000, max: 300000, name: '250,000 - 300,000' },
            { id: 16, min: 300000, max: 350000, name: '300,000 - 350,000' },
            { id: 17, min: 350000, max: 400000, name: '350,000 - 400,000' },
            { id: 18, min: 400000, max: 450000, name: '400,000 - 450,000' },
            { id: 19, min: 450000, max: 500000, name: '450,000 - 500,000' },
            { id: 21, min: 500000, max: 1000000, name: '500,000 - 1,000,000' },
            { id: 22, min: 1000000, max: Infinity, name: 'มากกว่า 1 ล้าน' }
        ];

        // ตรวจสอบว่าราคาอยู่ในช่วงใด
        for (const range of rentRanges) {
            if (range.min !== null && range.max !== null) {
                if (price >= range.min && price < range.max) {
                    return range.id;
                }
            }
        }

        // ถ้าราคาต่ำกว่า 5,000
        if (price < 5000) {
            return 1; // น้อยกว่า 5,000
        }

        // ถ้าราคามากกว่า 1 ล้าน
        if (price >= 1000000) {
            return 22; // มากกว่า 1 ล้าน
        }

        // ถ้าไม่พบช่วงที่ตรงกัน
        return 0; // ไม่ระบุ
    }

    // ฟังก์ชันช่วยหารหัส ID ที่ใกล้เคียงที่สุดสำหรับราคาซื้อ
    function findClosestBuyPriceRangeId(price) {
        // ถ้าราคาต่ำกว่า 1 ล้าน
        if (price < 1000000) {
            return 23; // น้อยกว่า 1 ล้าน
        }

        // ถ้าราคามากกว่า 100 ล้าน
        if (price >= 100000000) {
            return 63; // มากกว่า 100 ล้าน
        }

        // ช่วงราคาซื้อ
        const buyRanges = [
            { id: 24, min: 1000000, max: 1500000 },
            { id: 25, min: 1500000, max: 2000000 },
            { id: 26, min: 2000000, max: 2500000 },
            { id: 27, min: 2500000, max: 3000000 },
            { id: 28, min: 3000000, max: 3500000 },
            { id: 29, min: 3500000, max: 4000000 },
            { id: 30, min: 4000000, max: 4500000 },
            { id: 31, min: 4500000, max: 5000000 },
            { id: 32, min: 5000000, max: 5500000 },
            { id: 33, min: 5500000, max: 6000000 },
            { id: 34, min: 6000000, max: 6500000 },
            { id: 35, min: 6500000, max: 7000000 },
            { id: 36, min: 7000000, max: 7500000 },
            { id: 37, min: 7500000, max: 8000000 },
            { id: 38, min: 8000000, max: 8500000 },
            { id: 39, min: 8500000, max: 9000000 },
            { id: 40, min: 9000000, max: 9500000 },
            { id: 41, min: 9500000, max: 10000000 },
            { id: 42, min: 10000000, max: 11000000 },
            { id: 43, min: 11000000, max: 12000000 },
            { id: 44, min: 12000000, max: 13000000 },
            { id: 45, min: 13000000, max: 14000000 },
            { id: 46, min: 14000000, max: 15000000 },
            { id: 47, min: 15000000, max: 16000000 },
            { id: 48, min: 16000000, max: 17000000 },
            { id: 49, min: 17000000, max: 18000000 },
            { id: 50, min: 18000000, max: 19000000 },
            { id: 51, min: 19000000, max: 20000000 },
            { id: 52, min: 20000000, max: 25000000 },
            { id: 53, min: 25000000, max: 30000000 },
            { id: 54, min: 30000000, max: 35000000 },
            { id: 55, min: 35000000, max: 40000000 },
            { id: 56, min: 40000000, max: 45000000 },
            { id: 57, min: 45000000, max: 50000000 },
            { id: 58, min: 50000000, max: 60000000 },
            { id: 59, min: 60000000, max: 70000000 },
            { id: 60, min: 70000000, max: 80000000 },
            { id: 61, min: 80000000, max: 90000000 },
            { id: 62, min: 90000000, max: 100000000 }
        ];

        // ตรวจสอบว่าราคาอยู่ในช่วงใด
        for (const range of buyRanges) {
            if (price >= range.min && price < range.max) {
                return range.id;
            }
        }

        // ถ้าไม่พบช่วงที่ตรงกัน
        return 0; // ไม่ระบุ
    }

    async function getZoneIdFromAPI(keyword) {
        if (!keyword) {
            console.log('ไม่มีคำค้นหาสำหรับโซน');
            return '';
        }

        try {
            console.log(`กำลังค้นหา Zone ID สำหรับคำค้นหา: "${keyword}"`);

            // เรียก API เพื่อดึงข้อมูลโซน
            const response = await fetch(`${chatState.apiBaseUrl}/chat/zone_list?keyword=${encodeURIComponent(keyword)}`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${chatState.apiToken}`
                }
            });

            // แปลงข้อมูลที่ได้รับเป็น JSON
            const data = await response.json();

            console.log('ผลการค้นหาโซน:', data);

            // ตรวจสอบว่าได้รับข้อมูลถูกต้องหรือไม่
            if (data.result_code === 1 && data.data && data.data.length > 0) {
                // เลือกเฉพาะข้อมูลโซนแรกจากรายการที่ได้รับ
                const zoneId = data.data[0].zone_id;
                console.log(`พบ Zone ID: ${zoneId} สำหรับคำค้นหา "${keyword}"`);
                return zoneId;
            } else {
                console.log(`ไม่พบ Zone ID สำหรับคำค้นหา "${keyword}"`);
                return '';
            }
        } catch (error) {
            console.error('เกิดข้อผิดพลาดในการดึงข้อมูล Zone ID:', error);
            return '';
        }
    }

    // สร้างฟังก์ชันใหม่สำหรับดึงรายชื่อทำเลจาก API
    async function getLocationListFromAPI() {
        try {
            console.log('กำลังดึงรายการทำเลจาก API');

            // เรียก API เพื่อดึงข้อมูลโซน
            const response = await fetch(`${chatState.apiBaseUrl}/chat/short_zone`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${chatState.apiToken}`
                }
            });

            // แปลงข้อมูลที่ได้รับเป็น JSON
            const data = await response.json();

            console.log('ผลการดึงรายการทำเล:', data);

            // ตรวจสอบว่าได้รับข้อมูลถูกต้องหรือไม่
            if (data.result_code === 1 && data.data && data.data.length > 0) {
                // บันทึกข้อมูลไว้ใน chatState เพื่อใช้ภายหลัง
                chatState.locationList = data.data;

                // สร้าง popularLocations จาก 10 รายการแรก หรือตามจำนวนที่มี
                chatState.popularLocations = data.data.slice(0, 10);

                console.log(`ดึงรายการทำเลสำเร็จ: ${data.data.length} รายการ`);
                console.log(`ทำเลยอดนิยม: ${chatState.popularLocations.join(', ')}`);

                return data.data;
            } else {
                console.log(`ไม่พบข้อมูลทำเลจาก API หรือข้อมูลไม่ถูกต้อง`);
                // กรณีไม่มีข้อมูล ใช้ค่าเริ่มต้น
                const defaultLocations = [
                    'กรุงเทพ', 'เชียงใหม่', 'ขอนแก่น', 'พัทยา', 'ลาดพร้าว', 'สุขุมวิท', 'บางนา',
                    'อโศก', 'รามคำแหง', 'รัชดา', 'เอกมัย', 'ทองหล่อ', 'พระราม9', 'รัตนาธิเบศร์',
                    'เพชรเกษม', 'ภูเก็ต', 'ชลบุรี', 'พระราม2', 'สาทร', 'สีลม', 'ราชดำริ', 'นนทบุรี'
                ];
                chatState.locationList = defaultLocations;
                chatState.popularLocations = [
                    'กรุงเทพ', 'เชียงใหม่', 'ภูเก็ต', 'พัทยา', 'หัวหิน',
                    'รัชดา', 'สุขุมวิท', 'ลาดพร้าว', 'อโศก', 'ทองหล่อ'
                ];
                return defaultLocations;
            }
        } catch (error) {
            console.error('เกิดข้อผิดพลาดในการดึงรายการทำเล:', error);
            // กรณีเกิดข้อผิดพลาด ใช้ค่าเริ่มต้น
            const defaultLocations = [
                'กรุงเทพ', 'เชียงใหม่', 'ขอนแก่น', 'พัทยา', 'ลาดพร้าว', 'สุขุมวิท', 'บางนา',
                'อโศก', 'รามคำแหง', 'รัชดา', 'เอกมัย', 'ทองหล่อ', 'พระราม9', 'รัตนาธิเบศร์',
                'เพชรเกษม', 'ภูเก็ต', 'ชลบุรี', 'พระราม2', 'สาทร', 'สีลม', 'ราชดำริ', 'นนทบุรี'
            ];
            chatState.locationList = defaultLocations;
            chatState.popularLocations = [
                'กรุงเทพ', 'เชียงใหม่', 'ภูเก็ต', 'พัทยา', 'หัวหิน',
                'รัชดา', 'สุขุมวิท', 'ลาดพร้าว', 'อโศก', 'ทองหล่อ'
            ];
            return defaultLocations;
        }
    }

    function shouldBotRespond() {
        // ถ้าแอดมินเปิดใช้งาน บอทจะไม่ตอบกลับ
        if (chatState.adminActive) {
            console.log('แอดมินกำลังเปิดใช้งานอยู่ บอทจะไม่ตอบกลับ');
            return false;
        }
        return true;
    }

    function shouldShowBotOptions() {
        return !chatState.adminActive;
    }

    // เริ่มการทำงานของสคริปต์
    async function init() {
        console.log('เริ่มต้นการทำงานของแชท - Session ID:', chatState.sessionId);
         await waitForPieSocket();

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

        await getLocationListFromAPI();

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

        if (typeof PieSocket !== 'undefined') {
            connectSocket();
        } else {
            console.log('PieSocket library not available');
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
    function waitForPieSocket() {
        return new Promise((resolve) => {
            let attempts = 0;
            const maxAttempts = 10;

            const checkPieSocket = () => {
                attempts++;
                console.log(`Checking PieSocket attempt ${attempts}/${maxAttempts}`);

                if (typeof PieSocket !== 'undefined') {
                    console.log('PieSocket loaded successfully');
                    resolve();
                } else if (attempts >= maxAttempts) {
                    console.error('PieSocket failed to load after', maxAttempts, 'attempts');
                    resolve(); // ยังคงทำงานต่อแม้ PieSocket ไม่โหลด
                } else {
                    setTimeout(checkPieSocket, 500); // รอ 0.5 วินาทีแล้วลองใหม่
                }
            };

            checkPieSocket();
        });
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
