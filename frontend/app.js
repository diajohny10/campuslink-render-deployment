/**
 * CampusLink - Private Campus Learning Network (Frontend)
 */

const API_BASE_URL = (window.CAMPUSLINK_CONFIG && window.CAMPUSLINK_CONFIG.API_BASE_URL) || (window.location.protocol === 'file:' ? 'http://localhost:5000/api' : `${window.location.origin}/api`);

class CampusNetApp {
  constructor() {
    this.apiBase = API_BASE_URL;
    this.currentUser = null;
    this.token = null;
    
    this.activeTeacherSubject = 'CN';
    this.activeStudentSubject = 'ALL';
    this.activeTeacherTab = 'resources';
    this.activeStudentTab = 'resources';
    
    this.subjects = ['CN', 'DS', 'DMS', 'ECON', 'UHV', 'COA'];
    this.resources = [];
    this.students = [];
    this.transfers = [];

    this.init();
  }

  async init() {
    // Restore session from sessionStorage
    const storedToken = sessionStorage.getItem('campusnet_token');
    const storedUser = sessionStorage.getItem('campusnet_user');

    if (storedToken && storedUser) {
      this.token = storedToken;
      try {
        this.currentUser = JSON.parse(storedUser);
        const res = await fetch(`${this.apiBase}/auth/session`, {
          headers: this.getAuthHeaders()
        });
        if (res.ok) {
          const data = await res.json();
          this.currentUser = data.user;
          sessionStorage.setItem('campusnet_user', JSON.stringify(this.currentUser));
          
          if (this.currentUser.role === 'teacher') {
            this.activeTeacherSubject = this.currentUser.subjectCode || 'CN';
            await this.loadResources();
            await this.loadStudentRoster();
            await this.loadTransfers();
            this.renderTeacherDashboard();
            this.showView('teacher-dashboard');
            return;
          } else {
            await this.loadResources();
            await this.loadStudentRoster();
            await this.loadTransfers();
            this.renderStudentDashboard();
            this.showView('student-dashboard');
            return;
          }
        }
      } catch (err) {
        console.warn('Session verification failed:', err.message);
      }
    }

    // Clear stale session
    this.token = null;
    this.currentUser = null;
    sessionStorage.removeItem('campusnet_token');
    sessionStorage.removeItem('campusnet_user');
    this.showView('landing');
  }

  getAuthHeaders(contentType = null) {
    const headers = {};
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }
    if (contentType) {
      headers['Content-Type'] = contentType;
    }
    return headers;
  }

  escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  formatBytes(bytes) {
    if (typeof bytes !== 'number' || isNaN(bytes) || bytes < 0) return '0 B';
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    const val = parseFloat((bytes / Math.pow(k, i)).toFixed(1));
    return `${val} ${sizes[i]}`;
  }

  showView(viewId) {
    document.querySelectorAll('.page-view').forEach(el => el.classList.remove('active'));
    
    const target = document.getElementById(`view-${viewId}`);
    if (target) {
      target.classList.add('active');
    }

    const navUser = document.getElementById('nav-user-info');
    const navLogout = document.getElementById('nav-logout-btn');

    if (this.currentUser && (viewId === 'teacher-dashboard' || viewId === 'student-dashboard')) {
      navUser.style.display = 'block';
      navLogout.style.display = 'inline-flex';

      if (this.currentUser.role === 'teacher') {
        navUser.innerHTML = `<span class="user-badge"><span class="role-dot teacher"></span> Teacher (${this.escapeHtml(this.currentUser.subjectCode)})</span>`;
      } else {
        navUser.innerHTML = `<span class="user-badge"><span class="role-dot student"></span> Student (${this.escapeHtml(this.currentUser.name)})</span>`;
      }
    } else {
      navUser.style.display = 'none';
      navLogout.style.display = 'none';
    }

    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // --- AUTHENTICATION HANDLERS ---
  async handleTeacherLogin(e) {
    e.preventDefault();
    const subjectCode = document.getElementById('teacher-subject-code').value;
    const password = document.getElementById('teacher-password').value;

    if (!subjectCode) {
      this.showToast('Please select a Subject Code', 'error');
      return;
    }

    try {
      const response = await fetch(`${this.apiBase}/auth/teacher-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subjectCode, password })
      });

      const data = await response.json();
      if (response.ok && data.success) {
        this.token = data.token;
        this.currentUser = data.user;

        sessionStorage.setItem('campusnet_token', this.token);
        sessionStorage.setItem('campusnet_user', JSON.stringify(this.currentUser));

        this.activeTeacherSubject = subjectCode;
        this.showToast(`Logged in as Subject Teacher for ${subjectCode}`, 'success');

        await this.loadResources();
        await this.loadStudentRoster();
        await this.loadTransfers();

        this.renderTeacherDashboard();
        this.showView('teacher-dashboard');
      } else {
        this.showToast(data.message || 'Login failed', 'error');
      }
    } catch (err) {
      this.showToast('Unable to connect to backend server. Make sure server is running on port 5000.', 'error');
    }
  }

  async handleStudentLogin(e) {
    e.preventDefault();
    const nameInput = document.getElementById('student-name').value.trim();
    const passwordInput = document.getElementById('student-password').value;

    if (!nameInput || !passwordInput) {
      this.showToast('Please enter your Name and Password', 'error');
      return;
    }

    try {
      const response = await fetch(`${this.apiBase}/auth/student-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: nameInput, password: passwordInput })
      });

      const data = await response.json();
      if (response.ok && data.success) {
        this.token = data.token;
        this.currentUser = data.user;

        sessionStorage.setItem('campusnet_token', this.token);
        sessionStorage.setItem('campusnet_user', JSON.stringify(this.currentUser));

        this.showToast(`Welcome back, ${data.user.name}!`, 'success');

        await this.loadResources();
        await this.loadStudentRoster();
        await this.loadTransfers();

        this.renderStudentDashboard();
        this.showView('student-dashboard');
      } else {
        this.showToast(data.message || 'Authentication failed', 'error');
      }
    } catch (err) {
      this.showToast('Unable to connect to backend server. Make sure server is running on port 5000.', 'error');
    }
  }

  async logout() {
    if (this.token) {
      try {
        await fetch(`${this.apiBase}/auth/logout`, {
          method: 'POST',
          headers: this.getAuthHeaders()
        });
      } catch (err) {}
    }

    this.token = null;
    this.currentUser = null;
    this.resources = [];
    this.students = [];
    this.transfers = [];

    sessionStorage.removeItem('campusnet_token');
    sessionStorage.removeItem('campusnet_user');

    this.showToast('Logged out successfully', 'info');
    this.showView('landing');
  }

  // --- DATA LOADING FROM SERVER ---
  async loadResources() {
    if (!this.token) return;

    try {
      const res = await fetch(`${this.apiBase}/resources`, {
        headers: this.getAuthHeaders()
      });

      if (res.ok) {
        const data = await res.json();
        this.resources = data.resources || [];
        
        if (this.currentUser) {
          if (this.currentUser.role === 'teacher') {
            this.renderTeacherDashboard();
          } else {
            this.renderStudentDashboard();
          }
        }
      } else if (res.status === 401) {
        this.showToast('Session expired. Please log in again.', 'error');
        this.logout();
      }
    } catch (err) {
      this.showToast('Error loading resources from server.', 'error');
    }
  }

  async loadStudentRoster() {
    if (!this.token || !this.currentUser || !['teacher', 'student'].includes(this.currentUser.role)) return;

    try {
      const rosterPath = this.currentUser.role === 'teacher' ? '/students' : '/students/roster';
      const res = await fetch(`${this.apiBase}${rosterPath}`, {
        headers: this.getAuthHeaders()
      });

      if (res.ok) {
        const data = await res.json();
        this.students = data.students || [];
        this.updateStudentDropdowns();
        if (this.currentUser.role === 'teacher') this.renderRegisteredStudentsRoster();
      }
    } catch (err) {}
  }

  async loadTransfers() {
    if (!this.token) return;

    try {
      const res = await fetch(`${this.apiBase}/transfers`, {
        headers: this.getAuthHeaders()
      });

      if (res.ok) {
        const data = await res.json();
        this.transfers = data.transfers || [];
        if (this.currentUser && this.currentUser.role === 'teacher') {
          this.renderTeacherInboxTable();
          this.renderTeacherAuditLogs();
        } else if (this.currentUser && this.currentUser.role === 'student') {
          this.renderStudentInboxTable();
        }
      }
    } catch (err) {}
  }

  updateStudentDropdowns() {
    const teacherRecipientEl = document.getElementById('teacher-send-recipient-student');
    const studentRecipientEl = document.getElementById('transfer-recipient-student');

    const optionsHtml = `<option value="">Select a student...</option>` + (this.students || []).map(s => `
      <option value="${this.escapeHtml(s.id)}">${this.escapeHtml(s.name)} (${this.escapeHtml(s.section)})</option>
    `).join('');

    if (teacherRecipientEl) teacherRecipientEl.innerHTML = optionsHtml;
    if (studentRecipientEl) studentRecipientEl.innerHTML = optionsHtml;
  }

  // --- TEACHER DASHBOARD ---
  renderTeacherDashboard() {
    if (!this.currentUser || this.currentUser.role !== 'teacher') return;

    const mySubject = this.currentUser.subjectCode;

    const subjectListEl = document.getElementById('teacher-subject-list');
    if (subjectListEl) {
      subjectListEl.innerHTML = this.subjects.map(code => {
        const count = (this.resources || []).filter(r => r.subject === code).length;
        const isMySubject = code === mySubject;
        const isActive = code === this.activeTeacherSubject;

        return `
          <div class="subject-item ${isActive ? 'active' : ''}" onclick="app.selectTeacherSubject('${code}')">
            <span><i class="fa-solid fa-book-bookmark"></i> ${code}</span>
            <span class="badge" style="${isMySubject ? 'background: var(--accent-indigo); color: #fff;' : ''}">
              ${isMySubject ? 'MY SUBJECT' : `${count}`}
            </span>
          </div>
        `;
      }).join('');
    }

    document.getElementById('teacher-active-subject').innerText = this.activeTeacherSubject;
    
    const uploadBtn = document.getElementById('teacher-upload-btn');
    if (uploadBtn) {
      if (this.activeTeacherSubject === mySubject) {
        uploadBtn.disabled = false;
        uploadBtn.style.opacity = '1';
        uploadBtn.style.cursor = 'pointer';
      } else {
        uploadBtn.disabled = true;
        uploadBtn.style.opacity = '0.5';
        uploadBtn.style.cursor = 'not-allowed';
      }
    }

    this.renderTeacherFilesTable();
    this.renderTeacherInboxTable();
    this.renderRegisteredStudentsRoster();
    this.renderTeacherAuditLogs();
  }

  selectTeacherSubject(code) {
    this.activeTeacherSubject = code;
    this.renderTeacherDashboard();
  }

  showTeacherTab(tabName) {
    this.activeTeacherTab = tabName;
    document.getElementById('teacher-tab-resources').style.display = tabName === 'resources' ? 'block' : 'none';
    document.getElementById('teacher-tab-inbox').style.display = tabName === 'inbox' ? 'block' : 'none';
    document.getElementById('teacher-tab-send-student').style.display = tabName === 'send-student' ? 'block' : 'none';
    document.getElementById('teacher-tab-register-student').style.display = tabName === 'register-student' ? 'block' : 'none';
    document.getElementById('teacher-tab-notifications').style.display = tabName === 'notifications' ? 'block' : 'none';

    const titleMap = {
      resources: `Subject Resources (${this.activeTeacherSubject})`,
      inbox: `Student Submissions (${this.activeTeacherSubject})`,
      'send-student': `Send Direct File to Student`,
      'register-student': `Register New Student`,
      notifications: `Network Transfer Notifications`
    };
    document.getElementById('teacher-view-title').innerText = titleMap[tabName];
  }

  renderTeacherFilesTable() {
    const tbody = document.getElementById('teacher-files-tbody');
    if (!tbody) return;

    const files = (this.resources || []).filter(r => r.subject === this.activeTeacherSubject);
    const mySubject = this.currentUser ? this.currentUser.subjectCode : '';

    if (files.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="5">
            <div class="empty-state">
              <div class="empty-state-icon"><i class="fa-solid fa-folder-open"></i></div>
              <p>No resources uploaded for ${this.activeTeacherSubject} yet.</p>
            </div>
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = files.map(file => {
      const isMySubjectFile = file.subject === mySubject;
      const isMissing = !!file.missingOnDisk;

      return `
        <tr>
          <td>
            <div class="file-name-cell">
              <span class="file-icon"><i class="fa-solid fa-file-pdf"></i></span>
              <strong>${this.escapeHtml(file.name)}</strong>
              ${file.originalName && file.originalName !== file.name ? `<br><small style="color: var(--text-muted); font-size:0.75rem;">${this.escapeHtml(file.originalName)}</small>` : ''}
            </div>
          </td>
          <td><span class="user-badge"><span class="role-dot teacher"></span> ${this.escapeHtml(file.uploadedBy)}</span></td>
          <td>${this.escapeHtml(file.date || file.uploadedAt || 'N/A')}</td>
          <td>${this.escapeHtml(file.size || 'N/A')}</td>
          <td>
            <div style="display: flex; gap: 0.4rem; align-items: center;">
              ${isMissing ? `
                <button class="btn btn-outline btn-sm" disabled style="opacity: 0.5;" title="File missing on server storage">
                  <i class="fa-solid fa-ban"></i> Unavailable
                </button>
              ` : `
                <button class="btn btn-primary btn-sm" onclick="app.downloadResource('${file.id}')">
                  <i class="fa-solid fa-download"></i> Download
                </button>
              `}
              ${isMySubjectFile ? `
                <button class="btn btn-danger btn-sm" onclick="app.deleteResource('${file.id}')">
                  <i class="fa-solid fa-trash-can"></i> Delete
                </button>
              ` : '<span style="color:var(--text-dim); font-size:0.8rem;"><i class="fa-solid fa-lock"></i> View Only</span>'}
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }

  // --- TEACHER UPLOAD MODAL & SUBMISSION ---
  openUploadModal() {
    if (!this.currentUser || this.currentUser.role !== 'teacher') return;
    const mySubject = this.currentUser.subjectCode;

    if (this.activeTeacherSubject !== mySubject) {
      this.showToast(`Permission Denied: You are Teacher ${mySubject}. You can only upload to ${mySubject}!`, 'error');
      return;
    }

    document.getElementById('upload-subject-code').value = mySubject;
    document.getElementById('upload-file-title').value = '';
    
    const fileInput = document.getElementById('upload-file');
    if (fileInput) fileInput.value = '';
    
    const infoBox = document.getElementById('file-selected-info');
    if (infoBox) {
      infoBox.style.display = 'none';
      infoBox.innerHTML = '';
    }

    const btnSubmit = document.getElementById('btn-submit-upload');
    if (btnSubmit) {
      btnSubmit.disabled = false;
      btnSubmit.innerHTML = '<i class="fa-solid fa-upload"></i> Publish File for Students';
    }

    document.getElementById('modal-upload').classList.add('active');
  }

  closeModal(modalId) {
    document.getElementById(modalId).classList.remove('active');
  }

  handleFileSelectChange(e) {
    const file = e.target.files && e.target.files[0];
    const infoBox = document.getElementById('file-selected-info');
    const titleInput = document.getElementById('upload-file-title');

    if (!file) {
      if (infoBox) infoBox.style.display = 'none';
      return;
    }

    const allowedExts = ['.pdf', '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx', '.txt', '.png', '.jpg', '.jpeg'];
    const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();

    if (!allowedExts.includes(ext)) {
      this.showToast(`File type "${ext}" is not supported. Supported: PDF, DOC, DOCX, PPT, PPTX, XLS, XLSX, TXT, PNG, JPG, JPEG`, 'error');
      e.target.value = '';
      if (infoBox) infoBox.style.display = 'none';
      return;
    }

    const maxBytes = 25 * 1024 * 1024; // 25 MiB
    if (file.size > maxBytes) {
      this.showToast(`File size (${this.formatBytes(file.size)}) exceeds the maximum limit of 25 MiB.`, 'error');
      e.target.value = '';
      if (infoBox) infoBox.style.display = 'none';
      return;
    }

    if (infoBox) {
      infoBox.style.display = 'block';
      infoBox.innerHTML = `<i class="fa-solid fa-file-circle-check"></i> Selected: <strong>${this.escapeHtml(file.name)}</strong> (${this.formatBytes(file.size)})`;
    }

    if (titleInput && !titleInput.value.trim()) {
      titleInput.placeholder = file.name;
    }
  }

  async handleResourceUpload(e) {
    e.preventDefault();
    if (!this.currentUser || this.currentUser.role !== 'teacher') return;

    const fileInput = document.getElementById('upload-file');
    const file = fileInput && fileInput.files && fileInput.files[0];

    if (!file) {
      this.showToast('Please select a file to upload', 'error');
      return;
    }

    const mySubject = this.currentUser.subjectCode;
    const title = document.getElementById('upload-file-title').value.trim() || file.name;

    const btnSubmit = document.getElementById('btn-submit-upload');
    if (btnSubmit) {
      btnSubmit.disabled = true;
      btnSubmit.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Uploading...';
    }

    const formData = new FormData();
    formData.append('file', file);
    formData.append('subject', mySubject);
    formData.append('title', title);

    try {
      const response = await fetch(`${this.apiBase}/resources/upload`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.token}`
        },
        body: formData
      });

      const data = await response.json();

      if (response.ok && data.success) {
        this.showToast(`Uploaded "${title}" to ${mySubject}!`, 'success');
        this.closeModal('modal-upload');
        await this.loadResources();
      } else {
        this.showToast(data.message || 'Upload failed', 'error');
        if (btnSubmit) {
          btnSubmit.disabled = false;
          btnSubmit.innerHTML = '<i class="fa-solid fa-upload"></i> Publish File for Students';
        }
      }
    } catch (err) {
      this.showToast('Network error during upload. Check backend connection.', 'error');
      if (btnSubmit) {
        btnSubmit.disabled = false;
        btnSubmit.innerHTML = '<i class="fa-solid fa-upload"></i> Publish File for Students';
      }
    }
  }

  async deleteResource(id) {
    if (!this.currentUser || this.currentUser.role !== 'teacher') return;

    if (!confirm('Are you sure you want to delete this resource?')) return;

    try {
      const response = await fetch(`${this.apiBase}/resources/${id}`, {
        method: 'DELETE',
        headers: this.getAuthHeaders()
      });
      const data = await response.json();

      if (response.ok && data.success) {
        this.showToast('Resource deleted successfully', 'info');
        await this.loadResources();
      } else {
        this.showToast(data.message || 'Failed to delete resource', 'error');
      }
    } catch (err) {
      this.showToast('Network error while deleting resource', 'error');
    }
  }

  // --- DOWNLOAD RESOURCE FILE (Protected Endpoint) ---
  async downloadResource(resourceId) {
    if (!this.token) {
      this.showToast('Authentication required to download files', 'error');
      return;
    }

    this.showToast('Starting download...', 'info');

    try {
      const response = await fetch(`${this.apiBase}/resources/${resourceId}/download`, {
        headers: this.getAuthHeaders()
      });

      if (!response.ok) {
        let errMessage = 'Download failed';
        try {
          const data = await response.json();
          errMessage = data.message || errMessage;
        } catch (e) {}
        this.showToast(errMessage, 'error');
        return;
      }

      // Extract filename from Content-Disposition header if available
      let filename = 'downloaded_resource';
      const disposition = response.headers.get('Content-Disposition');
      if (disposition) {
        const utfMatch = disposition.match(/filename\*=UTF-8''([^;]+)/i);
        if (utfMatch && utfMatch[1]) {
          filename = decodeURIComponent(utfMatch[1]);
        } else {
          const regMatch = disposition.match(/filename="?([^";]+)"?/i);
          if (regMatch && regMatch[1]) {
            filename = decodeURIComponent(regMatch[1]);
          }
        }
      } else {
        const found = (this.resources || []).find(r => String(r.id) === String(resourceId));
        if (found) {
          filename = found.originalName || found.name;
        }
      }

      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(blobUrl);

    } catch (err) {
      this.showToast('Network error during file download.', 'error');
    }
  }

  // --- STUDENT DASHBOARD & RESOURCES ---
  renderStudentDashboard() {
    if (!this.currentUser || this.currentUser.role !== 'student') return;

    document.getElementById('student-display-name').innerText = this.currentUser.name;

    const subjectListEl = document.getElementById('student-subject-list');
    if (subjectListEl) {
      let html = `
        <div class="subject-item ${this.activeStudentSubject === 'ALL' ? 'active' : ''}" onclick="app.selectStudentSubject('ALL')">
          <span><i class="fa-solid fa-layer-group"></i> All Subjects</span>
          <span class="badge">${(this.resources || []).length}</span>
        </div>
      `;

      this.subjects.forEach(code => {
        const count = (this.resources || []).filter(r => r.subject === code).length;
        const isActive = code === this.activeStudentSubject;
        html += `
          <div class="subject-item ${isActive ? 'active' : ''}" onclick="app.selectStudentSubject('${code}')">
            <span><i class="fa-solid fa-book"></i> ${code}</span>
            <span class="badge">${count}</span>
          </div>
        `;
      });

      subjectListEl.innerHTML = html;
    }

    this.renderStudentResourcesTable();
    this.renderStudentInboxTable();
  }

  selectStudentSubject(code) {
    this.activeStudentSubject = code;
    this.renderStudentDashboard();
  }

  showStudentTab(tabName) {
    this.activeStudentTab = tabName;
    document.getElementById('student-tab-resources').style.display = tabName === 'resources' ? 'block' : 'none';
    document.getElementById('student-tab-transfer').style.display = tabName === 'transfer' ? 'block' : 'none';
    document.getElementById('student-tab-inbox').style.display = tabName === 'inbox' ? 'block' : 'none';

    const titleMap = {
      resources: `Subject Resources (${this.activeStudentSubject})`,
      transfer: `Offline Campus File Transfer`,
      inbox: `Private Transfers & File History`
    };
    document.getElementById('student-view-title').innerText = titleMap[tabName];
  }

  renderStudentResourcesTable() {
    const tbody = document.getElementById('student-resources-tbody');
    if (!tbody) return;

    let files = this.resources || [];
    if (this.activeStudentSubject !== 'ALL') {
      files = files.filter(r => r.subject === this.activeStudentSubject);
    }

    if (files.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="5">
            <div class="empty-state">
              <div class="empty-state-icon"><i class="fa-solid fa-folder-open"></i></div>
              <p>No resources found for this subject filter.</p>
            </div>
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = files.map(file => {
      const isMissing = !!file.missingOnDisk;

      return `
        <tr>
          <td>
            <div class="file-name-cell">
              <span class="file-icon"><i class="fa-solid fa-file-pdf"></i></span>
              <strong>${this.escapeHtml(file.name)}</strong>
              ${file.originalName && file.originalName !== file.name ? `<br><small style="color: var(--text-muted); font-size:0.75rem;">${this.escapeHtml(file.originalName)}</small>` : ''}
            </div>
          </td>
          <td><strong style="color: var(--primary-blue);">${this.escapeHtml(file.subject)}</strong></td>
          <td><span class="user-badge"><span class="role-dot teacher"></span> ${this.escapeHtml(file.uploadedBy)}</span></td>
          <td>${this.escapeHtml(file.size || 'N/A')}</td>
          <td>
            ${isMissing ? `
              <button class="btn btn-outline btn-sm" disabled style="opacity: 0.5;" title="File missing on server storage">
                <i class="fa-solid fa-ban"></i> Unavailable
              </button>
            ` : `
              <button class="btn btn-primary btn-sm" onclick="app.downloadResource('${file.id}')">
                <i class="fa-solid fa-download"></i> Download
              </button>
            `}
          </td>
        </tr>
      `;
    }).join('');
  }

  // --- STUDENT REGISTRATION ROSTER ---
  renderRegisteredStudentsRoster() {
    const tbody = document.getElementById('registered-students-tbody');
    if (!tbody) return;

    tbody.innerHTML = (this.students || []).map(s => `
      <tr>
        <td>
          <div class="file-name-cell">
            <span class="user-badge" style="margin-right: 0.5rem;"><span class="role-dot student"></span> ${this.escapeHtml(s.name)}</span>
          </div>
        </td>
        <td><code>${this.escapeHtml(s.id)}</code></td>
        <td>${this.escapeHtml(s.section)}</td>
      </tr>
    `).join('');
  }

  async handleRegisterStudent(e) {
    e.preventDefault();
    const name = document.getElementById('reg-student-name').value.trim();
    const studentId = document.getElementById('reg-student-id').value.trim();
    const section = document.getElementById('reg-student-section').value;
    const password = document.getElementById('reg-student-password').value.trim();

    if (!name || !studentId || !password) {
      this.showToast('Please provide student name, ID, and password', 'error');
      return;
    }

    try {
      const response = await fetch(`${this.apiBase}/students/register`, {
        method: 'POST',
        headers: this.getAuthHeaders('application/json'),
        body: JSON.stringify({ name, studentId, section, password })
      });

      const data = await response.json();
      if (response.ok && data.success) {
        this.showToast(`Successfully registered "${name}"!`, 'success');
        document.getElementById('reg-student-name').value = '';
        document.getElementById('reg-student-id').value = '';
        document.getElementById('reg-student-password').value = '';
        await this.loadStudentRoster();
      } else {
        this.showToast(data.message || 'Registration failed', 'error');
      }
    } catch (err) {
      this.showToast('Network error during student registration', 'error');
    }
  }

  async removeAllStudents() {
    if (!this.currentUser || this.currentUser.role !== 'teacher') return;
    if (!confirm('Remove every registered student from CampusLink? Students will no longer be able to log in. This keeps resources and transfer records.')) return;

    const button = document.getElementById('remove-all-students-btn');
    if (button) button.disabled = true;
    try {
      const response = await fetch(`${this.apiBase}/students`, {
        method: 'DELETE',
        headers: this.getAuthHeaders()
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.message || 'Could not remove registered students');
      await this.loadStudentRoster();
      this.showToast(data.message, 'success');
    } catch (err) {
      this.showToast(err.message || 'Could not remove registered students', 'error');
    } finally {
      if (button) button.disabled = false;
    }
  }

  // --- TRANSFERS DEMO FLOWS ---
  renderTeacherInboxTable() {
    const tbody = document.getElementById('teacher-inbox-tbody');
    if (!tbody) return;

    const teacherName = `Teacher ${this.activeTeacherSubject}`;
    const submissions = (this.transfers || []).filter(t => t.type === 'student_to_teacher' && t.to === teacherName);

    if (submissions.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="5">
            <div class="empty-state">
              <div class="empty-state-icon"><i class="fa-solid fa-inbox"></i></div>
              <p>No student submissions received for ${this.activeTeacherSubject}.</p>
            </div>
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = submissions.map(sub => `
      <tr>
        <td><span class="user-badge"><span class="role-dot student"></span> ${this.escapeHtml(sub.from)}</span></td>
        <td><strong style="color: var(--primary-blue);">${this.escapeHtml(sub.subject || this.activeTeacherSubject)}</strong></td>
        <td>
          <div class="file-name-cell">
            <span class="file-icon" style="background: #e0e7ff; color: #4338ca;">
              <i class="fa-solid fa-file-lines"></i>
            </span>
            ${this.escapeHtml(sub.fileName)}
          </div>
        </td>
        <td>${this.escapeHtml(this.formatTransferDate(sub.date))}</td>
        <td>
          <button class="btn btn-primary btn-sm" onclick="app.downloadTransfer('${this.escapeHtml(sub.id)}')">
            <i class="fa-solid fa-download"></i> Download
          </button>
        </td>
      </tr>
    `).join('');
  }

  renderTeacherAuditLogs() {
    const tbody = document.getElementById('teacher-logs-tbody');
    if (!tbody) return;

    tbody.innerHTML = (this.transfers || []).map(t => {
      let badgeColor = 'var(--primary-blue)';
      let details = '';

      if (t.type === 'student_to_student') {
        badgeColor = 'var(--warning)';
        details = `Student <strong>${this.escapeHtml(t.from)}</strong> sent a file to Student <strong>${this.escapeHtml(t.to)}</strong> (<code>${this.escapeHtml(t.fileName)}</code>)`;
      } else if (t.type === 'student_to_teacher') {
        badgeColor = 'var(--accent-indigo)';
        details = `Student <strong>${this.escapeHtml(t.from)}</strong> submitted <code>${this.escapeHtml(t.fileName)}</code> to <strong>${this.escapeHtml(t.to)}</strong>`;
      } else if (t.type === 'teacher_to_student') {
        badgeColor = 'var(--accent-indigo)';
        details = `You (<strong>${this.escapeHtml(t.from)}</strong>) sent direct file <code>${this.escapeHtml(t.fileName)}</code> to Student <strong>${this.escapeHtml(t.to)}</strong>`;
      } else if (t.type === 'student_registered') {
        badgeColor = 'var(--success)';
        details = `Registered new student <strong>${this.escapeHtml(t.to)}</strong> (<code>${this.escapeHtml(t.fileName)}</code>)`;
      } else {
        badgeColor = 'var(--success)';
        details = `Uploaded <code>${this.escapeHtml(t.fileName)}</code> to <strong>${this.escapeHtml(t.subject || 'Course')}</strong>`;
      }

      return `
        <tr>
          <td style="font-family: monospace; color: var(--text-muted);">${this.escapeHtml(t.date)}</td>
          <td>
            <span class="badge" style="background: #f1f5f9; border: 1px solid var(--border-light); color: ${badgeColor}; font-weight:700;">
              ${this.escapeHtml(t.type.replace(/_/g, ' ').toUpperCase())}
            </span>
          </td>
          <td>${details}</td>
        </tr>
      `;
    }).join('');
  }

  renderStudentInboxTable() {
    const tbody = document.getElementById('student-inbox-tbody');
    if (!tbody || !this.currentUser) return;

    const myId = this.currentUser.studentId;
    const history = (this.transfers || []).filter(t => (t.fromId === myId || t.toId === myId) && !t.auditOnly);

    if (history.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="5">
            <div class="empty-state">
              <div class="empty-state-icon"><i class="fa-solid fa-box-archive"></i></div>
              <p>No transfers or received private files yet.</p>
            </div>
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = history.map(t => {
      const isSender = t.fromId === myId;
      return `
        <tr>
          <td style="font-family: monospace; color: var(--text-muted);">${this.escapeHtml(this.formatTransferDate(t.date))}</td>
          <td>
            <span class="badge" style="background: #f1f5f9; color: ${isSender ? 'var(--warning)' : 'var(--success)'}; font-weight:700;">
              ${isSender ? 'SENT' : 'RECEIVED'}
            </span>
          </td>
          <td>${isSender ? `To: <strong>${this.escapeHtml(t.to)}</strong>` : `From: <strong>${this.escapeHtml(t.from)}</strong>`}</td>
          <td>
            <div class="file-name-cell">
              <span class="file-icon" style="background: #dbeafe;"><i class="fa-solid fa-file-arrow-up"></i></span>
              ${this.escapeHtml(t.fileName)}
            </div>
          </td>
          <td>${t.filename ? `<button class="btn btn-primary btn-sm" onclick="app.downloadTransfer('${this.escapeHtml(t.id)}')"><i class="fa-solid fa-download"></i> Download</button>` : '<span class="text-muted">No file attached</span>'}</td>
        </tr>
      `;
    }).join('');
  }

  toggleTransferRecipientOptions() {
    const type = document.getElementById('transfer-target-type').value;
    document.getElementById('recipient-student-group').style.display = type === 'student' ? 'block' : 'none';
    document.getElementById('recipient-teacher-group').style.display = type === 'teacher' ? 'block' : 'none';
  }

  updateTransferFileName(event) {
    const file = event.target.files && event.target.files[0];
    const display = document.getElementById('transfer-file-name-display');
    if (display) display.textContent = file ? `${file.name} (${this.formatBytes(file.size)})` : 'No file selected';
  }

  async executeStudentTransfer() {
    const type = document.getElementById('transfer-target-type').value;
    const file = document.getElementById('transfer-file').files[0];
    if (!file) {
      this.showToast('Please choose a file to transfer', 'error');
      return;
    }
    if (file.size > 25 * 1024 * 1024) return this.showToast('File size exceeds the 25 MiB limit', 'error');

    let recipientId = '';
    let targetSubject = null;

    if (type === 'student') {
      recipientId = document.getElementById('transfer-recipient-student').value;
    } else {
      targetSubject = document.getElementById('transfer-recipient-teacher').value;
    }
    if (type === 'student' && !recipientId) return this.showToast('Please select a student recipient', 'error');

    try {
      const form = new FormData();
      form.append('file', file);
      form.append('type', type === 'student' ? 'student_to_student' : 'student_to_teacher');
      if (recipientId) form.append('recipientId', recipientId);
      if (targetSubject) form.append('subject', targetSubject);
      const response = await fetch(`${this.apiBase}/transfers`, { method: 'POST', headers: this.getAuthHeaders(), body: form });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.message || 'Transfer failed');
      this.showToast(`File sent to ${data.transfer.to}`, 'success');
      document.getElementById('transfer-file').value = '';
      this.updateTransferFileName({ target: document.getElementById('transfer-file') });
      await this.loadTransfers();
      this.showStudentTab('inbox');
    } catch (err) {
      this.showToast(err.message || 'Network error sending file', 'error');
    }
  }

  async executeTeacherTransferToStudent() {
    const recipient = document.getElementById('teacher-send-recipient-student').value;
    const file = document.getElementById('teacher-send-file').files[0];
    const mySubject = this.currentUser ? this.currentUser.subjectCode : 'CN';

    if (!file) {
      this.showToast('Please choose a file to send', 'error');
      return;
    }
    if (file.size > 25 * 1024 * 1024) return this.showToast('File size exceeds the 25 MiB limit', 'error');
    if (!recipient) return this.showToast('Please select a student recipient', 'error');

    try {
      const form = new FormData();
      form.append('file', file);
      form.append('type', 'teacher_to_student');
      form.append('recipientId', recipient);
      form.append('subject', mySubject);
      const response = await fetch(`${this.apiBase}/transfers`, { method: 'POST', headers: this.getAuthHeaders(), body: form });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.message || 'Transfer failed');
      this.showToast(`File sent to ${data.transfer.to}`, 'success');
      document.getElementById('teacher-send-file').value = '';
      await this.loadTransfers();
      this.showTeacherTab('notifications');
    } catch (err) {
      this.showToast(err.message || 'Network error sending file', 'error');
    }
  }

  async downloadTransfer(transferId) {
    try {
      const response = await fetch(`${this.apiBase}/transfers/${encodeURIComponent(transferId)}/download`, { headers: this.getAuthHeaders() });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.message || 'Download failed');
      }
      const transfer = this.transfers.find(item => String(item.id) === String(transferId));
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = transfer ? transfer.fileName : 'campuslink-file';
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      this.showToast(err.message || 'Network error downloading file', 'error');
    }
  }

  formatTransferDate(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
  }

  showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    const icons = {
      success: '<i class="fa-solid fa-circle-check" style="color: var(--success);"></i>',
      info: '<i class="fa-solid fa-circle-info" style="color: var(--primary-blue);"></i>',
      error: '<i class="fa-solid fa-circle-exclamation" style="color: var(--danger);"></i>'
    };

    toast.innerHTML = `${icons[type] || ''} <span>${this.escapeHtml(message)}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(100%)';
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.app = new CampusNetApp();
});
