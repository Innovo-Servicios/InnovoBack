const cors = require('cors');
const express = require('express');
const http = require('http'); // Agregado
const { Server } = require('socket.io'); // Agregado
require('dotenv').config();
const db = require('./app/Model/server.js');
const cron = require('node-cron');
const { trabajador_MongooseModel } = require('./app/Model/trabajador_Mongoose.js');
const app = express();
const port = `${process.env.PORT}`;
const { direccion_MongooseModel } = require('./app/Model/direccion_Mongoose.js');
const { ate_MongooseModel } = require('./app/Model/ATE_Mongoose.js');
const { Region } = require('./app/Model/region_Mongoose.js');
const { notificacion_MongooseModel } = require('./app/Model/notificacion_Mongoose.js');
// Crear servidor HTTP
const server = http.createServer(app);
const { execFile } = require('child_process');
const { time } = require('console');
const _ = require('lodash');
const jwt = require("jsonwebtoken");
const path = require('path');
const axios = require('axios');
const helmet = require('helmet');
const {pushNotification,crearNotificacion} = require('./app/Controller/notificaciones.Controller.js');
const moment = require('moment-timezone');
const mongoSanitize = require('express-mongo-sanitize');
const key = process.env.JWT_SECRET;


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
//cron.schedule('*/20 * * * * *', ateatrasada);


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
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(mongoSanitize());

// Conexión a MongoDB
const uri = `mongodb://${process.env.MONGO_USER}:${encodeURIComponent(process.env.MONGO_PASSWORD)}@${process.env.MONGO_HOST}/${process.env.MONGO_DATABASE}`;
let usuariosConectados = {}; // Lista local en memoria

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
app.use('/IMG_ATES', express.static(path.join(__dirname, './IMG_ATES')));
app.use('/IMG_NOVEDADES', express.static(path.join(__dirname, './IMG_NOVEDADES')));
app.use('/IMG_PERFILES', express.static(path.join(__dirname, './IMG_PERFILES')));
app.use('/DOCS_NOTIFICACIONES', express.static(path.join(__dirname, './DOCS_NOTIFICACIONES')));
app.use('/TRABAJADORES', express.static(path.join(__dirname, '../TRABAJADORES')));
// Cargar las rutas
require('./app/Router/main.router')(app);

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
  io.emit('notificacion', notification); // Enviar a todos los clientes
};

// Manejo de eventos de conexión  de WebSocket
io.on('connection', (socket) => {
  console.log(`Cliente conectado: ${socket.id}`);
  // Evento para registrar conexión de un trabajador
  socket.on("registrarTrabajador", async ({ token, ubicacion }) => {
    try {
      const decoded = jwt.verify(token, key); // Decodificar el token
      const rut = decoded.rut; // Extraer el RUT del token
      if (!rut) {
        console.error("❌ No se pudo extraer el RUT del token.");
        return;
      }
      // Buscar el nombre del trabajador en MongoDB
      const trabajador = await trabajador_MongooseModel.findOne({ Rut: String(rut) }).select('Nombre');

      if (!trabajador) {
        console.error(`❌ No se encontró el trabajador con RUT: ${rut}`);
        return;
      }

      usuariosConectados[socket.id] = {
        id_trabajador: rut,
        nombre: trabajador.Nombre, // Guardamos el nombre
        ubicacion,
      };

      // actualizarUV();
      socket.join(String(rut));
      console.log(`✅ Trabajador registrado: ${trabajador.Nombre} (${rut})`);

      // Emitir la actualización a todos los clientes conectados
      io.emit("actualizarUbicacion", {
        id_trabajador: rut,
        nombre: trabajador.Nombre,
        ubicacion,
      });

    } catch (error) {
      console.error("❌ Error al decodificar el token:", error.message);
    }
  });
  socket.on("actualizarUbicacion",
    _.throttle(({ token, ubicacion }) => {
      try {
        console.log(`🔄 Actualizando ubicación para ${usuariosConectados[socket.id]?.nombre || 'desconocido'})`);
        const decoded = jwt.verify(token, key);
        const rut = decoded.rut;
        if (usuariosConectados[socket.id]) {
          usuariosConectados[socket.id].ubicacion = ubicacion;

          console.log(`📍 Ubicación actualizada para ${usuariosConectados[socket.id].nombre} (${rut})`);

          // Emitimos la actualización a TODOS los clientes
          io.emit("actualizarUbicacion", {
            id_trabajador: rut,
            nombre: usuariosConectados[socket.id].nombre,
            ubicacion,
          });
        }
      } catch (error) {
        console.error("❌ Error al decodificar el token en actualización de ubicación:", error.message);
      }
    }, 5000)
  );
  socket.on('estadoBot', () => {
    obtenerEstadoBot((estado) => {
      io.emit('estadoActualizado', estado);
    });
  });
  socket.on('actualizarEstadoBot', (estado) => {
    if (estado) {
      execFile('python3', ['../Asistente/checker.py', '--start'], (error, stdout, stderr) => {
        if (error) {
          console.error(`Error al ejecutar el script: ${error.message}`);
          return;
        }
        const estado = stdout.trim() === 'True';
      });
      setTimeout(() => {
        io.emit('estadoActualizado', estado);
      }, 500);
    }
    else {
      execFile('python3', ['../Asistente/checker.py', '--stop'], (error, stdout, stderr) => {
        if (error) {
          console.error(`Error al ejecutar el script: ${error.message}`);
          return;
        }
        const estado = stdout.trim() === 'True';
        io.emit('estadoActualizado', estado);
      });
    }
  });
  socket.on('actualizarDireccion', async (data) => {
    const { id, lat, lng } = data;
    try {
      try {
        const direccionexistente = await direccion_MongooseModel.findById(id);
        if (!direccionexistente) {
          res.status(404).send('Dirección no encontrada');
          return;
        }
        direccionexistente.LAT = lat;
        direccionexistente.LNG = lng;
        await direccionexistente.save();
        io.emit('direccionActualizada', {
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
        console.error('Error al modificar coordenadas:', error);
      }
    } catch (error) {
      console.error('Error al actualizar la dirección:', error);
    }
  });
  socket.on('nuevaAte', (data) => {
    io.emit('actualizarAte', data);
  });
  socket.on('nuevaNovedad', (data) => {
    io.emit('actualizarNovedad', data);
  });
  socket.on('updateWorker', () =>
    io.emit('updateWorker')
  );
  socket.on("disconnect", async () => {
    const usuario = usuariosConectados[socket.id];

    if (usuario) {
      console.log(`🚪 Trabajador desconectado: ${usuario.nombre} (${usuario.id_trabajador})`);
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

        console.log(`💾 Última ubicación guardada para: ${usuario.nombre} (${usuario.id_trabajador})`);
      } catch (error) {
        console.error(`❌ Error al guardar la última ubicación: ${error.message}`);
      }
      io.emit('trabajadorDesconectado', usuariosConectados[socket.id]);
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
