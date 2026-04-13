const XLSX = require('xlsx');
const path = require('node:path');
const { execFile } = require('node:child_process');
const fs = require('node:fs');

const logHandledError = (context, error) => {
  const errorMessage = error instanceof Error ? error.message : String(error);
  console.error(`${context}: ${errorMessage}`);
};

const processExcelFile = (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No se ha subido ningún archivo' });
    }

    // Leer el archivo Excel
    const safeFilename = path.basename(req.file.filename);
    const filePath = path.join(__dirname, '../../storage/uploads', safeFilename);
    const workbook = XLSX.readFile(filePath);

    // Leer la primera hoja
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];

    // Convertir a JSON
    const data = XLSX.utils.sheet_to_json(sheet);

    res.status(200).json({
      message: 'Archivo procesado correctamente',
      data: data,
    });
  } catch (error) {
    logHandledError('Error al procesar el archivo Excel', error);
    res.status(500).json({ message: 'Error al procesar el archivo' });
  }
};

const excelAsignaciones = (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No se ha subido ningún archivo' });
    }

    const archivo = req.file;
    const filePath = path.join(__dirname, '../../storage/reports/asignaciones');
    if (!fs.existsSync(filePath)) {
      fs.mkdirSync(filePath, { recursive: true });
    }
    const fileName = path.basename(archivo.originalname);
    const finalPath = path.join(filePath, fileName);

    if (fs.existsSync(finalPath)) {
      return res.status(400).json({ message: 'El archivo ya existe' });
    }
    fs.writeFileSync(finalPath, archivo.buffer);

    try {
      XLSX.readFile(finalPath);
    } catch (err) {
      return res.status(400).json({ message: 'Archivo Excel inválido', error: err.message });
    }

    const pythonScriptPath = path.join(__dirname, '../../../Asistente', 'Funciones.py');
    execFile('python3', [pythonScriptPath, 'asignar_sector', finalPath], (error) => {
      if (error) {
        return res.status(500).json({ message: 'Error al procesar el archivo con el script de Python', error: error.message });
      }
    });

    res.status(200).json({
      message: 'Archivo procesado correctamente',
    });
  } catch (error) {
    res.status(500).json({ message: 'Error al procesar el archivo', error: error.message });
  }
};

const excelAte = (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No se ha subido ningún archivo' });
    }

    const archivo = req.file;
    const filePath = path.join(__dirname, '../../storage/reports/ate');
    if (!fs.existsSync(filePath)) {
      fs.mkdirSync(filePath, { recursive: true });
    }
    const fileName = path.basename(archivo.originalname);
    const finalPath = path.join(filePath, fileName);

    if (fs.existsSync(finalPath)) {
      return res.status(400).json({ message: 'El archivo ya existe' });
    }
    fs.writeFileSync(finalPath, archivo.buffer);

    try {
      XLSX.readFile(finalPath);
    } catch (err) {
      return res.status(400).json({ message: 'Archivo Excel inválido', error: err.message });
    }

    const pythonScriptPath = path.join(__dirname, '../../../Asistente', 'Funciones.py');
    execFile('python3', [pythonScriptPath, 'asignar_ate', finalPath], (error) => {
      if (error) {
        return res.status(500).json({ message: 'Error al procesar el archivo con el script de Python', error: error.message });
      }
    });

    res.status(200).json({
      message: 'Archivo procesado correctamente',
    });
  } catch (error) {
    res.status(500).json({ message: 'Error al procesar el archivo', error: error.message });
  }
};

const descarga_ATE = (req, res) => {
  try {
    const { fecha } = req.body;
    const pythonScriptPath = path.join(__dirname, '../../../Asistente', 'Funciones.py');

    execFile('python3', [pythonScriptPath, 'excel_ate', '--fecha_inicio', fecha], (error, stdout, stderr) => {
      if (error) {
        return res.status(500).json({ message: 'Error al procesar el archivo con el script de Python', error: error.message });
      }
      if (stderr) {
        return res.status(500).json({ message: 'Error al procesar el archivo con el script de Python', error: stderr });
      }

      const rawOutput = stdout.trim();

      if (!rawOutput) {
        return res.status(500).json({ message: 'No se generó un archivo válido para descargar' });
      }

      // Construir la ruta desde el directorio permitido usando sólo el nombre base
      // para evitar path traversal o file inclusion desde fuentes externas
      const allowedDir = path.resolve(__dirname, '../../../');
      const safeFilename = path.basename(rawOutput);
      const resolvedPath = path.join(allowedDir, safeFilename);

      res.download(resolvedPath, (err) => {
        if (err) {
          return res.status(500).json({ message: 'Error al descargar el archivo', error: err.message });
        }
      });
    });

  } catch (error) {
    res.status(500).json({ message: 'Error al descargar el archivo', error: error.message });
  }
};

const descargar_novedad = (req, res) => {
  try {
    const { fechainicio, fechafin } = req.body;
    const pythonScriptPath = path.join(__dirname, '../../../Asistente', 'Funciones.py');

    execFile('python3', [pythonScriptPath, 'excel_novedad', '--fecha_inicio', fechainicio, '--fecha_fin', fechafin], (error, stdout, stderr) => {
      if (error) {
        return res.status(500).json({ message: 'Error al procesar el archivo con el script de Python', error: error.message });
      }

      if (stderr) {
        return res.status(500).json({ message: 'Error al ejecutar el script de Python', error: stderr });
      }

      const rawOutput = stdout.trim();

      if (!rawOutput) {
        return res.status(500).json({ message: 'No se generó un archivo válido para descargar' });
      }

      // Construir la ruta desde el directorio permitido usando sólo el nombre base
      // para evitar path traversal o file inclusion desde fuentes externas
      const allowedDir = path.resolve(__dirname, '../../../');
      const safeFilename = path.basename(rawOutput);
      const resolvedPath = path.join(allowedDir, safeFilename);

      res.download(resolvedPath, (err) => {
        if (err) {
          return res.status(500).json({ message: 'Error al descargar el archivo', error: err.message });
        }
      });
    });

  } catch (error) {
    res.status(500).json({ message: 'Error al descargar el archivo', error: error.message });
  }
};


module.exports = { processExcelFile, excelAsignaciones, excelAte, descarga_ATE, descargar_novedad };
