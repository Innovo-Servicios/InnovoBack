const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('node:crypto');

// Crear carpeta "uploads" si no existe
const uploadPath = path.join(__dirname, '../../storage/uploads');
if (!fs.existsSync(uploadPath)) {
  fs.mkdirSync(uploadPath, { recursive: true });
}

const allowedExtensions = new Set(['.xlsx', '.xls', '.jpeg', '.jpg', '.png', '.pdf', '.doc', '.docx']);
const allowedMimeTypes = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'image/jpeg',
  'image/png',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

const sanitizeUploadedFileName = (originalName) => {
  const parsedName = path.parse(path.basename(String(originalName || 'archivo')));
  const safeBaseName = parsedName.name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .slice(0, 80) || 'archivo';
  const extension = parsedName.ext.toLowerCase();
  return `${Date.now()}-${crypto.randomUUID()}-${safeBaseName}${extension}`;
};

const isAllowedUpload = (file) => {
  const extName = path.extname(file.originalname).toLowerCase();
  return allowedExtensions.has(extName) && allowedMimeTypes.has(file.mimetype);
};

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadPath); // Carpeta donde se guardarán los archivos
  },
  filename: (req, file, cb) => {
    cb(null, sanitizeUploadedFileName(file.originalname)); // Nombre único y seguro
  },
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024,
  },
  fileFilter: (req, file, cb) => {
    if (isAllowedUpload(file)) {
      cb(null, true); // Archivo permitido
    } else {
      cb(new Error('Formato de archivo no permitido. Solo se permiten Excel, imágenes, PDF y documentos de texto.'));
    }
  },
});
// Nueva configuración (memoryStorage) para manejar archivos en memoria
const memoryStorage = multer.memoryStorage();
const uploadMemory = multer({
  storage: memoryStorage, // Almacena archivos en memoria
  limits: {
    fileSize: 10 * 1024 * 1024,
  },
  fileFilter: (req, file, cb) => {
    if (isAllowedUpload(file)) {
      cb(null, true); // Archivo permitido
    } else {
      cb(new Error('Formato de archivo no permitido.'));
    }
  },
});
module.exports = { upload, uploadMemory, sanitizeUploadedFileName };
