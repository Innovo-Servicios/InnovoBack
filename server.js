const cors = require('cors');
const express = require('express');
const http = require('node:http');
const { Server } = require('socket.io'); // Agregado
require('dotenv').config();
const cookieParser = require('cookie-parser');
const db = require('./src/config/db.js');
const cron = require('node-cron');
const { trabajador_MongooseModel } = require('./src/models/trabajador.model.js');
const app = express();
app.set('trust proxy', 1); // Confía en el primer proxy (Nginx/Cloudflare)
const port = `${process.env.PORT}`;
const { direccion_MongooseModel } = require('./src/models/direccion.model.js');
const { Region } = require('./src/models/region.model.js');
// Crear servidor HTTP
const server = http.createServer(app);
const { execFile } = require('node:child_process');
const _ = require('lodash');
const path = require('node:path');
const axios = require('axios');
const helmet = require('helmet');
const {
  dispatchDueScheduledNotifications,
} = require('./src/controllers/notificaciones.controller.js');
const {
  asegurarVerificacionesDelDia,
  asegurarVerificacionesTrabajadorConectado,
} = require('./src/controllers/verificacionTerreno.controller.js');
const mongoSanitize = require('express-mongo-sanitize');
const { validartoken } = require('./src/controllers/token.controller.js');
const { initializeAteWhatsAppClient } = require('./src/utils/whatsappClient.js');
const {
  dispatchAteOverdueNotifications,
} = require('./src/utils/ateOverdueNotifications.js');
const {
  buildLastUbicationUpdate,
  buildTrackingEntry,
} = require('./src/utils/workerTracking.js');

const parseAllowedOrigins = (rawOrigins) =>
  String(rawOrigins || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

const normalizeOrigin = (origin) => {
  if (!origin || typeof origin !== 'string') {
    return null;
  }

  try {
    const url = new URL(origin);
    if ((url.protocol === 'https:' && url.port === '443') || (url.protocol === 'http:' && url.port === '80')) {
      url.port = '';
    }
    return url.origin;
  } catch (error) {
    return origin.trim();
  }
};

const isProduction = process.env.NODE_ENV === 'production';
const defaultAllowedOrigins = [
  'https://provider.blocktype.cl',
  'https://innovoservicios.cl',
  'https://www.innovoservicios.cl',
  isProduction ? null : 'https://localhost:3000',
].filter(Boolean).join(',');

const allowedOrigins = parseAllowedOrigins(
  process.env.ALLOWED_ORIGINS || defaultAllowedOrigins
).map(normalizeOrigin).filter(Boolean);

console.log('CORS Allowed Origins:', allowedOrigins);

const corsOptions = {
  origin(origin, callback) {
    const normalizedOrigin = normalizeOrigin(origin);
    if (!origin || allowedOrigins.includes(normalizedOrigin)) {
      return callback(null, true);
    }

    console.warn(`CORS Rejected Origin: ${origin}`);
    return callback(new Error('Origen no permitido por CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Refresh-Token'],
};

const isPrivilegedRole = (cargo) =>
  ['administracion', 'supervisor'].includes(String(cargo || '').trim().toLowerCase());

const hasCoordinateValue = (value) =>
  value !== null && value !== undefined && value !== '';

const isValidLocation = (location) =>
  location &&
  hasCoordinateValue(location.lat) &&
  hasCoordinateValue(location.lng) &&
  Number.isFinite(Number(location.lat)) &&
  Number.isFinite(Number(location.lng));

const logHandledError = (context, error) => {
  const errorMessage = error instanceof Error ? error.message : String(error);
  console.error(`${context}: ${errorMessage}`);
};

const redactSensitiveData = (data) => {
  if (!data || typeof data !== 'object') {
    return data;
  }

  if (Array.isArray(data)) {
    return data.map(redactSensitiveData);
  }

  return Object.fromEntries(
    Object.entries(data).map(([key, value]) => {
      const normalizedKey = String(key).toLowerCase();
      if (
        normalizedKey.includes('token') ||
        normalizedKey.includes('authorization') ||
        normalizedKey.includes('clave') ||
        normalizedKey.includes('password')
      ) {
        return [key, '[REDACTED]'];
      }

      return [key, redactSensitiveData(value)];
    })
  );
};

const apiDebugLogger = (req, res, next) => {
  if (process.env.API_DEBUG !== 'true') {
    return next();
  }

  const startedAt = Date.now();
  console.log('[API ->]', {
    method: req.method,
    path: req.path,
    ip: req.ip,
    body: redactSensitiveData(req.body),
    query: redactSensitiveData(req.query),
  });

  res.on('finish', () => {
    console.log('[API <-]', {
      method: req.method,
      path: req.path,
      status: res.statusCode,
      durationMs: Date.now() - startedAt,
    });
  });

  return next();
};

const systemctlPath = process.env.SYSTEMCTL_PATH || '/usr/bin/systemctl';
const botStatusScriptPath = process.env.BOT_STATUS_SCRIPT_PATH || '/usr/local/sbin/gpi-gmail-bot-status.sh';
const botSystemdService = process.env.BOT_SYSTEMD_SERVICE || 'gpi-gmail-bot.service';
const botSystemdTimer = process.env.BOT_SYSTEMD_TIMER || 'gpi-gmail-bot.timer';
const botActiveStatuses = new Set(['ok', 'running']);
const restrictedSystemEnv = {
  ...process.env,
  PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/bin',
};
const contentSecurityPolicyDirectives = {
  'default-src': ["'self'"],
  'base-uri': ["'self'"],
  'form-action': ["'self'"],
  'frame-ancestors': ["'self'"],
  'img-src': ["'self'", 'data:', 'blob:'],
  'object-src': ["'none'"],
  'script-src': ["'self'"],
  'script-src-attr': ["'none'"],
  'style-src': ["'self'", 'https:', "'unsafe-inline'"],
  'connect-src': ["'self'", 'ws:', 'wss:', ...allowedOrigins],
};

if (isProduction) {
  contentSecurityPolicyDirectives['upgrade-insecure-requests'] = [];
}

const execFileAsync = (file, args, options = {}) =>
  new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      {
        env: restrictedSystemEnv,
        timeout: 120000,
        maxBuffer: 1024 * 1024,
        ...options,
      },
      (error, stdout, stderr) => {
        if (error) {
          error.stdout = stdout;
          error.stderr = stderr;
          reject(error);
          return;
        }

        resolve({ stdout, stderr });
      }
    );
  });

const actualizarUV = async () => {
  const regiones = await axios.post("https://indiceuv.cl/ws/wsIndiceUVREST.php?id_region=0");
  const regionesData = regiones.data;
  const regionesChile = await Region.find();
  for (const region of regionesChile) {
    const regionData = regionesData.data.find((regionData) => regionData.id_region == region.idnumero);
    if (regionData) {
      region.indiceUV_h = regionData.max_diaria;
      region.indiceUV_m = regionData.max_manana;
      io.emit("actualizarIndiceUV");
      await region.save();
    }
  }
};

// Programar la función para que se ejecute una vez al día
cron.schedule('0 2 * * *', actualizarUV);




// Configurar Socket.IO
const io = new Server(server, {
  cors: corsOptions,
});
app.use(helmet({
  contentSecurityPolicy: {
    directives: contentSecurityPolicyDirectives,
  },
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));
app.use(cookieParser());
app.use(cors(corsOptions));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(apiDebugLogger);
app.use((req, res, next) => {
  ['body', 'params', 'headers', 'query'].forEach((key) => {
    if (req[key]) {
      mongoSanitize.sanitize(req[key]);
    }
  });
  next();
});

// Conexión a MongoDB
const authSource = process.env.MONGO_AUTH_SOURCE
  ? `?authSource=${encodeURIComponent(process.env.MONGO_AUTH_SOURCE)}`
  : '';
const uri = `mongodb://${process.env.MONGO_USER}:${encodeURIComponent(process.env.MONGO_PASSWORD)}@${process.env.MONGO_HOST}:${process.env.MONGO_PORT}/${process.env.MONGO_DATABASE}${authSource}`;
globalThis.usuariosConectados = globalThis.usuariosConectados || {};
const usuariosConectados = globalThis.usuariosConectados; // Lista local en memoria compartida
console.log(uri)
db.mongoose
  .connect(uri)
  .then(() => {
    console.log('Conexión a la base de datos exitosa');
    dispatchDueScheduledNotifications(io).catch((error) => {
      logHandledError('Error al despachar notificaciones programadas al iniciar', error);
    });
    dispatchAteOverdueNotifications({ io }).catch((error) => {
      logHandledError('Error al notificar ATE atrasadas al iniciar', error);
    });
    generarVerificacionesTerrenoDelDia('al iniciar').catch((error) => {
      logHandledError('Error al generar verificaciones en terreno al iniciar', error);
    });
  })
  .catch((error) => {
    console.log('Error al conectar a la base de datos');
    console.log(error);
  });

// Endpoint básico
app.get('/', (req, res) => {
  res.send('Conexión exitosa');
});


// Middleware para integrar Socket.IO con las rutas
app.use((req, res, next) => {
  req.io = io;
  next();
});
// Cargar las rutas
require('./src/routes/main.routes.js')(app);

const obtenerEstadoBot = async () => {
  try {
    const { stdout } = await execFileAsync(botStatusScriptPath, ['write']);
    const status = String(stdout || '').trim().split(/\r?\n/).pop();
    return botActiveStatuses.has(status);
  } catch (error) {
    logHandledError('Error al obtener estado del bot systemd', error);
    return false;
  }
};

const iniciarBotSystemd = async () => {
  try {
    await execFileAsync(systemctlPath, ['daemon-reload']);
    try {
      await execFileAsync(systemctlPath, ['reset-failed', botSystemdService]);
    } catch (error) {
      logHandledError('No se pudo resetear estado fallido del bot systemd', error);
    }
    await execFileAsync(systemctlPath, ['enable', '--now', botSystemdTimer]);
    await execFileAsync(systemctlPath, ['start', botSystemdService]);
  } catch (error) {
    logHandledError('Error al iniciar bot systemd', error);
  }

  return obtenerEstadoBot();
};

const detenerBotSystemd = async () => {
  try {
    await execFileAsync(systemctlPath, ['daemon-reload']);
    await execFileAsync(systemctlPath, ['disable', '--now', botSystemdTimer]);
    await execFileAsync(systemctlPath, ['stop', botSystemdService]);
  } catch (error) {
    logHandledError('Error al detener bot systemd', error);
  }

  return obtenerEstadoBot();
};

const emitirEstadoBot = async () => {
  const estado = await obtenerEstadoBot();
  io.to('role:administracion').to('role:supervisor').emit('estadoActualizado', estado);
  return estado;
};
//
const enviarNotificacion = (titulo, cuerpo, data = {}) => {
  const notification = {
    type: 'notification',
    title: titulo,
    body: cuerpo,
    data,
    timestamp: new Date().toISOString(),
  };
  io.to('role:administracion').to('role:supervisor').emit('notificacion', notification);
};

const generarVerificacionesTerrenoDelDia = async (contexto) => {
  try {
    const result = await asegurarVerificacionesDelDia({ io });
    if (result.created > 0) {
      console.log(
        `[VerificacionTerreno] ${contexto}: ${result.created} creadas para ${result.workers} trabajadores`
      );
    }
  } catch (error) {
    logHandledError(`Error al generar verificaciones en terreno ${contexto}`, error);
  }
};

const persistirUbicacionTrabajador = async (rut, ubicacion, date = new Date()) => {
  const lastUbication = buildLastUbicationUpdate(ubicacion, date);

  if (!lastUbication) {
    return null;
  }

  await trabajador_MongooseModel.findOneAndUpdate(
    { Rut: String(rut) },
    { $set: { lastUbication } }
  );

  return lastUbication;
};

const emitirSeguimientoTrabajador = (eventName, payload) => {
  const trackingPayload = buildTrackingEntry(payload);

  if (!trackingPayload) {
    return;
  }

  io.to('role:administracion').to('role:supervisor').emit(eventName, trackingPayload);
};

io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth?.token;

    if (!token || typeof token !== 'string') {
      return next(new Error('No autorizado'));
    }

    const tokenValido = await validartoken(token);
    if (!tokenValido.valid || !tokenValido.user) {
      return next(new Error('No autorizado'));
    }

    socket.data.user = {
      id: String(tokenValido.user._id),
      rut: tokenValido.user.Rut,
      nombre: tokenValido.user.Nombre,
      cargo: tokenValido.user.cargo,
    };

    return next();
  } catch (error) {
    logHandledError('Error al autenticar el socket', error);
    return next(new Error('No autorizado'));
  }
});

// Manejo de eventos de conexión  de WebSocket
io.on('connection', (socket) => {
  const currentUser = socket.data.user;
  socket.join(`user:${currentUser.id}`);
  socket.join(`worker:${currentUser.rut}`);
  socket.join(`role:${currentUser.cargo}`);

  // Evento para registrar conexión de un trabajador
  socket.on("registrarTrabajador", async ({ ubicacion }) => {
    try {
      const rut = currentUser.rut;
      if (!rut || !isValidLocation(ubicacion)) {
        return;
      }
      const safeRut = String(rut).trim();
      const trabajador = await trabajador_MongooseModel.findOne({ Rut: safeRut }).select('Nombre cargo');

      if (!trabajador) {
        return;
      }

      usuariosConectados[socket.id] = {
        id_trabajador: safeRut,
        nombre: trabajador.Nombre, // Guardamos el nombre
        ubicacion: {
          lat: Number(ubicacion.lat),
          lng: Number(ubicacion.lng),
        },
        ultimaActualizacion: new Date(),
      };

      socket.join(safeRut); // nosonar - false positive for path.join

      await persistirUbicacionTrabajador(
        safeRut,
        usuariosConectados[socket.id].ubicacion,
        usuariosConectados[socket.id].ultimaActualizacion
      );

      emitirSeguimientoTrabajador("actualizarUbicacion", {
        id_trabajador: safeRut,
        nombre: trabajador.Nombre,
        ubicacion: usuariosConectados[socket.id].ubicacion,
        conectado: true,
        ultimaActualizacion: usuariosConectados[socket.id].ultimaActualizacion,
      });

      await asegurarVerificacionesTrabajadorConectado({
        trabajadorId: trabajador._id,
        io,
      });

    } catch (error) {
      logHandledError(`Error al registrar trabajador ${currentUser.rut}`, error);
    }
  });
  socket.on("actualizarUbicacion",
    _.throttle(async ({ ubicacion }) => {
      try {
        if (usuariosConectados[socket.id] && isValidLocation(ubicacion)) {
          const updatedAt = new Date();
          const usuario = usuariosConectados[socket.id];
          usuario.ubicacion = {
            lat: Number(ubicacion.lat),
            lng: Number(ubicacion.lng),
          };
          usuario.ultimaActualizacion = updatedAt;

          await persistirUbicacionTrabajador(usuario.id_trabajador, usuario.ubicacion, updatedAt);

          emitirSeguimientoTrabajador("actualizarUbicacion", {
            id_trabajador: usuario.id_trabajador,
            nombre: usuariosConectados[socket.id].nombre,
            ubicacion: usuario.ubicacion,
            conectado: true,
            ultimaActualizacion: updatedAt,
          });
        }
      } catch (error) {
        logHandledError(`Error al actualizar ubicación del trabajador ${currentUser.rut}`, error);
      }
    }, 5000)
  );
  socket.on('estadoBot', async () => {
    if (!isPrivilegedRole(currentUser.cargo)) {
      return;
    }
    await emitirEstadoBot();
  });
  socket.on('actualizarEstadoBot', async (estado) => {
    if (!isPrivilegedRole(currentUser.cargo)) {
      return;
    }

    const estadoDeseado = Boolean(estado);
    const estadoActualizado = estadoDeseado
      ? await iniciarBotSystemd()
      : await detenerBotSystemd();

    io.to('role:administracion').to('role:supervisor').emit('estadoActualizado', estadoActualizado);
  });
  socket.on('actualizarDireccion', async (data) => {
    if (!isPrivilegedRole(currentUser.cargo)) {
      return;
    }
    const { id, lat, lng } = data;
    try {
      const direccionexistente = await direccion_MongooseModel.findById(id);
      if (!direccionexistente) {
        return;
      }
      direccionexistente.LAT = lat;
      direccionexistente.LNG = lng;
      await direccionexistente.save();
      io.to('role:administracion').to('role:supervisor').emit('direccionActualizada', {
        id,
        lat,
        lng,
      });
      enviarNotificacion(
        'Dirección Actualizada',
        `La dirección con ID ${id} fue actualizada a las nuevas coordenadas.`,
        { id, lat, lng }
      );
    } catch (error) {
      logHandledError(`Error al actualizar la dirección ${id}`, error);
    }
  });
  socket.on('nuevaAte', (data) => {
    if (!isPrivilegedRole(currentUser.cargo)) {
      return;
    }
    io.to('role:administracion').to('role:supervisor').emit('actualizarAte', data);
  });
  socket.on('nuevaNovedad', (data) => {
    if (!isPrivilegedRole(currentUser.cargo)) {
      return;
    }
    io.to('role:administracion').to('role:supervisor').emit('actualizarNovedad', data);
  });
  socket.on('updateWorker', () =>
    io.to('role:administracion').to('role:supervisor').emit('updateWorker')
  );
  socket.on("disconnect", async () => {
    const usuario = usuariosConectados[socket.id];

    if (usuario) {
      try {
        await persistirUbicacionTrabajador(
          usuario.id_trabajador,
          usuario.ubicacion,
          usuario.ultimaActualizacion || new Date()
        );

      } catch (error) {
        logHandledError(`Error al desconectar trabajador ${usuario.id_trabajador}`, error);
      }
      emitirSeguimientoTrabajador('trabajadorDesconectado', {
        id_trabajador: usuario.id_trabajador,
        nombre: usuario.nombre,
        ubicacion: usuario.ubicacion,
        conectado: false,
        ultimaActualizacion: usuario.ultimaActualizacion,
      });
      delete usuariosConectados[socket.id];
    }
  });
});

cron.schedule('* * * * *', async () => {
  try {
    await dispatchDueScheduledNotifications(io);
  } catch (error) {
    logHandledError('Error al despachar notificaciones programadas', error);
  }

  try {
    const now = new Date();
    const trabajadores = await trabajador_MongooseModel.find({ 'rolTemporal.expiracion': { $lt: now } });
    for (const trabajador of trabajadores) {
      trabajador.set('rolTemporal', null);
      await trabajador.save();
    }
  } catch (error) {
    console.log('Error al actualizar roles temporales: ' + error.message);
  }
});

cron.schedule('0 * * * *', () => {
  generarVerificacionesTerrenoDelDia('programadas').catch((error) => {
    logHandledError('Error al generar verificaciones en terreno programadas', error);
  });
}, { timezone: 'America/Santiago' });

cron.schedule('0 8 * * *', () => {
  dispatchAteOverdueNotifications({ io }).catch((error) => {
    logHandledError('Error al notificar ATE atrasadas programadas', error);
  });
}, { timezone: 'America/Santiago' });

// Iniciar servidor HTTP y WebSocket
server.listen(port, '0.0.0.0', () => {
  console.log(`App escuchando en localhost:${port}`);
  initializeAteWhatsAppClient();
});
