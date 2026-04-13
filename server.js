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
const port = `${process.env.PORT}`;
const { direccion_MongooseModel } = require('./src/models/direccion.model.js');
const { ate_MongooseModel } = require('./src/models/ATE.model.js');
const { Region } = require('./src/models/region.model.js');
const { notificacion_MongooseModel } = require('./src/models/notificacion.model.js');
// Crear servidor HTTP
const server = http.createServer(app);
const { execFile } = require('node:child_process');
const _ = require('lodash');
const path = require('node:path');
const axios = require('axios');
const helmet = require('helmet');
const {pushNotification,crearNotificacion} = require('./src/controllers/notificaciones.controller.js');
const moment = require('moment-timezone');
const mongoSanitize = require('express-mongo-sanitize');
const { validartoken } = require('./src/controllers/token.controller.js');

const parseAllowedOrigins = (rawOrigins) =>
  String(rawOrigins || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

const allowedOrigins = parseAllowedOrigins(
  process.env.ALLOWED_ORIGINS || 'http://localhost:3000,https://provider.blocktype.cl'
);

const corsOptions = {
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    return callback(new Error('Origen no permitido por CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
};

const isPrivilegedRole = (cargo) =>
  ['administracion', 'supervisor'].includes(String(cargo || '').trim().toLowerCase());

const isValidLocation = (location) =>
  location &&
  Number.isFinite(Number(location.lat)) &&
  Number.isFinite(Number(location.lng));

const logHandledError = (context, error) => {
  const errorMessage = error instanceof Error ? error.message : String(error);
  console.error(`${context}: ${errorMessage}`);
};


const ateatrasada = async () => {
  const trabajadores = await trabajador_MongooseModel.find();
  for (const trabajador of trabajadores) {
    let ates = await ate_MongooseModel.find({
      Trabajador: trabajador._id,
      estado: false,
      fecha_ate: { $lt: new Date() }
    });

    if (ates.length > 0) {
      for (const ate of ates) {
        let tiempo = moment().diff(moment(ate.fecha_ate), 'hours');
        let msg = `Tienes una atención especial pendiente por más de ${tiempo} horas`;
        await pushNotification({
          userId: trabajador._id,
          titulo: 'Atención Especial Pendiente',
          mensaje: msg,
          data: { contenidos: '', idNotificacion: '', tipo: 'alert', fecha: moment().tz('America/Santiago'), url:null },
        }).then((res) => {
          console.log(res);
          return res;
        }).catch((err) => {
          return err;
        });
      }
    }
  }
}
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
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));
app.use(cookieParser());
app.use(cors(corsOptions));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(mongoSanitize());

// Conexión a MongoDB
const authSource = process.env.MONGO_AUTH_SOURCE
  ? `?authSource=${encodeURIComponent(process.env.MONGO_AUTH_SOURCE)}`
  : '';
const uri = `mongodb://${process.env.MONGO_USER}:${encodeURIComponent(process.env.MONGO_PASSWORD)}@${process.env.MONGO_HOST}:${process.env.MONGO_PORT}/${process.env.MONGO_DATABASE}${authSource}`;
globalThis.usuariosConectados = globalThis.usuariosConectados || {};
const usuariosConectados = globalThis.usuariosConectados; // Lista local en memoria compartida

db.mongoose
  .connect(uri)
  .then(() => {
    console.log('Conexión a la base de datos exitosa');
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
app.use('/IMG_ATES', express.static(path.join(__dirname, './public/images/ates')));
app.use('/IMG_NOVEDADES', express.static(path.join(__dirname, './public/images/novedades')));
app.use('/IMG_PERFILES', express.static(path.join(__dirname, './public/images/perfiles')));
app.use('/IMG_VERIFICACIONES', express.static(path.join(__dirname, './public/images/verificaciones')));
// Cargar las rutas
require('./src/routes/main.routes.js')(app);

const obtenerEstadoBot = (callback) => {
  execFile('python3', ['../Asistente/checker.py', '--status'], (error, stdout, stderr) => {
    if (error) {
      console.error(`Error al ejecutar el script: ${error.message}`);
      callback(false); // Asume estado falso en caso de error
      return;
    }
    const estado = stdout.trim() === 'True';
    callback(estado);
  });
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

io.use(async (socket, next) => {
  try {
    const token =
      socket.handshake.auth?.token ||
      socket.handshake.query?.token;

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
      token,
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
        ubicacion,
      };

      socket.join(safeRut); // nosonar - false positive for path.join

      io.to('role:administracion').to('role:supervisor').emit("actualizarUbicacion", {
        id_trabajador: rut,
        nombre: trabajador.Nombre,
        ubicacion,
      });

    } catch (error) {
      logHandledError(`Error al registrar trabajador ${currentUser.rut}`, error);
    }
  });
  socket.on("actualizarUbicacion",
    _.throttle(({ ubicacion }) => {
      try {
        const rut = currentUser.rut;
        if (usuariosConectados[socket.id] && isValidLocation(ubicacion)) {
          usuariosConectados[socket.id].ubicacion = ubicacion;
          io.to('role:administracion').to('role:supervisor').emit("actualizarUbicacion", {
            id_trabajador: rut,
            nombre: usuariosConectados[socket.id].nombre,
            ubicacion,
          });
        }
      } catch (error) {
        logHandledError(`Error al actualizar ubicación del trabajador ${currentUser.rut}`, error);
      }
    }, 5000)
  );
  socket.on('estadoBot', () => {
    if (!isPrivilegedRole(currentUser.cargo)) {
      return;
    }
    obtenerEstadoBot((estado) => {
      io.to('role:administracion').to('role:supervisor').emit('estadoActualizado', estado);
    });
  });
  socket.on('actualizarEstadoBot', (estado) => {
    if (!isPrivilegedRole(currentUser.cargo)) {
      return;
    }
    if (estado) {
      execFile('python3', ['../Asistente/checker.py', '--start'], (error) => {
        if (error) {
          console.error(`Error al ejecutar el script: ${error.message}`);
        }
      });
      setTimeout(() => {
        io.to('role:administracion').to('role:supervisor').emit('estadoActualizado', estado);
      }, 500);
    }
    else {
      execFile('python3', ['../Asistente/checker.py', '--stop'], (error, stdout, stderr) => {
        if (error) {
          console.error(`Error al ejecutar el script: ${error.message}`);
          return;
        }
        const estado = stdout.trim() === 'True';
        io.to('role:administracion').to('role:supervisor').emit('estadoActualizado', estado);
      });
    }
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
        await trabajador_MongooseModel.findOneAndUpdate(
          { Rut: String(usuario.id_trabajador) },
          {
            lastUbication: {
              ...usuario.ubicacion,
              date: new Date(),
            },
          }
        );

      } catch (error) {
        logHandledError(`Error al desconectar trabajador ${usuario.id_trabajador}`, error);
      }
      io.to('role:administracion').to('role:supervisor').emit('trabajadorDesconectado', usuariosConectados[socket.id]);
      delete usuariosConectados[socket.id];
    }
  });
});

cron.schedule('* * * * *', async () => {
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

// Iniciar servidor HTTP y WebSocket
server.listen(port, '0.0.0.0', () => {
  console.log(`App escuchando en localhost:${port}`);
});
