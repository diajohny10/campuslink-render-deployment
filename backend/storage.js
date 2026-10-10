const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, 'uploads');

function ensureUploadsDir() {
  if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  }
}

const ALLOWED_EXTENSIONS = new Set([
  '.pdf', '.doc', '.docx', '.ppt', '.pptx',
  '.xls', '.xlsx', '.txt', '.png', '.jpg', '.jpeg'
]);

const MIME_MAP = {
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.txt': 'text/plain',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg'
};

function getExtension(filename) {
  if (!filename) return '';
  return path.extname(filename).toLowerCase();
}

function isValidExtension(ext) {
  return ALLOWED_EXTENSIONS.has(ext.toLowerCase());
}

function getMimeType(ext) {
  const normalized = ext.toLowerCase();
  return MIME_MAP[normalized] || 'application/octet-stream';
}

function sanitizeFilename(originalName) {
  if (!originalName) return 'unnamed_file';
  let safe = path.basename(originalName)
    .replace(/[\r\n\t\0'"\\]/g, '')
    .replace(/[/]/g, '_')
    .trim();
  return safe || 'unnamed_file';
}

function generateStorageFilename(ext) {
  const uuid = crypto.randomUUID ? crypto.randomUUID() : (Date.now() + '-' + Math.random().toString(36).substring(2, 9));
  return `${uuid}${ext.toLowerCase()}`;
}

function getFilePath(filename) {
  if (!filename) return null;
  const safeBase = path.basename(filename);
  const fullPath = path.resolve(UPLOADS_DIR, safeBase);
  const resolvedDir = path.resolve(UPLOADS_DIR);
  if (!fullPath.startsWith(resolvedDir)) {
    return null;
  }
  return fullPath;
}

function fileExists(filename) {
  const fullPath = getFilePath(filename);
  return fullPath ? fs.existsSync(fullPath) : false;
}

function deleteFile(filename) {
  const fullPath = getFilePath(filename);
  if (fullPath && fs.existsSync(fullPath)) {
    try {
      fs.unlinkSync(fullPath);
      return true;
    } catch (err) {
      console.error(`Failed to delete file ${filename}:`, err.message);
      return false;
    }
  }
  return false;
}

function formatSize(bytes) {
  if (typeof bytes !== 'number' || isNaN(bytes) || bytes < 0) return '0 B';
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const val = parseFloat((bytes / Math.pow(k, i)).toFixed(1));
  return `${val} ${sizes[i]}`;
}

module.exports = {
  UPLOADS_DIR,
  ensureUploadsDir,
  ALLOWED_EXTENSIONS,
  getExtension,
  isValidExtension,
  getMimeType,
  sanitizeFilename,
  generateStorageFilename,
  getFilePath,
  fileExists,
  deleteFile,
  formatSize
};
