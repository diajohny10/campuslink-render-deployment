const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || __dirname;
const DB_PATH = path.join(DATA_DIR, 'campusnet_db.json');

class Database {
  constructor() {
    this.data = {
      students: [],
      resources: [],
      transfers: []
    };

    this.init();
  }

  init() {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    if (fs.existsSync(DB_PATH)) {
      try {
        const raw = fs.readFileSync(DB_PATH, 'utf8');
        this.data = JSON.parse(raw);
      } catch (err) {
        console.error('Error loading database file:', err.message);
        this.save();
      }
    } else {
      this.save();
    }
  }

  save() {
    const tempPath = DB_PATH + '.tmp';
    const content = JSON.stringify(this.data, null, 2);
    fs.writeFileSync(tempPath, content, 'utf8');
    fs.renameSync(tempPath, DB_PATH);
  }

  // --- STUDENTS API ---
  // Return students without passwords for public/roster endpoint
  getStudents() {
    return (this.data.students || []).map(({ password, ...rest }) => rest);
  }

  // Internal find with password for auth
  findStudentByName(name) {
    if (!name) return null;
    return (this.data.students || []).find(s => s.name.toLowerCase() === name.toLowerCase());
  }

  addStudent(student) {
    const backup = [...this.data.students];
    this.data.students.push(student);
    try {
      this.save();
      return student;
    } catch (err) {
      this.data.students = backup;
      throw err;
    }
  }

  clearStudents() {
    const previousStudents = this.data.students;
    this.data.students = [];
    try {
      this.save();
      return previousStudents.length;
    } catch (err) {
      this.data.students = previousStudents;
      throw err;
    }
  }

  // --- RESOURCES API ---
  getResources(subject = null) {
    let list = this.data.resources || [];
    if (subject && subject.toUpperCase() !== 'ALL') {
      list = list.filter(r => r.subject.toUpperCase() === subject.toUpperCase());
    }
    return list;
  }

  getResourceById(id) {
    if (id === undefined || id === null) return null;
    const targetId = String(id);
    return (this.data.resources || []).find(r => String(r.id) === targetId);
  }

  addResource(resource, transfer = null) {
    const backupResources = [...this.data.resources];
    const backupTransfers = [...this.data.transfers];

    this.data.resources.unshift(resource);
    if (transfer) {
      this.data.transfers.unshift(transfer);
    }

    try {
      this.save();
      return resource;
    } catch (err) {
      this.data.resources = backupResources;
      this.data.transfers = backupTransfers;
      throw err;
    }
  }

  deleteResource(id, teacherSubject) {
    const targetId = String(id);
    const resource = (this.data.resources || []).find(r => String(r.id) === targetId);
    if (!resource) {
      throw new Error('Resource not found');
    }
    if (teacherSubject && resource.subject.toUpperCase() !== teacherSubject.toUpperCase()) {
      throw new Error(`Permission Denied: Teacher ${teacherSubject} can only delete files for ${teacherSubject}`);
    }

    const backupResources = [...this.data.resources];
    this.data.resources = this.data.resources.filter(r => String(r.id) !== targetId);

    try {
      this.save();
      return resource;
    } catch (err) {
      this.data.resources = backupResources;
      throw err;
    }
  }

  // --- TRANSFERS API ---
  getTransfers() {
    return this.data.transfers || [];
  }

  getTransferById(id) {
    return (this.data.transfers || []).find(t => String(t.id) === String(id)) || null;
  }

  getUserTransfers(user) {
    if (!user) return [];
    const userId = user.role === 'teacher' ? user.name : user.studentId;
    return (this.data.transfers || []).filter(t => 
      (user.role === 'teacher' && t.type === 'student_to_teacher' && t.to === user.name) ||
      (t.fromId && t.fromId === userId) ||
      (t.toId && t.toId === userId) ||
      (!t.fromId && (t.from === user.name || t.to === user.name))
    );
  }

  addTransfer(transfer) {
    const backupTransfers = [...this.data.transfers];
    this.data.transfers.unshift(transfer);
    try {
      this.save();
      return transfer;
    } catch (err) {
      this.data.transfers = backupTransfers;
      throw err;
    }
  }
}

module.exports = new Database();
