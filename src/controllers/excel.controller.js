const XLSX = require('xlsx');
const path = require('node:path');
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);

const logHandledError = (context, error) => {
  const errorMessage = error instanceof Error ? error.message : String(error);
  console.error(`${context}: ${errorMessage}`);
};

const buildReportPath = (directory, originalName) => {
  const safeName = path.parse(path.basename(originalName));
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return path.join(directory, `${safeName.name}-${timestamp}${safeName.ext}`);
};

const parseScriptJson = (stdout = '') => {
  const trimmedOutput = String(stdout || '').trim();
  if (!trimmedOutput) {
    return null;
  }

  try {
    return JSON.parse(trimmedOutput);
  } catch (error) {
    const jsonStart = trimmedOutput.indexOf('{');
    if (jsonStart >= 0) {
      return JSON.parse(trimmedOutput.slice(jsonStart));
    }

    throw error;
  }
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

const excelAsignaciones = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No se ha subido ningún archivo' });
    }

    const archivo = req.file;
    const filePath = path.join(__dirname, '../../storage/reports/asignaciones');
    if (!fs.existsSync(filePath)) {
      fs.mkdirSync(filePath, { recursive: true });
    }
    const finalPath = buildReportPath(filePath, archivo.originalname);
    fs.writeFileSync(finalPath, archivo.buffer);

    try {
      XLSX.readFile(finalPath);
    } catch (err) {
      fs.rmSync(finalPath, { force: true });
      return res.status(400).json({ message: 'Archivo Excel inválido', error: err.message });
    }

    const pythonScriptPath = path.join(__dirname, '../../scripts', 'Funciones.py');
    const { stdout } = await execFileAsync('python3', [pythonScriptPath, 'asignar_sector', finalPath], {
      maxBuffer: 10 * 1024 * 1024,
    });
    const report = parseScriptJson(stdout);

    res.status(200).json(report || {
      message: 'Archivo procesado correctamente',
    });
  } catch (error) {
    let report = null;
    try {
      report = parseScriptJson(error.stdout);
    } catch (parseError) {
      logHandledError('Error al leer la respuesta del script de asignaciones', parseError);
    }

    if (report) {
      return res.status(error.code === 2 ? 400 : 500).json(report);
    }

    res.status(500).json({
      message: 'Error al procesar el archivo',
      error: error.stderr || error.message,
    });
  }
};

const excelAte = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No se ha subido ningún archivo' });
    }

    const archivo = req.file;
    const filePath = path.join(__dirname, '../../storage/reports/ate');
    if (!fs.existsSync(filePath)) {
      fs.mkdirSync(filePath, { recursive: true });
    }
    const finalPath = buildReportPath(filePath, archivo.originalname);
    fs.writeFileSync(finalPath, archivo.buffer);

    try {
      XLSX.readFile(finalPath);
    } catch (err) {
      fs.rmSync(finalPath, { force: true });
      return res.status(400).json({ message: 'Archivo Excel inválido', error: err.message });
    }

    const pythonScriptPath = path.join(__dirname, '../../scripts', 'Funciones.py');
    await execFileAsync('python3', [pythonScriptPath, 'asignar_ate', finalPath]);

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
    const pythonScriptPath = path.join(__dirname, '../../scripts', 'Funciones.py');

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
    const pythonScriptPath = path.join(__dirname, '../../scripts', 'Funciones.py');

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
