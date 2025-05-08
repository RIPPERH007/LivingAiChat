/**
 * Admin Dashboard JavaScript
 * เปลี่ยนจาก PieSocket มาใช้ Socket.IO พร้อมการอัพเดตแบบ Real-time
 */
(function() {

   // การกำหนดองค์ประกอบ DOM

    const elements = {
        // ปุ่มและองค์ประกอบหน้าหลัก
        tabButtons: document.querySelectorAll('.tab'),
        conversationList: document.getElementById('conversation-list'),
        searchInput: document.getElementById('search-input'),
        filterBtn: document.getElementById('filter-btn'),

        // แชทพาเนล
        chatPanel: document.getElementById('chatPanel'),
        closeChatBtn: document.querySelector('.close-chat-btn'),
        chatCustomerName: document.getElementById('chat-customer-name'),
        chatCustomerContact: document.getElementById('chat-customer-contact'),

        // ส่วนแสดงรายละเอียดลูกค้า
        infoBtn: document.querySelector('.info-btn'),
        customerDetails: document.querySelector('.customer-details'),
        closeDetailsBtn: document.querySelector('.close-details-btn'),

        // ส่วนการส่งข้อความ
        adminSendBtn: document.getElementById('admin-send-btn'),
        adminChatInput: document.getElementById('admin-chat-input'),
        adminChatMessages: document.getElementById('adminChatMessages'),

        // ส่วนรายละเอียดลูกค้า
        detailName: document.getElementById('detail-name'),
        detailEmail: document.getElementById('detail-email'),
        detailPhone: document.getElementById('detail-phone'),
        detailTimestamp: document.getElementById('detail-timestamp'),
        detailStatus: document.getElementById('detail-status'),
        detailIntent: document.getElementById('detail-intent'),

        // ปุ่มการกระทำ
        updateStatusBtn: document.getElementById('update-status-btn'),
        deleteConversationBtn: document.getElementById('delete-conversation-btn'),

        // Modal ตัวกรอง
        filterModal: document.getElementById('filterModal'),
        closeModalBtn: document.getElementById('close-modal'),
        resetFilterBtn: document.getElementById('reset-filter-btn'),
        applyFilterBtn: document.getElementById('apply-filter-btn'),

        // Modal สถานะ
        statusModal: document.getElementById('statusModal'),
        closeStatusModalBtn: document.getElementById('close-status-modal'),
        cancelStatusBtn: document.getElementById('cancel-status-btn'),
        confirmStatusBtn: document.getElementById('confirm-status-btn'),
        updateStatusSelect: document.getElementById('update-status'),

        // จำนวน Tab Count
        waitingCount: document.querySelector('.waiting-count'),
        answeredCount: document.querySelector('.answered-count'),
        allCount: document.querySelector('.all-count'),

        // สถานะการเชื่อมต่อ Socket.IO
        socketStatus: document.getElementById('socket-status'),

        // เพิ่ม DOM element สำหรับปุ่มสถานะแอดมิน
        adminStatusBtn: document.getElementById('admin-status-btn')

    };

    // สถานะการทำงาน
    const state = {
        currentSessionId: null,
        currentCustomer: null,
        currentStatus: null,
        activeTab: 'all', // เปลี่ยนค่าเริ่มต้นเป็น 'all' ตาม UI ที่เลือก tab ทั้งหมด
        adminInfo: {
            id: 'admin1',
            name: 'Admin User'
        },
        filter: {
            status: 'all',
            date: null,
            intent: 'all'
        },
        socket: null,
        conversations: {}, // เก็บการสนทนาทั้งหมดโดยใช้ sessionId เป็นคีย์
        lastUpdate: Date.now(),
        isLoadingConversations: false,
        adminActive : false

    };

    // เพิ่มฟังก์ชันตรวจสอบข้อความซ้ำ
    function isMessageDuplicate(messageId) {
        return elements.adminChatMessages &&
               elements.adminChatMessages.querySelector(`.message[data-message-id="${messageId}"]`) !== null;
    }

    // การลงทะเบียนตัวจัดการเหตุการณ์
    function setupEventListeners() {
        // Event Listeners สำหรับ Tab
        elements.tabButtons.forEach(tab => {
            tab.addEventListener('click', function(e) {
                e.preventDefault();
                state.activeTab = this.dataset.status;
                elements.tabButtons.forEach(t => t.classList.remove('active'));
                this.classList.add('active');
                renderConversationList();
            });
        });

        // ปุ่มปิดแชท
        if (elements.closeChatBtn) {
            elements.closeChatBtn.addEventListener('click', closeChatPanel);
        }

        // ปุ่มแสดงข้อมูลลูกค้า
        if (elements.infoBtn) {
            elements.infoBtn.addEventListener('click', toggleCustomerDetails);
        }

        // ปุ่มปิดข้อมูลลูกค้า
        if (elements.closeDetailsBtn) {
            elements.closeDetailsBtn.addEventListener('click', hideCustomerDetails);
        }

        // ปุ่มส่งข้อความ
        if (elements.adminSendBtn) {
            elements.adminSendBtn.addEventListener('click', sendMessage);
        }

        // ช่องกรอกข้อความ (กด Enter เพื่อส่ง)
        if (elements.adminChatInput) {
            elements.adminChatInput.addEventListener('keypress', function(e) {
                if (e.key === 'Enter') {
                    sendMessage();
                }
            });
        }

        // ปุ่มค้นหา
        if (elements.searchInput) {
            elements.searchInput.addEventListener('input', debounce(function() {
                renderConversationList();
            }, 300));
        }

        // ปุ่มตัวกรอง
        if (elements.filterBtn) {
            elements.filterBtn.addEventListener('click', function() {
                elements.filterModal.style.display = 'block';
            });
        }

        // ปุ่มปิด Modal ตัวกรอง
        if (elements.closeModalBtn) {
            elements.closeModalBtn.addEventListener('click', function() {
                elements.filterModal.style.display = 'none';
            });
        }

        // ปุ่มรีเซ็ตตัวกรอง
        if (elements.resetFilterBtn) {
            elements.resetFilterBtn.addEventListener('click', function() {
                document.getElementById('filter-status').value = 'all';
                document.getElementById('filter-date').value = '';
                document.getElementById('filter-intent').value = 'all';
                state.filter = {
                    status: 'all',
                    date: null,
                    intent: 'all'
                };
            });
        }

        // ปุ่มใช้ตัวกรอง
        if (elements.applyFilterBtn) {
            elements.applyFilterBtn.addEventListener('click', function() {
                state.filter.status = document.getElementById('filter-status').value;
                state.filter.date = document.getElementById('filter-date').value || null;
                state.filter.intent = document.getElementById('filter-intent').value;
                elements.filterModal.style.display = 'none';
                renderConversationList();
            });
        }

        // ปุ่มอัปเดตสถานะ
        if (elements.updateStatusBtn) {
            elements.updateStatusBtn.addEventListener('click', function() {
                elements.statusModal.style.display = 'block';
                elements.updateStatusSelect.value = state.currentStatus || 'waiting';
            });
        }

        // ปุ่มปิด Modal สถานะ
        if (elements.closeStatusModalBtn) {
            elements.closeStatusModalBtn.addEventListener('click', function() {
                elements.statusModal.style.display = 'none';
            });
        }

        // ปุ่มยกเลิกสถานะ
        if (elements.cancelStatusBtn) {
            elements.cancelStatusBtn.addEventListener('click', function() {
                elements.statusModal.style.display = 'none';
            });
        }

        // ปุ่มยืนยันสถานะ
        if (elements.confirmStatusBtn) {
            elements.confirmStatusBtn.addEventListener('click', function() {
                const newStatus = elements.updateStatusSelect.value;
                updateConversationStatus(newStatus);
                elements.statusModal.style.display = 'none';
            });
        }

        // ปุ่มลบการสนทนา
        if (elements.deleteConversationBtn) {
            elements.deleteConversationBtn.addEventListener('click', function() {
                if (confirm('คุณต้องการลบข้อมูลการสนทนานี้ใช่หรือไม่?')) {
                    deleteConversation();
                }
            });
        }

        // ปิด Modal เมื่อคลิกนอกพื้นที่
        window.addEventListener('click', function(e) {
            if (e.target === elements.filterModal) {
                elements.filterModal.style.display = 'none';
            }
            if (e.target === elements.statusModal) {
                elements.statusModal.style.display = 'none';
            }
        });
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
        if (state.socket && state.socket.connected) {
            console.log('Socket is already connected:', state.socket.id);
            return true;
        }

        // สร้างการเชื่อมต่อใหม่
        state.socket = io(socketUrl, {
            reconnectionAttempts: 5,
            reconnectionDelay: 1000,
            timeout: 10000
        });

        // เมื่อเชื่อมต่อสำเร็จ
        state.socket.on('connect', () => {
            console.log('Connected to Socket.IO with ID:', state.socket.id);

            // อัปเดตสถานะการเชื่อมต่อ (ถ้ามี)
            if (elements.socketStatus) {
                elements.socketStatus.textContent = 'Connected';
                elements.socketStatus.classList.add('connected');
                elements.socketStatus.classList.remove('disconnected');
            }

            // ถ้ากำลังดูการสนทนาอยู่ ให้เข้าร่วมห้องแชท
            if (state.currentSessionId) {
                state.socket.emit('join', state.currentSessionId);
                console.log('Joining room after connect:', state.currentSessionId);
            }

            // เชื่อมต่อ socket กับโมดูลค้นหาอสังหาริมทรัพย์
            if (window.propertySearchModule) {
                window.propertySearchModule.handleSocketEvents(state.socket);
            }

            // โหลดข้อมูลการสนทนาใหม่เมื่อเชื่อมต่อสำเร็จ
            loadConversations();
        });

        // เพิ่ม event listener สำหรับผลการค้นหาอสังหาริมทรัพย์
        state.socket.on('property_search_results', (data) => {
            console.log('Property search results received:', data);

            // ถ้ามีโมดูลค้นหาอสังหาริมทรัพย์ ให้ส่งข้อมูลไปให้โมดูล
            if (window.propertySearchModule) {
                if (data.success && data.data) {
                    // ผลการค้นหาสำเร็จ
                    window.propertySearchModule.processSearchResults(data.data);
                } else {
                    // ไม่พบข้อมูล
                    window.propertySearchModule.showNoResults();
                }
            }
        });

        // เพิ่ม event listener อื่นๆ ตามต้องการ
        // ...

        return true;
    } catch (error) {
        console.error('Error connecting to Socket.IO:', error);
        return false;
    }
}

    function connectSocketToPropertySearch() {
        if (state.socket && window.propertySearchModule) {
            window.propertySearchModule.setSocket(state.socket);
        }
    }

    // ดึงข้อมูลการสนทนาเฉพาะรายและอัพเดต UI
    function fetchConversationAndUpdateUI(sessionId) {
        if (!sessionId) return;

        window.adminAPI.fetchConversationDetails(sessionId)
            .then(data => {
                if (!data || !data.conversation) {
                    console.error('No conversation data returned for', sessionId);
                    return;
                }

                // เพิ่มข้อมูลการสนทนาลงใน state
                const conversation = data.conversation;
                const userInfo = data.sessionData?.userInfo || {};

                // สร้างข้อมูลการสนทนาในรูปแบบที่ใช้ใน renderConversationList
                state.conversations[sessionId] = {
                    sessionId: sessionId,
                    userInfo: userInfo,
                    status: conversation.status || 'waiting',
                    lastActivity: conversation.lastActivity || Date.now(),
                    lastMessage: conversation.messages && conversation.messages.length > 0 ?
                        {
                            text: conversation.messages[conversation.messages.length - 1].text,
                            sender: conversation.messages[conversation.messages.length - 1].sender,
                            timestamp: conversation.messages[conversation.messages.length - 1].timestamp
                        } : null,
                    messageCount: conversation.messages ? conversation.messages.length : 0
                };

                // อัพเดตรายการการสนทนาใน UI
                updateConversationCounts();
                renderConversationList();

                console.log('Conversation updated for', sessionId);
            })
            .catch(error => {
                console.error('Error fetching conversation details:', error);
            });
    }
// ฟังก์ชันสำหรับเปลี่ยนสถานะการทำงานของแอดมิน
function toggleAdminActiveStatus() {
    console.log('toggleAdminActiveStatus called');
    console.log('Current state:', state.adminActive);

    // สลับสถานะ
    state.adminActive = !state.adminActive;
    console.log('New state:', state.adminActive);

    // อัปเดตหน้าตาของปุ่ม
    updateAdminStatusButton();

    // ส่งการแจ้งเตือนสถานะผ่าน Socket.IO ไปยังห้องปัจจุบัน
    if (state.socket && state.socket.connected && state.currentSessionId) {
        console.log('Emitting admin_status_change event');
        state.socket.emit('admin_status_change', {
            type: 'admin_status_change',
            adminActive: state.adminActive,
            timestamp: Date.now(),
            room: state.currentSessionId,
            adminName: state.adminInfo.name,
            adminId: state.adminInfo.id
        });

        // แสดงแจ้งเตือนว่าได้เปลี่ยนสถานะแล้ว
        const statusText = state.adminActive ? 'เปิดใช้งาน' : 'ปิดใช้งาน';
        showNotification(`สถานะแอดมิน: ${statusText}`);
    } else {
        console.log('Cannot emit event: socket or room not available');
        console.log('Socket connected:', state.socket && state.socket.connected);
        console.log('Current session ID:', state.currentSessionId);
    }
}// ฟังก์ชันอัปเดตหน้าตาของปุ่ม

// เพิ่มโค้ดดีบั๊กลงไปที่ต้นของฟังก์ชัน updateAdminStatusButton
function updateAdminStatusButton() {
    console.log('updateAdminStatusButton called');
    console.log('adminStatusBtn element:', elements.adminStatusBtn);

    if (!elements.adminStatusBtn) {
        console.error('adminStatusBtn element not found in DOM');
        return;
    }

    if (state.adminActive) {
        console.log('Setting active state');
        elements.adminStatusBtn.textContent = 'แอดมินกำลังใช้งาน';
        elements.adminStatusBtn.classList.add('active');
        elements.adminStatusBtn.classList.remove('inactive');
    } else {
        console.log('Setting inactive state');
        elements.adminStatusBtn.textContent = 'เปิดใช้งานแอดมิน';
        elements.adminStatusBtn.classList.add('inactive');
        elements.adminStatusBtn.classList.remove('active');
    }
}

function setupAdminStatusButton() {
    console.log('setupAdminStatusButton called');
    console.log('adminStatusBtn element:', elements.adminStatusBtn);

    if (elements.adminStatusBtn) {
        console.log('Adding event listener to adminStatusBtn');
        elements.adminStatusBtn.addEventListener('click', function(e) {
            console.log('Admin status button clicked');
            // เพิ่ม preventDefault และ stopPropagation เพื่อป้องกันปัญหา
            e.preventDefault();
            e.stopPropagation();
            toggleAdminActiveStatus();
        });
        // ตั้งค่าเริ่มต้น
        updateAdminStatusButton();
    } else {
        console.error('adminStatusBtn element not found, cannot setup event listener');

        // ลองค้นหาปุ่มแบบอื่นถ้าหาไม่เจอด้วย ID
        const btnBySelector = document.querySelector('.admin-status-btn');
        if (btnBySelector) {
            console.log('Found button by class selector instead');
            elements.adminStatusBtn = btnBySelector;
            btnBySelector.addEventListener('click', function(e) {
                console.log('Admin status button clicked (found by class)');
                e.preventDefault();
                e.stopPropagation();
                toggleAdminActiveStatus();
            });
            updateAdminStatusButton();
        } else {
            console.error('Button not found by any selector');
        }
    }
}
// เพิ่ม Event Listener สำหรับปุ่มสถานะแอดมิน
function setupAdminStatusButton() {
    if (elements.adminStatusBtn) {
        elements.adminStatusBtn.addEventListener('click', toggleAdminActiveStatus);
        // ตั้งค่าเริ่มต้น
        updateAdminStatusButton();
    }
}
const originalOpenChatSession = openChatSession;
openChatSession = function(sessionId) {
    // รีเซ็ตสถานะแอดมินเมื่อเปิดห้องใหม่
    state.adminActive = false;
    updateAdminStatusButton();

    // เรียกฟังก์ชันเดิม
    originalOpenChatSession(sessionId);

    // แสดงแชทพาเนล
    if (elements.chatPanel) {
        elements.chatPanel.style.display = 'flex';
    }
};

    // โหลดรายการการสนทนา
    function loadConversations() {
        // ป้องกันการโหลดซ้ำ
        if (state.isLoadingConversations) return;
        state.isLoadingConversations = true;

        // แสดงสถานะกำลังโหลด
        if (Object.keys(state.conversations).length === 0) {
            elements.conversationList.innerHTML = '<tr><td colspan="7" style="text-align: center;">กำลังโหลดข้อมูล...</td></tr>';
        }

        // เรียกใช้ API เพื่อดึงรายการการสนทนา
        window.adminAPI.fetchConversations()
            .then(conversations => {
                // บันทึกข้อมูลการสนทนาทั้งหมด
                state.conversations = {};
                conversations.forEach(conv => {
                    state.conversations[conv.sessionId] = conv;
                });

                console.log('Loaded conversations:', conversations.length);

                // อัปเดตจำนวนการสนทนาในแต่ละแท็บ
                updateConversationCounts();

                // แสดงรายการการสนทนา
                renderConversationList();

                // อัพเดตเวลาที่โหลดล่าสุด
                state.lastUpdate = Date.now();
                state.isLoadingConversations = false;
            })
            .catch(error => {
                console.error('Error loading conversations:', error);
                elements.conversationList.innerHTML = '<tr><td colspan="7" style="text-align: center;">เกิดข้อผิดพลาดในการโหลดข้อมูล</td></tr>';
                state.isLoadingConversations = false;
            });
    }

    // อัพเดตจำนวนการสนทนาในแต่ละแท็บ
    function updateConversationCounts() {
        const conversations = Object.values(state.conversations);
        if (!conversations || conversations.length === 0) return;

        const waitingCount = conversations.filter(conv => conv.status === 'waiting').length;
        const answeredCount = conversations.filter(conv => conv.status === 'answered').length;
        const totalCount = conversations.length;

        if (elements.waitingCount) elements.waitingCount.textContent = `(${waitingCount})`;
        if (elements.answeredCount) elements.answeredCount.textContent = `(${answeredCount})`;
        if (elements.allCount) elements.allCount.textContent = `(${totalCount})`;
    }

    // แสดงรายการการสนทนา
    function renderConversationList() {
        if (!elements.conversationList) return;

        const conversations = Object.values(state.conversations);
        if (!conversations || conversations.length === 0) {
            elements.conversationList.innerHTML = '<tr><td colspan="7" style="text-align: center;">ไม่พบข้อมูลการสนทนา</td></tr>';
            return;
        }

        // กรองตาม tab ที่เลือก
        let filteredConversations = conversations;
        if (state.activeTab !== 'all') {
            filteredConversations = conversations.filter(conv => conv.status === state.activeTab);
        }

        // กรองตามคำค้นหา (ถ้ามี)
        const searchText = elements.searchInput ? elements.searchInput.value.trim().toLowerCase() : '';
        if (searchText) {
            filteredConversations = filteredConversations.filter(conv => {
                const userInfo = conv.userInfo || {};
                const name = (userInfo.name || '').toLowerCase();
                const email = (userInfo.email || '').toLowerCase();
                const phone = (userInfo.phone || '').toLowerCase();
                const lastMessage = conv.lastMessage && conv.lastMessage.text ? conv.lastMessage.text.toLowerCase() : '';

                return name.includes(searchText) ||
                       email.includes(searchText) ||
                       phone.includes(searchText) ||
                       lastMessage.includes(searchText);
            });
        }

        // เรียงลำดับตามเวลาล่าสุด (ใหม่สุดอยู่บน)
        filteredConversations.sort((a, b) => {
            return b.lastActivity - a.lastActivity;
        });

        // สร้าง HTML ใหม่
        const newHtml = generateConversationListHtml(filteredConversations);

        // อัพเดต HTML เสมอเพื่อให้แน่ใจว่าข้อมูลเป็นปัจจุบัน
        elements.conversationList.innerHTML = newHtml;

        // เพิ่ม Event Listeners สำหรับปุ่มแชท
        document.querySelectorAll('.chat-btn').forEach(button => {
            button.addEventListener('click', function() {
                const sessionId = this.dataset.id;
                console.log('Chat button clicked, sessionId:', sessionId);
                openChatSession(sessionId);
            });
        });
    }

    // สร้าง HTML สำหรับรายการการสนทนา
    function generateConversationListHtml(conversations) {
        if (!conversations || conversations.length === 0) {
            return '<tr><td colspan="7" style="text-align: center;">ไม่พบข้อมูลการสนทนา</td></tr>';
        }

        let html = '';

        conversations.forEach(conv => {
            const userInfo = conv.userInfo || {};
            const name = userInfo.name || 'ไม่ระบุชื่อ';
            const email = userInfo.email || '-';
            const phone = userInfo.phone || '-';

            // แปลงเวลาเป็นรูปแบบที่อ่านได้
            const lastActivityDate = new Date(conv.lastActivity);
            const formattedDate = `${lastActivityDate.toLocaleDateString('th-TH')}<br>${lastActivityDate.toLocaleTimeString('th-TH')}`;

            // หาเวลาตอบกลับ (ถ้ามี)
            let replyTime = "-";
            if (conv.lastMessage && conv.lastMessage.text) {
                replyTime = `"${conv.lastMessage.text.substring(0, 15)}..."`;
            }

            // หาข้อความล่าสุด
            let lastMessageText = '-';
            if (conv.lastMessage && conv.lastMessage.text) {
                lastMessageText = `"${conv.lastMessage.text.substring(0, 30)}${conv.lastMessage.text.length > 30 ? '...' : ''}"`;
            }

            // กำหนดสถานะ
            const statusClass = conv.status === 'waiting' ? 'pending' : (conv.status === 'answered' ? 'completed' : '');
            const statusText = conv.status === 'waiting' ? 'รอตอบกลับ' : (conv.status === 'answered' ? 'ตอบแล้ว' : 'ออกแล้ว');

            // สร้าง row
            html += `
                <tr>
                    <td>${escapeHTML(name)}</td>
                    <td>${formattedDate}</td>
                    <td>${replyTime}</td>
                    <td>${escapeHTML(lastMessageText)}</td>
                    <td>${escapeHTML(email)}<br>${escapeHTML(phone)}</td>
                    <td><span class="status ${statusClass}">${statusText}</span></td>
                    <td><button class="action-btn chat-btn" data-id="${conv.sessionId}">คุยต่อเลย</button></td>
                </tr>
            `;
        });

        return html;
    }

    // เปิดห้องแชท
    function openChatSession(sessionId) {
  console.log('Opening chat session for:', sessionId);

   // บันทึก sessionId ปัจจุบัน
   state.currentSessionId = sessionId;

   // แสดงหน้าต่างแชท
   if (elements.chatPanel) {
     elements.chatPanel.style.display = 'flex';
   }

   // ออกจากห้องเดิมและเข้าร่วมห้องใหม่
   if (state.socket && state.socket.connected) {
     state.socket.emit('join', sessionId);
     console.log('Joining new room:', sessionId);
   }

   // โหลดข้อมูลการสนทนา
   window.adminAPI.fetchConversationDetails(sessionId)
     .then(data => {
      console.log('Conversation details:', data);

      if (!data || !data.conversation) {
        console.error('No conversation data returned');
        return;
      }

      const conversation = data.conversation;
      const userInfo = data.sessionData?.userInfo || {};

      // อัปเดตสถานะปัจจุบัน
      state.currentStatus = 'waiting';
      state.currentCustomer = userInfo.name || 'ไม่ระบุชื่อ';

      // อัปเดตข้อมูลลูกค้าในแชทพาเนล
      updateCustomerInfo(userInfo, conversation);

      // โหลดประวัติการสนทนา
      loadChatHistory(conversation.messages || []);

      // แสดงรายละเอียด session
      updateSessionData(conversation);

      // เพิ่มส่วนนี้เพื่อโหลดข้อมูลการค้นหาอสังหาริมทรัพย์
         if (window.propertySearchModule) {
             window.propertySearchModule.loadSearchData(sessionId);
           }
    })
    .catch(error => {
      console.error('Error fetching conversation details:', error);
    });
}
    // ปิดหน้าต่างแชท
    function closeChatPanel() {
        // ออกจากห้องแชท
        if (state.currentSessionId && state.socket && state.socket.connected) {
            state.socket.emit('leave', state.currentSessionId);
            console.log('Leaving room on close:', state.currentSessionId);
        }

        state.currentSessionId = null;

        if (elements.chatPanel) {
            elements.chatPanel.style.display = 'none';
        }

        // ถ้ากำลังแสดงรายละเอียดลูกค้า ให้ซ่อนด้วย
        if (elements.customerDetails && elements.customerDetails.style.display === 'block') {
            elements.customerDetails.style.display = 'none';
        }
    }

    // สลับการแสดงรายละเอียดลูกค้า
    function toggleCustomerDetails() {
        if (elements.customerDetails) {
            if (elements.customerDetails.style.display === 'block') {
                elements.customerDetails.style.display = 'none';
            } else {
                elements.customerDetails.style.display = 'block';
            }
        }
    }

    // ซ่อนรายละเอียดลูกค้า
    function hideCustomerDetails() {
        if (elements.customerDetails) {
            elements.customerDetails.style.display = 'none';
        }
    }

    // อัปเดตข้อมูลลูกค้าในแชทพาเนล
    function updateCustomerInfo(userInfo, conversation) {
        const name = userInfo.name || 'ไม่ระบุชื่อ';
        const email = userInfo.email || '';
        const phone = userInfo.phone || '';
        const contact = [email, phone].filter(Boolean).join(' • ') || 'ไม่มีข้อมูลการติดต่อ';

        if (elements.chatCustomerName) {
            elements.chatCustomerName.textContent = name;
        }

        if (elements.chatCustomerContact) {
            elements.chatCustomerContact.textContent = contact;
        }

        // อัปเดตข้อมูลในรายละเอียดลูกค้า
        if (elements.detailName) elements.detailName.textContent = name;
        if (elements.detailEmail) elements.detailEmail.textContent = email || '-';
        if (elements.detailPhone) elements.detailPhone.textContent = phone || '-';

        if (elements.detailTimestamp && userInfo.timestamp) {
            const timestamp = new Date(userInfo.timestamp);
            elements.detailTimestamp.textContent = `${timestamp.toLocaleDateString('th-TH')} ${timestamp.toLocaleTimeString('th-TH')}`;
        }

        // อัปเดตสถานะ
        updateStatusDisplay(conversation.status);
    }

    // ส่งข้อความจากแอดมิน
    function sendMessage() {
        if (!elements.adminChatInput || !elements.adminChatInput.value.trim()) return;

        const message = elements.adminChatInput.value.trim();
        const timestamp = Date.now();

        // แสดงข้อความในหน้าต่างแชท
        addMessage('admin', message, state.adminInfo.name, timestamp);

        // ส่งข้อความไปยัง API พร้อม timestamp
        window.adminAPI.sendAdminMessage(state.currentSessionId, message, state.adminInfo.id, state.adminInfo.name, timestamp)
            .then(response => {
                console.log('Admin message sent:', response);

                // อัปเดตสถานะเป็น "ตอบแล้ว"
                state.currentStatus = 'answered';
                updateStatusDisplay('answered');

                // อัพเดตสถานะในข้อมูลการสนทนา
                if (state.conversations[state.currentSessionId]) {
                    state.conversations[state.currentSessionId].status = 'answered';
                    state.conversations[state.currentSessionId].lastActivity = timestamp;
                    state.conversations[state.currentSessionId].lastMessage = {
                        text: message,
                        sender: 'admin',
                        timestamp: timestamp
                    };
                }

                // ส่งข้อความผ่าน Socket.IO
                if (state.socket && state.socket.connected) {
                    state.socket.emit('new_message', {
                        sender: 'admin',
                        text: message,
                        adminId: state.adminInfo.id,
                        adminName: state.adminInfo.name,
                        timestamp: timestamp,
                        room: state.currentSessionId
                    });

                    // อัพเดตการแสดงผลหน้ารายการการสนทนา
                    updateConversationCounts();
                    renderConversationList();
                }
            })
            .catch(error => {
                console.error('Error sending admin message:', error);
                alert('เกิดข้อผิดพลาดในการส่งข้อความ กรุณาลองใหม่อีกครั้ง');
            });

        // ล้างช่องข้อความ
        elements.adminChatInput.value = '';
        elements.adminChatInput.focus();
    }

    // เพิ่มข้อความลงในหน้าต่างแชท
    function addMessage(sender, text, senderName = '', messageId = null) {
        if (!elements.adminChatMessages) return;

        const timestamp = messageId || Date.now();

        // ตรวจสอบว่ามีข้อความนี้อยู่แล้วหรือไม่
        if (isMessageDuplicate(timestamp)) {
            console.log('Duplicate message, not adding:', text);
            return;
        }

        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${sender}`;
        messageDiv.setAttribute('data-message-id', timestamp);

        const now = new Date(timestamp);
        const timeFormatted = `${('0' + now.getDate()).slice(-2)} ${getMonthAbbr(now.getMonth())} ${('0' + now.getHours()).slice(-2)}:${('0' + now.getMinutes()).slice(-2)}`;

        messageDiv.innerHTML = `
            <div class="message-content${sender === 'admin' ? ' admin-message' : ''}">
                <p>${escapeHTML(text)}</p>
                ${sender === 'admin' ? `<small>${escapeHTML(senderName)}</small>` : ''}
            </div>
            <div class="message-time">${timeFormatted}</div>
        `;

        elements.adminChatMessages.appendChild(messageDiv);

        // เลื่อนไปที่ข้อความล่าสุด
        elements.adminChatMessages.scrollTop = elements.adminChatMessages.scrollHeight;
    }

    // โหลดประวัติการสนทนา
    function loadChatHistory(messages) {
        if (!elements.adminChatMessages || !messages) return;

        // ล้างข้อความเก่า
        elements.adminChatMessages.innerHTML = '';

        // เพิ่มข้อความใหม่
        messages.forEach(msg => {
            const messageDiv = document.createElement('div');
            messageDiv.className = `message ${msg.sender}`;
            messageDiv.setAttribute('data-message-id', msg.timestamp);

            const msgDate = new Date(msg.timestamp);
            const timeFormatted = `${('0' + msgDate.getDate()).slice(-2)} ${getMonthAbbr(msgDate.getMonth())} ${('0' + msgDate.getHours()).slice(-2)}:${('0' + msgDate.getMinutes()).slice(-2)}`;

            // แสดงชื่อผู้ส่งถ้าเป็นข้อความจากแอดมิน
            const senderInfo = msg.sender === 'admin' && msg.adminName ? `<small>${escapeHTML(msg.adminName)}</small>` : '';

            messageDiv.innerHTML = `
                <div class="message-content${msg.sender === 'admin' ? ' admin-message' : ''}">
                    <p>${escapeHTML(msg.text)}</p>
                    ${senderInfo}
                </div>
                <div class="message-time">${timeFormatted}</div>
            `;

            elements.adminChatMessages.appendChild(messageDiv);
        });

        // เลื่อนไปที่ข้อความล่าสุด
        elements.adminChatMessages.scrollTop = elements.adminChatMessages.scrollHeight;
    }

    // อัปเดตการแสดงสถานะ
    function updateStatusDisplay(status) {
        if (!elements.detailStatus) return;

        // ลบคลาส status ทั้งหมด
        elements.detailStatus.classList.remove('status-pending', 'status-completed');

        // เพิ่มคลาสตามสถานะ
        if (status === 'waiting') {
            elements.detailStatus.classList.add('status-pending');
            elements.detailStatus.textContent = 'รอตอบกลับ';
        } else if (status === 'answered') {
            elements.detailStatus.classList.add('status-completed');
            elements.detailStatus.textContent = 'ตอบแล้ว';
        } else {
            elements.detailStatus.textContent = 'ออกแล้ว';
        }
    }

    // โหลดประวัติการสนทนา
    function loadChatHistory(messages) {
        if (!elements.adminChatMessages || !messages) return;

        // ล้างข้อความเก่า
        elements.adminChatMessages.innerHTML = '';

        // เพิ่มข้อความใหม่
        messages.forEach(msg => {
            const messageDiv = document.createElement('div');
            messageDiv.className = `message ${msg.sender}`;
            messageDiv.setAttribute('data-message-id', msg.timestamp);

            const msgDate = new Date(msg.timestamp);
            const timeFormatted = `${('0' + msgDate.getDate()).slice(-2)} ${getMonthAbbr(msgDate.getMonth())} ${('0' + msgDate.getHours()).slice(-2)}:${('0' + msgDate.getMinutes()).slice(-2)}`;

            // แสดงชื่อผู้ส่งถ้าเป็นข้อความจากแอดมิน
            const senderInfo = msg.sender === 'admin' && msg.adminName ? `<small>${escapeHTML(msg.adminName)}</small>` : '';

            messageDiv.innerHTML = `
                <div class="message-content">
                    <p>${escapeHTML(msg.text)}</p>
                    ${senderInfo}
                </div>
                <div class="message-time">${timeFormatted}</div>
            `;

            elements.adminChatMessages.appendChild(messageDiv);
        });

        // เลื่อนไปที่ข้อความล่าสุด
        elements.adminChatMessages.scrollTop = elements.adminChatMessages.scrollHeight;
    }

    // อัปเดตข้อมูล Session
    function updateSessionData(conversation) {
        // อัปเดต intent (ใช้ intent ล่าสุด)
        if (elements.detailIntent) {
            const messages = conversation.messages || [];
            const botMessages = messages.filter(msg => msg.sender === 'bot' && msg.intent);

            if (botMessages.length > 0) {
                const lastIntent = botMessages[botMessages.length - 1].intent;
                elements.detailIntent.textContent = lastIntent || '-';
            } else {
                elements.detailIntent.textContent = '-';
            }
        }
    }

    // อัปเดตสถานะการสนทนา
    function updateConversationStatus(newStatus) {
        if (!state.currentSessionId) return;

        window.adminAPI.updateConversationStatus(state.currentSessionId, newStatus, state.adminInfo.id)
            .then(response => {
                console.log('Status updated:', response);
                state.currentStatus = 'waiting';
                    updateStatusDisplay('waiting');

                // ส่งการแจ้งเตือนผ่าน Socket.IO
                if (state.socket && state.socket.connected) {
                    state.socket.emit('status_update', {
                        type: 'status_update',
                        status: newStatus,
                        timestamp: Date.now(),
                        room: state.currentSessionId
                    });
                }

                // อัพเดทข้อมูลการสนทนาทันที
                refreshConversations();
            })
            .catch(error => {
                console.error('Error updating status:', error);
                alert('เกิดข้อผิดพลาดในการอัปเดตสถานะ กรุณาลองใหม่อีกครั้ง');
            });
    }

    // ลบการสนทนา
    function deleteConversation() {
        if (!state.currentSessionId) return;

        window.adminAPI.deleteConversation(state.currentSessionId)
            .then(response => {
                console.log('Conversation deleted:', response);

                // ส่งการแจ้งเตือนผ่าน Socket.IO
                if (state.socket && state.socket.connected) {
                    state.socket.emit('session_deleted', {
                        type: 'session_deleted',
                        timestamp: Date.now(),
                        room: state.currentSessionId
                    });
                }

                // ปิดหน้าต่างแชท
                closeChatPanel();

                // อัพเดทข้อมูลการสนทนาทันที
                refreshConversations();
            })
            .catch(error => {
                console.error('Error deleting conversation:', error);
                alert('เกิดข้อผิดพลาดในการลบการสนทนา กรุณาลองใหม่อีกครั้ง');
            });
    }

    // แสดงการแจ้งเตือน
    function showNotification(message) {
        // สร้างแจ้งเตือนบนหน้าเว็บ
        const notification = document.createElement('div');
        notification.className = 'admin-notification';
        notification.textContent = message;

        // เพิ่มลงในหน้าเว็บ
        document.body.appendChild(notification);

        // เล่นเสียงแจ้งเตือน (ถ้ามี)
        // const audio = new Audio('path/to/notification-sound.mp3');
        // audio.play();

        // ซ่อนแจ้งเตือนหลังจาก 5 วินาที
        setTimeout(() => {
            notification.classList.add('fade-out');
            setTimeout(() => {
                document.body.removeChild(notification);
            }, 500);
        }, 5000);
    }

    // ฟังก์ชันช่วยสำหรับการแปลงเดือนเป็นตัวย่อ
    function getMonthAbbr(monthIndex) {
        const months = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
        return months[monthIndex];
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

    // ฟังก์ชัน debounce สำหรับการค้นหา
    function debounce(func, wait) {
        let timeout;
        return function() {
            const context = this, args = arguments;
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(context, args), wait);
        };
    }

    // เริ่มต้นการทำงาน
function init() {
    console.log('Initializing admin dashboard...');
    setupEventListeners();
    connectSocket();
    loadConversations();

    // เพิ่มการเรียกใช้ setupAdminStatusButton โดยตรง
    console.log('Calling setupAdminStatusButton directly');
    setupAdminStatusButton();

     // เพิ่มการตรวจสอบโมดูล Property Search
       if (window.propertySearchModule) {
         console.log('Property search module found, initializing...');
         window.propertySearchModule.init();

         // เชื่อมต่อ socket กับโมดูลค้นหาอสังหาริมทรัพย์
         if (state.socket) {
           window.propertySearchModule.handleSocketEvents(state.socket);
         }
       } else {
         console.error('Property search module not found!');
       }


    // ใช้ Event Delegation สำหรับปุ่ม "คุยต่อเลย"
    if (elements.conversationList) {
        elements.conversationList.addEventListener('click', function(e) {
            // ตรวจสอบว่าสิ่งที่ถูกคลิกเป็นปุ่ม chat-btn หรือเป็นส่วนหนึ่งของปุ่ม
            const button = e.target.closest('.chat-btn');
            if (button) {
                console.log('Chat button clicked through delegation:', button);
                const sessionId = button.dataset.id;
                if (sessionId) {
                    console.log('Opening chat session for ID:', sessionId);
                    openChatSession(sessionId);
                }
            }
        });
        console.log('Added event delegation to conversation list');
    } else {
        console.error('Conversation list element not found!');
    }

    // ตั้งเวลาโหลดข้อมูลใหม่ทุก 30 วินาที (สำหรับกรณีที่ Socket.IO มีปัญหา)
        setInterval(function() {
          if (!state.isLoadingConversations) {
            loadConversations();
          }
        }, 3000);
}
    // รันฟังก์ชันเริ่มต้นเมื่อโหลดหน้าเสร็จ
    document.addEventListener('DOMContentLoaded', init);

    // Export ฟังก์ชันให้สามารถเรียกใช้จากภายนอกได้
    window.loadConversations = loadConversations;
})();
