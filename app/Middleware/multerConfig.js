const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Crear carpeta "uploads" si no existe
const uploadPath = path.join(__dirname, '../../uploads');
if (!fs.existsSync(uploadPath)) {
  fs.mkdirSync(uploadPath, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadPath); // Carpeta donde se guardarán los archivos
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`); // Nombre único para cada archivo
  },
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024,
  },
  fileFilter: (req, file, cb) => {
    // Tipos permitidos
    const excelTypes = /xlsx|xls/; // Archivos Excel
    const imageTypes = /jpeg|jpg|png/; // Imágenes
    const pdfTypes = /pdf/; // PDF
    const docTypes = /msword|vnd.openxmlformats-officedocument.wordprocessingml.document/; // Documentos de texto

    // Validar la extensión del archivo
    const extName = path.extname(file.originalname).toLowerCase();
    const isExcel = excelTypes.test(extName);
    const isImage = imageTypes.test(extName);
    const isPDF = pdfTypes.test(extName);
    const isDoc = docTypes.test(extName);

    if (isExcel || isImage || isPDF || isDoc) {
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
    const formatosPermitidos = /jpeg|jpg|png|pdf|msword|docx|xlsx|xls/; // Tipos permitidos
    const extName = path.extname(file.originalname).toLowerCase();
    if (formatosPermitidos.test(extName)) {
      cb(null, true); // Archivo permitido
    } else {
      cb(new Error('Formato de archivo no permitido.'));
    }
  },
});
module.exports = { upload, uploadMemory };
