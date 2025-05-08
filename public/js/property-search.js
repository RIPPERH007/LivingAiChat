/**
 * Property Search Module
 * สำหรับจัดการการค้นหาอสังหาริมทรัพย์ใน Admin Dashboard
 */
(function() {
  // DOM Elements
  const elements = {
    // Property Search Panel
    propertySearchPanel: document.getElementById('propertySearchPanel'),
    showSearchBtn: document.getElementById('show-search-btn'),
    closePropertySearchBtn: document.getElementById('closePropertySearchBtn'),

    // Search Form Inputs
    provinceInput: document.getElementById('province-input'),
    facilitiesInput: document.getElementById('facilities-input'),
    priceInput: document.getElementById('price-input'),
    transactionTypeSelect: document.getElementById('transaction-type-select'),
    locationInput: document.getElementById('location-input'),
    propertyTypeSelect: document.getElementById('property-type-select'),

    // Action Buttons
    searchPropertiesBtn: document.getElementById('search-properties-btn'),
    updateSearchBtn: document.getElementById('update-search-btn'),

    // Results Container
    propertyCardsContainer: document.getElementById('property-cards-container'),
    moreResults: document.getElementById('more-results'),
    moreResultsLink: document.getElementById('more-results-link')
  };

  // State
  const state = {
    currentSessionId: null,
    searchData: {
      province: null,
      facilities: null,
      price: null,
      transactionType: null,
      location: null,
      propertyType: null,
      isComplete: false
    },
    searchResults: null
  };

  // Init Function
  function init() {
    console.log('Property search module initializing...');
    setupEventListeners();

    // ซ่อนปุ่มแสดงข้อมูลการค้นหาในตอนเริ่มต้น
    if (elements.showSearchBtn) {
      console.log('Show search button found, hiding...');
      elements.showSearchBtn.style.display = 'none';
    } else {
      console.warn('Show search button not found!');
    }
  }

  // Setup Event Listeners
  function setupEventListeners() {
    console.log('Setting up event listeners...');

    // แสดง/ซ่อน Property Search Panel
    if (elements.showSearchBtn) {
      console.log('Adding click event to show search button');
      elements.showSearchBtn.addEventListener('click', function() {
        console.log('Show search button clicked');
        showPropertySearchPanel();
      });
    }

    if (elements.closePropertySearchBtn) {
      elements.closePropertySearchBtn.addEventListener('click', hidePropertySearchPanel);
    }

    // ปุ่มค้นหา
    if (elements.searchPropertiesBtn) {
      elements.searchPropertiesBtn.addEventListener('click', searchProperties);
    }

    // ปุ่มบันทึกการแก้ไข
    if (elements.updateSearchBtn) {
      elements.updateSearchBtn.addEventListener('click', updateSearchData);
    }
  }

  // Show Property Search Panel
  function showPropertySearchPanel() {
    console.log('showPropertySearchPanel called');
    if (!elements.propertySearchPanel) {
      console.error('Property search panel element not found!');
      return;
    }

    console.log('Showing property search panel...');
    elements.propertySearchPanel.style.display = 'flex';
  }

  // Hide Property Search Panel
  function hidePropertySearchPanel() {
    if (!elements.propertySearchPanel) return;

    elements.propertySearchPanel.style.display = 'none';
  }

  // Load Search Data
  function loadSearchData(sessionId) {
    console.log('loadSearchData called with sessionId:', sessionId);
    if (!sessionId) return;

    // บันทึก sessionId ปัจจุบัน
    state.currentSessionId = sessionId;

    // แสดงปุ่มแสดงข้อมูลการค้นหา
    if (elements.showSearchBtn) {
      console.log('Show search button found, showing...');
      elements.showSearchBtn.style.display = 'inline-block';
    } else {
      console.warn('Show search button not found on loadSearchData!');
    }

    // โหลดข้อมูลการค้นหาจาก session
    if (window.adminAPI && window.adminAPI.fetchSessionData) {
      window.adminAPI.fetchSessionData(sessionId)
        .then(response => {
          console.log('Session data loaded:', response);
          if (response && response.data && response.data.propertySearch) {
            // บันทึกข้อมูลการค้นหา
            state.searchData = response.data.propertySearch;

            // แสดงข้อมูลการค้นหาในฟอร์ม
            updateSearchForm();

            // ถ้าข้อมูลครบทั้ง 6 steps ให้ตั้งค่า isComplete เป็น true
            checkSearchComplete();
          } else {
            console.log('No search data found for session:', sessionId);
          }
        })
        .catch(error => {
          console.error('Error loading search data:', error);
        });
    } else {
      console.error('adminAPI.fetchSessionData not found!');
    }
  }

  // Update Search Form
  function updateSearchForm() {
    const data = state.searchData;

    // อัปเดตค่าในฟอร์ม
    if (elements.provinceInput) elements.provinceInput.value = data.province || '';
    if (elements.facilitiesInput) elements.facilitiesInput.value = data.facilities || '';
    if (elements.priceInput) elements.priceInput.value = data.price || '';
    if (elements.transactionTypeSelect) elements.transactionTypeSelect.value = data.transactionType || '';
    if (elements.locationInput) elements.locationInput.value = data.location || '';
    if (elements.propertyTypeSelect) elements.propertyTypeSelect.value = data.propertyType || '';
  }

  // Get Search Form Data
  function getSearchFormData() {
    return {
      province: elements.provinceInput ? elements.provinceInput.value.trim() : null,
      facilities: elements.facilitiesInput ? elements.facilitiesInput.value.trim() : null,
      price: elements.priceInput ? elements.priceInput.value.trim() : null,
      transactionType: elements.transactionTypeSelect ? elements.transactionTypeSelect.value : null,
      location: elements.locationInput ? elements.locationInput.value.trim() : null,
      propertyType: elements.propertyTypeSelect ? elements.propertyTypeSelect.value : null
    };
  }

  // Check Search Complete
  function checkSearchComplete() {
    const data = state.searchData;
    const isComplete = data.province && data.facilities && data.price &&
                      data.transactionType && data.location && data.propertyType;

    state.searchData.isComplete = isComplete;

    return isComplete;
  }

  // Update Search Data
  function updateSearchData() {
    if (!state.currentSessionId) {
      showNotification('ไม่พบข้อมูล session กรุณาลองใหม่อีกครั้ง');
      return;
    }

    // ดึงข้อมูลจากฟอร์ม
    const formData = getSearchFormData();

    // อัปเดตข้อมูลในสถานะ
    state.searchData = {
      ...state.searchData,
      ...formData
    };

    // ตรวจสอบว่าข้อมูลครบทั้ง 6 steps หรือไม่
    state.searchData.isComplete = checkSearchComplete();

    // ส่งข้อมูลไปอัปเดตที่เซิร์ฟเวอร์
    if (window.adminAPI && window.adminAPI.updatePropertySearch) {
      window.adminAPI.updatePropertySearch(state.currentSessionId, state.searchData)
        .then(response => {
          console.log('Search data updated:', response);
          showNotification('อัปเดตข้อมูลการค้นหาสำเร็จ');
        })
        .catch(error => {
          console.error('Error updating search data:', error);
          showNotification('เกิดข้อผิดพลาดในการอัปเดตข้อมูล กรุณาลองใหม่อีกครั้ง', 'error');
        });
    } else {
      console.error('adminAPI.updatePropertySearch not found!');
      showNotification('ไม่พบฟังก์ชันอัปเดตข้อมูลค้นหา', 'error');
    }
  }

  // Search Properties
  function searchProperties() {
    if (!state.currentSessionId) {
      showNotification('ไม่พบข้อมูล session กรุณาลองใหม่อีกครั้ง');
      return;
    }

    // ดึงข้อมูลจากฟอร์ม
    const formData = getSearchFormData();

    // อัปเดตข้อมูลในสถานะ
    state.searchData = {
      ...state.searchData,
      ...formData
    };

    // ตรวจสอบว่าข้อมูลครบทั้ง 6 steps หรือไม่
    state.searchData.isComplete = checkSearchComplete();

    // แสดงสถานะกำลังโหลด
    if (elements.propertyCardsContainer) {
      elements.propertyCardsContainer.innerHTML = '<div class="loading">กำลังค้นหา...</div>';
    }

    // ส่งข้อมูลไปค้นหาที่เซิร์ฟเวอร์
    if (window.adminAPI && window.adminAPI.searchProperties) {
      window.adminAPI.searchProperties(state.searchData)
        .then(response => {
          console.log('Search results:', response);

          if (response && response.success && response.data) {
            // บันทึกผลลัพธ์การค้นหา
            state.searchResults = response.data;

            // แสดงผลลัพธ์การค้นหา
            renderSearchResults(response.data);
          } else {
            if (elements.propertyCardsContainer) {
              elements.propertyCardsContainer.innerHTML = '<div class="no-results">ไม่พบข้อมูลอสังหาริมทรัพย์</div>';
            }
          }
        })
        .catch(error => {
          console.error('Error searching properties:', error);
          if (elements.propertyCardsContainer) {
            elements.propertyCardsContainer.innerHTML = '<div class="error">เกิดข้อผิดพลาดในการค้นหา</div>';
          }
        });
    } else {
      console.error('adminAPI.searchProperties not found!');
      showNotification('ไม่พบฟังก์ชันค้นหาอสังหาริมทรัพย์', 'error');
    }
  }

  // Render Search Results
// ปรับแต่งฟังก์ชัน renderSearchResults ให้แสดงผลตามรูปที่ต้องการ
function renderSearchResults(data) {
  if (!elements.propertyCardsContainer) return;

  // ล้างผลลัพธ์เดิม
  elements.propertyCardsContainer.innerHTML = '';

  // ตรวจสอบว่ามีข้อมูลหรือไม่
  if (!data || !data.data || data.data.length === 0) {
    elements.propertyCardsContainer.innerHTML = '<div class="no-results">ไม่พบข้อมูลอสังหาริมทรัพย์</div>';
    return;
  }

  // แสดงผลลัพธ์การค้นหา
  data.data.forEach(property => {
    const propertyCard = document.createElement('div');
    propertyCard.className = 'property-card';

    // กำหนดประเภทการ์ด (ซื้อ/เช่า)
    const tagClass = property.tag === 'เช่า' ? 'property-tag-rent' : 'property-tag-buy';
    const tagIcon = property.tag === 'เช่า' ? 'home' : 'tag';

    propertyCard.innerHTML = `
      <div class="property-image">
        <img src="${property.photo || 'assets/images/property-placeholder.jpg'}" alt="${property.name || 'อสังหาริมทรัพย์'}">
        <div class="property-type-badge ${tagClass}">
          <i class="fas fa-${tagIcon}"></i> ${property.tag || 'ขาย'}
        </div>
      </div>
      <div class="property-details">
        <div class="property-title">${property.tag || 'ขาย'} ${property.name || 'ไม่มีชื่อ'}</div>
        <div class="property-location">
          <i class="fas fa-map-marker-alt"></i> ${property.zone || 'ไม่ระบุที่ตั้ง'}
        </div>
        <div class="property-price">฿${property.price || '-'}</div>
      </div>
    `;

    // เพิ่ม Event Listener เมื่อคลิกที่การ์ด
    propertyCard.addEventListener('click', function() {
      window.open(property.link || '#', '_blank');
    });

    propertyCard.style.cursor = 'pointer';

    elements.propertyCardsContainer.appendChild(propertyCard);
  });

  // แสดงลิงก์ดูเพิ่มเติม (ถ้ามี)
  if (elements.moreResults && elements.moreResultsLink && data.more && data.more.link) {
    elements.moreResults.style.display = 'block';
    elements.moreResultsLink.href = data.more.link;
    elements.moreResultsLink.textContent = data.more.txt || 'ดูเพิ่มเติม';
  } else if (elements.moreResults) {
    elements.moreResults.style.display = 'none';
  }
}
  // Show Notification
  function showNotification(message, type = 'success') {
    // สร้างการแจ้งเตือนบนหน้าเว็บ
    const notification = document.createElement('div');
    notification.className = `admin-notification ${type}`;
    notification.textContent = message;

    // เพิ่มลงในหน้าเว็บ
    document.body.appendChild(notification);

    // ซ่อนแจ้งเตือนหลังจาก 3 วินาที
    setTimeout(() => {
      notification.classList.add('fade-out');
      setTimeout(() => {
        document.body.removeChild(notification);
      }, 500);
    }, 3000);
  }

  // Handle Socket Events
  function handleSocketEvents(socket) {
    if (!socket) {
      console.warn('Socket not provided to property search module');
      return;
    }

    console.log('Setting up socket event handlers for property search');

    // รับการแจ้งเตือนการค้นหาใหม่
    socket.on('new_property_search', (data) => {
      console.log('New property search:', data);

      if (state.currentSessionId === data.sessionId) {
        // ถ้ากำลังดูการสนทนานี้อยู่ ให้อัปเดตข้อมูลการค้นหา
        state.searchData = data.searchData;
        updateSearchForm();

        // แสดงการแจ้งเตือน
        showNotification('ได้รับข้อมูลการค้นหาใหม่');

        // แสดงปุ่มแสดงข้อมูลการค้นหา
        if (elements.showSearchBtn) {
          elements.showSearchBtn.style.display = 'inline-block';
        }
      }
    });

    // รับผลลัพธ์การค้นหา
    socket.on('property_search_results', (data) => {
      console.log('Property search results:', data);

      if (data.success && data.data) {
        // บันทึกผลลัพธ์การค้นหา
        state.searchResults = data.data;

        // แสดงผลลัพธ์การค้นหา
        renderSearchResults(data.data);

        // แสดงการแจ้งเตือน
        showNotification('ได้รับผลลัพธ์การค้นหา');
      }
    });
  }

  // Export functions
  window.propertySearchModule = {
    init: init,
    loadSearchData: loadSearchData,
    showPropertySearchPanel: showPropertySearchPanel,
    hidePropertySearchPanel: hidePropertySearchPanel,
    handleSocketEvents: handleSocketEvents
  };

  console.log('Property search module loaded successfully!');
})();
