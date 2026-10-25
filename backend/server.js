const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Busboy = require('busboy');

const db = require('./db');
const storage = require('./storage');
const auth = require('./auth');

const PORT = process.env.PORT || 5000;
const FRONTEND_DIR = path.resolve(__dirname, '../frontend');
const TEACHER_PASSWORD = process.env.TEACHER_PASSWORD || '';

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

function verifyStudentPassword(password, stored) {
  if (!stored) return false;
  if (!stored.startsWith('scrypt$')) return process.env.NODE_ENV !== 'production' && stored === password;
  const [, salt, expectedHex] = stored.split('$');
  const expected = Buffer.from(expectedHex, 'hex');
  const actual = crypto.scryptSync(password, salt, expected.length);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

if (!TEACHER_PASSWORD) {
  throw new Error('Set TEACHER_PASSWORD before starting in production.');
}

storage.ensureUploadsDir();

// Utility: Send JSON Response with CORS
function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With'
  });
  res.end(JSON.stringify(data));
}

// Utility: Parse JSON Request Body gracefully
function parseJsonBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', chunk => body += chunk.toString());
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        resolve(null);
      }
    });
    req.on('error', () => resolve(null));
  });
}

const server = http.createServer(async (req, res) => {
  // CORS Preflight Handler
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With'
    });
    res.end();
    return;
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;
  const method = req.method;

  try {
    if (pathname === '/health' && method === 'GET') {
      return sendJson(res, 200, { success: true });
    }

    if (method === 'GET' && !pathname.startsWith('/api/')) {
      const requestedPath = decodeURIComponent(pathname === '/' ? '/index.html' : pathname);
      const filePath = path.resolve(FRONTEND_DIR, `.${requestedPath}`);
      if (!filePath.startsWith(FRONTEND_DIR + path.sep)) {
        return sendJson(res, 403, { success: false, message: 'Forbidden' });
      }
      if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
        res.writeHead(200, { 'Content-Type': types[path.extname(filePath).toLowerCase()] || 'application/octet-stream' });
        return fs.createReadStream(filePath).pipe(res);
      }
    }
    // ----------------------------------------------------
    // AUTH ROUTES
    // ----------------------------------------------------
    if (pathname === '/api/auth/teacher-login' && method === 'POST') {
      const body = await parseJsonBody(req);
      if (!body) return sendJson(res, 400, { success: false, message: 'Invalid JSON payload' });

      const { subjectCode, password } = body;

      if (!subjectCode || !auth.isValidSubject(subjectCode)) {
        return sendJson(res, 400, { success: false, message: 'Valid Subject Code is required (CN, DS, DMS, ECON, UHV, COA)' });
      }

      if (password !== TEACHER_PASSWORD) {
        return sendJson(res, 401, { success: false, message: 'Invalid password.' });
      }

      const user = {
        role: 'teacher',
        name: `Teacher ${subjectCode.toUpperCase()}`,
        subjectCode: subjectCode.toUpperCase()
      };

      const session = auth.createSession(user);

      return sendJson(res, 200, {
        success: true,
        message: 'Teacher authenticated successfully',
        token: session.token,
        user: session.user
      });
    }

    if (pathname === '/api/auth/student-login' && method === 'POST') {
      const body = await parseJsonBody(req);
      if (!body) return sendJson(res, 400, { success: false, message: 'Invalid JSON payload' });

      const { name, password } = body;

      if (!name || !password) {
        return sendJson(res, 400, { success: false, message: 'Student Name and Password are required' });
      }

      const student = db.findStudentByName(name);
      if (!student) {
        return sendJson(res, 404, { success: false, message: `Student "${name}" is not registered. Please ask your teacher to register you!` });
      }

      if (!verifyStudentPassword(password, student.password)) {
        return sendJson(res, 401, { success: false, message: 'Incorrect password for registered student.' });
      }

      const user = {
        role: 'student',
        name: student.name,
        studentId: student.id,
        section: student.section
      };

      const session = auth.createSession(user);

      return sendJson(res, 200, {
        success: true,
        message: 'Student authenticated successfully',
        token: session.token,
        user: session.user
      });
    }

    if (pathname === '/api/auth/logout' && method === 'POST') {
      const authHeader = req.headers['authorization'] || req.headers['Authorization'];
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.split(' ')[1];
        auth.destroySession(token);
      }
      return sendJson(res, 200, { success: true, message: 'Logged out successfully' });
    }

    if (pathname === '/api/auth/session' && method === 'GET') {
      const user = auth.authenticateRequest(req);
      if (!user) {
        return sendJson(res, 401, { success: false, message: 'Session expired or invalid' });
      }
      return sendJson(res, 200, { success: true, user });
    }

    // ----------------------------------------------------
    // STUDENT REGISTRATION ROUTES (Teacher-Only)
    // ----------------------------------------------------
    if (pathname === '/api/students' && method === 'GET') {
      const user = auth.authenticateRequest(req);
      if (!user || user.role !== 'teacher') {
        return sendJson(res, 401, { success: false, message: 'Authentication required as teacher' });
      }
      return sendJson(res, 200, { success: true, students: db.getStudents() });
    }

    if (pathname === '/api/students/roster' && method === 'GET') {
      const user = auth.authenticateRequest(req);
      if (!user || user.role !== 'student') {
        return sendJson(res, 401, { success: false, message: 'Authentication required as student' });
      }
      return sendJson(res, 200, {
        success: true,
        students: db.getStudents().filter(student => student.id !== user.studentId)
      });
    }

    if (pathname === '/api/students/register' && method === 'POST') {
      const user = auth.authenticateRequest(req);
      if (!user || user.role !== 'teacher') {
        return sendJson(res, 401, { success: false, message: 'Authentication required as teacher' });
      }

      const body = await parseJsonBody(req);
      if (!body) return sendJson(res, 400, { success: false, message: 'Invalid JSON payload' });

      const { name, studentId, section, password } = body;

      if (!name || !studentId || !password) {
        return sendJson(res, 400, { success: false, message: 'Student Name, ID, and password are required' });
      }

      const existing = db.getStudents().find(s => s.id.toLowerCase() === studentId.toLowerCase());
      if (existing) {
        return sendJson(res, 409, { success: false, message: `Student ID "${studentId}" is already registered!` });
      }

      const newStudent = db.addStudent({
        id: studentId,
        name: name,
        section: section || 'CS Sec A',
        password: hashPassword(password)
      });

      db.addTransfer({
        id: Date.now(),
        from: `Teacher ${user.subjectCode}`,
        to: name,
        type: 'student_registered',
        subject: user.subjectCode,
        fileName: `ID: ${studentId}`,
        date: new Date().toLocaleTimeString(),
        timestamp: new Date().toLocaleString()
      });

      return sendJson(res, 201, { success: true, message: 'Student registered successfully', student: newStudent });
    }

    // ----------------------------------------------------
    // SUBJECT RESOURCES ROUTES
    // ----------------------------------------------------
    if (pathname === '/api/resources' && method === 'GET') {
      const user = auth.authenticateRequest(req);
      if (!user) {
        return sendJson(res, 401, { success: false, message: 'Authentication required' });
      }

      const subject = parsedUrl.searchParams.get('subject');
      const resources = db.getResources(subject).map(r => ({
        ...r,
        missingOnDisk: !storage.fileExists(r.filename)
      }));

      return sendJson(res, 200, { success: true, resources });
    }

    // MULTIPART RESOURCE UPLOAD (Teacher-Only)
    if (pathname === '/api/resources/upload' && method === 'POST') {
      const user = auth.authenticateRequest(req);
      if (!user || user.role !== 'teacher') {
        return sendJson(res, 401, { success: false, message: 'Authentication required as teacher' });
      }

      const contentType = req.headers['content-type'] || '';
      if (!contentType.includes('multipart/form-data')) {
        return sendJson(res, 400, { success: false, message: 'Content-Type must be multipart/form-data' });
      }

      let busboy;
      try {
        busboy = Busboy({
          headers: req.headers,
          limits: {
            fileSize: 25 * 1024 * 1024, // 25 MiB
            files: 1,
            fields: 10
          }
        });
      } catch (err) {
        return sendJson(res, 400, { success: false, message: 'Malformed multipart headers: ' + err.message });
      }

      const fields = {};
      let fileProcessed = false;
      let fileTruncated = false;
      let uploadError = null;
      let writeStream = null;
      let tempFilename = null;
      let tempFilePath = null;
      let originalFilename = '';
      let fileExtension = '';
      let bytesWritten = 0;

      busboy.on('field', (fieldname, val) => {
        fields[fieldname] = val;
      });

      busboy.on('file', (fieldname, fileStream, info) => {
        if (fileProcessed) {
          uploadError = new Error('Only one file upload allowed per request');
          fileStream.resume();
          return;
        }

        fileProcessed = true;
        originalFilename = info.filename;
        fileExtension = storage.getExtension(originalFilename);

        if (!storage.isValidExtension(fileExtension)) {
          uploadError = new Error(`File type "${fileExtension}" is not allowed. Supported formats: PDF, DOC, DOCX, PPT, PPTX, XLS, XLSX, TXT, PNG, JPG, JPEG`);
          fileStream.resume();
          return;
        }

        tempFilename = storage.generateStorageFilename(fileExtension);
        tempFilePath = storage.getFilePath(tempFilename);

        if (!tempFilePath) {
          uploadError = new Error('Invalid storage path');
          fileStream.resume();
          return;
        }

        writeStream = fs.createWriteStream(tempFilePath);

        fileStream.on('data', (chunk) => {
          bytesWritten += chunk.length;
        });

        fileStream.on('limit', () => {
          fileTruncated = true;
          uploadError = new Error('File size exceeds maximum limit of 25 MiB');
        });

        writeStream.on('error', (err) => {
          uploadError = err;
        });

        fileStream.pipe(writeStream);
      });

      busboy.on('finish', async () => {
        if (uploadError || fileTruncated || !fileProcessed) {
          if (tempFilename) storage.deleteFile(tempFilename);
          const msg = uploadError ? uploadError.message : (!fileProcessed ? 'No file attached in upload request' : 'Upload failed');
          return sendJson(res, 400, { success: false, message: msg });
        }

        const subjectVal = (fields.subject || user.subjectCode || '').toUpperCase();
        const displayTitle = (fields.title && fields.title.trim()) ? fields.title.trim() : storage.sanitizeFilename(originalFilename);

        // Subject validation and authorization
        if (!auth.isValidSubject(subjectVal)) {
          if (tempFilename) storage.deleteFile(tempFilename);
          return sendJson(res, 400, { success: false, message: 'Invalid subject code' });
        }

        if (subjectVal !== user.subjectCode.toUpperCase()) {
          if (tempFilename) storage.deleteFile(tempFilename);
          return sendJson(res, 403, { success: false, message: `Permission Denied: Teacher ${user.subjectCode} can only upload resources for ${user.subjectCode}` });
        }

        if (bytesWritten === 0) {
          if (tempFilename) storage.deleteFile(tempFilename);
          return sendJson(res, 400, { success: false, message: 'Uploaded file is empty (0 bytes)' });
        }

        const fileId = crypto.randomUUID ? crypto.randomUUID() : (Date.now() + '-' + Math.random().toString(36).substring(2, 9));
        const mimeType = storage.getMimeType(fileExtension);
        const formattedSize = storage.formatSize(bytesWritten);

        const newResource = {
          id: fileId,
          name: displayTitle,
          subject: subjectVal,
          originalName: storage.sanitizeFilename(originalFilename),
          filename: tempFilename,
          mimeType: mimeType,
          sizeBytes: bytesWritten,
          size: formattedSize,
          uploadedBy: `Teacher ${subjectVal}`,
          uploadedAt: new Date().toISOString(),
          date: new Date().toISOString().split('T')[0],
          storageProvider: 'local'
        };

        const auditTransfer = {
          id: Date.now() + 1,
          from: `Teacher ${subjectVal}`,
          to: `All Students (${subjectVal})`,
          type: 'upload_by_teacher',
          subject: subjectVal,
          fileName: displayTitle,
          date: new Date().toLocaleTimeString(),
          timestamp: new Date().toLocaleString()
        };

        try {
          db.addResource(newResource, auditTransfer);
          return sendJson(res, 201, {
            success: true,
            message: 'Resource uploaded successfully',
            resource: newResource
          });
        } catch (err) {
          if (tempFilename) storage.deleteFile(tempFilename);
          return sendJson(res, 500, { success: false, message: 'Failed to save resource metadata: ' + err.message });
        }
      });

      req.on('error', (err) => {
        if (tempFilename) storage.deleteFile(tempFilename);
        sendJson(res, 500, { success: false, message: 'Upload stream error: ' + err.message });
      });

      req.pipe(busboy);
      return;
    }

    // AUTHENTICATED DOWNLOAD ROUTE (`GET /api/resources/:id/download`)
    if (pathname.startsWith('/api/resources/') && pathname.endsWith('/download') && method === 'GET') {
      const user = auth.authenticateRequest(req);
      if (!user) {
        return sendJson(res, 401, { success: false, message: 'Authentication required' });
      }

      const parts = pathname.split('/');
      // /api/resources/:id/download -> parts[3] is :id
      const resourceId = parts[3];

      const resource = db.getResourceById(resourceId);
      if (!resource) {
        return sendJson(res, 404, { success: false, message: 'Resource metadata not found' });
      }

      const filePath = storage.getFilePath(resource.filename);
      if (!filePath || !fs.existsSync(filePath)) {
        return sendJson(res, 404, { success: false, message: 'Physical file missing on server storage' });
      }

      const safeDownloadName = encodeURIComponent(resource.originalName || resource.name);

      res.writeHead(200, {
        'Content-Type': resource.mimeType || 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${safeDownloadName}"; filename*=UTF-8''${safeDownloadName}`,
        'X-Content-Type-Options': 'nosniff',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With'
      });

      const readStream = fs.createReadStream(filePath);
      readStream.on('error', (streamErr) => {
        console.error('Download stream error:', streamErr);
        if (!res.headersSent) {
          sendJson(res, 500, { success: false, message: 'Error streaming file content' });
        }
      });
      readStream.pipe(res);
      return;
    }

    // RESOURCE DELETE ROUTE (`DELETE /api/resources/:id`)
    if (pathname.startsWith('/api/resources/') && method === 'DELETE') {
      const user = auth.authenticateRequest(req);
      if (!user || user.role !== 'teacher') {
        return sendJson(res, 401, { success: false, message: 'Authentication required as teacher' });
      }

      const resourceId = pathname.split('/')[3];
      const resource = db.getResourceById(resourceId);

      if (!resource) {
        return sendJson(res, 404, { success: false, message: 'Resource not found' });
      }

      if (resource.subject.toUpperCase() !== user.subjectCode.toUpperCase()) {
        return sendJson(res, 403, { success: false, message: `Permission Denied: Teacher ${user.subjectCode} can only delete files for ${user.subjectCode}` });
      }

      try {
        const deletedResource = db.deleteResource(resourceId, user.subjectCode);
        storage.deleteFile(deletedResource.filename);
        return sendJson(res, 200, { success: true, message: 'Resource and file deleted successfully', resource: deletedResource });
      } catch (err) {
        return sendJson(res, 500, { success: false, message: err.message });
      }
    }

    // ----------------------------------------------------
    // TRANSFERS & NOTIFICATIONS ROUTES
    // ----------------------------------------------------
    if (pathname.startsWith('/api/transfers/') && pathname.endsWith('/download') && method === 'GET') {
      const user = auth.authenticateRequest(req);
      if (!user) return sendJson(res, 401, { success: false, message: 'Authentication required' });
      const transferId = pathname.split('/')[3];
      const transfer = db.getTransferById(transferId);
      const userId = user.role === 'teacher' ? user.name : user.studentId;
      if (!transfer || (transfer.fromId !== userId && transfer.toId !== userId)) {
        return sendJson(res, 404, { success: false, message: 'Transfer not found' });
      }
      const filePath = storage.getFilePath(transfer.filename);
      if (!filePath || !fs.existsSync(filePath)) {
        return sendJson(res, 404, { success: false, message: 'Transferred file is no longer available' });
      }
      const downloadName = encodeURIComponent(storage.sanitizeFilename(transfer.fileName));
      res.writeHead(200, {
        'Content-Type': transfer.mimeType || 'application/octet-stream',
        'Content-Disposition': `attachment; filename*=UTF-8''${downloadName}`,
        'X-Content-Type-Options': 'nosniff',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With'
      });
      const stream = fs.createReadStream(filePath);
      stream.on('error', err => {
        console.error('Transfer download stream error:', err);
        if (!res.headersSent) sendJson(res, 500, { success: false, message: 'Error streaming transferred file' });
      });
      stream.pipe(res);
      return;
    }

    if (pathname === '/api/transfers' && method === 'GET') {
      const user = auth.authenticateRequest(req);
      if (!user) {
        return sendJson(res, 401, { success: false, message: 'Authentication required' });
      }
      return sendJson(res, 200, { success: true, transfers: db.getUserTransfers(user) });
    }

    if (pathname === '/api/transfers/my-transfers' && method === 'GET') {
      const user = auth.authenticateRequest(req);
      if (!user) {
        return sendJson(res, 401, { success: false, message: 'Authentication required' });
      }
      return sendJson(res, 200, { success: true, transfers: db.getUserTransfers(user) });
    }

    if (pathname === '/api/transfers' && method === 'POST') {
      const user = auth.authenticateRequest(req);
      if (!user) {
        return sendJson(res, 401, { success: false, message: 'Authentication required' });
      }

      if (user.role !== 'student' && user.role !== 'teacher') {
        return sendJson(res, 403, { success: false, message: 'Only students and teachers can transfer files' });
      }
      const contentType = req.headers['content-type'] || '';
      if (!contentType.includes('multipart/form-data')) {
        return sendJson(res, 400, { success: false, message: 'Attach a file using multipart/form-data' });
      }

      let busboy;
      try {
        busboy = Busboy({ headers: req.headers, limits: { fileSize: 25 * 1024 * 1024, files: 1, fields: 4 } });
      } catch (err) {
        return sendJson(res, 400, { success: false, message: 'Malformed multipart request' });
      }

      const fields = {};
      let tempFilename = null;
      let fileName = '';
      let fileExtension = '';
      let bytesWritten = 0;
      let fileProcessed = false;
      let fileTruncated = false;
      let uploadError = null;
      let writeStream = null;

      busboy.on('field', (name, value) => { fields[name] = value; });
      busboy.on('file', (fieldname, fileStream, info) => {
        if (fieldname !== 'file' || fileProcessed) {
          uploadError = new Error('Attach one file using the file field');
          fileStream.resume();
          return;
        }
        fileProcessed = true;
        fileName = storage.sanitizeFilename(info.filename);
        fileExtension = storage.getExtension(fileName);
        if (!storage.isValidExtension(fileExtension)) {
          uploadError = new Error('File type is not supported');
          fileStream.resume();
          return;
        }
        tempFilename = storage.generateStorageFilename(fileExtension);
        const filePath = storage.getFilePath(tempFilename);
        if (!filePath) {
          uploadError = new Error('Invalid storage path');
          fileStream.resume();
          return;
        }
        writeStream = fs.createWriteStream(filePath);
        fileStream.on('data', chunk => { bytesWritten += chunk.length; });
        fileStream.on('limit', () => {
          fileTruncated = true;
          uploadError = new Error('File size exceeds maximum limit of 25 MiB');
        });
        writeStream.on('error', err => { uploadError = err; });
        fileStream.pipe(writeStream);
      });

      busboy.on('finish', () => {
        const cleanup = () => { if (tempFilename) storage.deleteFile(tempFilename); };
        const fail = (status, message) => {
          cleanup();
          sendJson(res, status, { success: false, message });
        };
        const finish = async () => {
          if (writeStream && !writeStream.closed) await new Promise(resolve => writeStream.once('close', resolve));
          if (uploadError || fileTruncated || !fileProcessed || bytesWritten === 0) {
            return fail(400, uploadError?.message || (!fileProcessed ? 'No file attached' : 'Uploaded file is empty'));
          }

          const type = fields.type;
          const recipientId = fields.recipientId;
          const subject = (fields.subject || '').toUpperCase();
          let recipient;
          let toId;

          if (user.role === 'student' && type === 'student_to_student') {
            recipient = db.getStudents().find(student => student.id === recipientId);
            if (!recipient || recipient.id === user.studentId) return fail(400, 'Choose another registered student');
            toId = recipient.id;
          } else if (user.role === 'student' && type === 'student_to_teacher') {
            if (!auth.isValidSubject(subject)) return fail(400, 'Choose a valid subject teacher');
            recipient = { name: `Teacher ${subject}` };
            toId = recipient.name;
          } else if (user.role === 'teacher' && type === 'teacher_to_student') {
            recipient = db.getStudents().find(student => student.id === recipientId);
            if (!recipient) return fail(400, 'Choose a registered student');
            toId = recipient.id;
          } else {
            return fail(403, 'This transfer type is not allowed for your account');
          }

          const now = new Date().toISOString();
          const transfer = {
            id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
            from: user.name,
            fromId: user.role === 'teacher' ? user.name : user.studentId,
            to: recipient.name,
            toId,
            type,
            subject: subject || (user.role === 'teacher' ? user.subjectCode : null),
            fileName,
            filename: tempFilename,
            mimeType: storage.getMimeType(fileExtension),
            sizeBytes: bytesWritten,
            size: storage.formatSize(bytesWritten),
            date: now,
            timestamp: now
          };

          try {
            db.addTransfer(transfer);
            return sendJson(res, 201, { success: true, message: 'File transferred successfully', transfer });
          } catch (err) {
            return fail(500, 'Failed to save transfer');
          }
        };
        finish().catch(err => fail(500, 'Failed to process transfer'));
      });

      req.on('error', () => {
        if (tempFilename) storage.deleteFile(tempFilename);
        if (!res.headersSent) sendJson(res, 500, { success: false, message: 'Transfer stream failed' });
      });
      req.pipe(busboy);
      return;
    }

    // Default 404 for unknown endpoints
    sendJson(res, 404, { success: false, message: 'API Endpoint Not Found' });

  } catch (error) {
    console.error('Server error:', error);
    sendJson(res, 500, { success: false, message: 'Internal Server Error', error: error.message });
  }
});

server.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`🚀 CampusLink REST API Server running on port ${PORT}`);
  console.log(`👉 http://localhost:${PORT}`);
  console.log(`📁 Uploads Directory: ${storage.UPLOADS_DIR}`);
  console.log(`====================================================`);
});
