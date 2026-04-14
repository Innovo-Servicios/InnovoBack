const io = require("socket.io-client");
const jwt = require("jsonwebtoken");
const path = require('path');
require('dotenv').config({
  path: path.resolve(__dirname, '../.env')
});
const mongoose = require('mongoose');
const { trabajador_MongooseModel } = require('../src/models/trabajador.model.js');
const key = process.env.JWT_SECRET;

// Conexión a MongoDB (misma que server.js)
const authSource = process.env.MONGO_AUTH_SOURCE ? `?authSource=${encodeURIComponent(process.env.MONGO_AUTH_SOURCE)}` : '';
const uri = `mongodb://${process.env.MONGO_USER}:${encodeURIComponent(process.env.MONGO_PASSWORD)}@${process.env.MONGO_HOST}:${process.env.MONGO_PORT}/${process.env.MONGO_DATABASE}${authSource}`;

// Configuración
const SERVER_URL = process.env.SOCKET_SERVER || "http://localhost:40000";
const NUM_CLIENTS = 10; // Número de dispositivos simulados
const INTERVALO_ENVIO = 2000; // Frecuencia de actualización en ms (2 segundos)
const SIMULACION_DURACION = 120000; // Duración total en ms (2 minutos)

// Función para generar coordenadas aleatorias dentro de un rango
const generarUbicacion = () => {
  const latBase = -33.04116788332225;
  const lngBase = -71.63417458936436;
  const desvio = 0.01; // Margen de variación

  return {
    lat: latBase + (Math.random() * desvio * 2 - desvio),
    lng: lngBase + (Math.random() * desvio * 2 - desvio),
  };
};

// Simulación de tokens de trabajadores
const trabajadores = [
  { rut: "11111111-1", nombre: "Kara Stoltenberg" },
  { rut: "9735449-9", nombre: "LUIS ROBERTO ROBALCABA BRUNA" },
  { rut: "11990783-7", nombre: "GONZALO JAVIER PINO ÁLVAREZ" },
  { rut: "13432441-4", nombre: "PAOLA ANDREA OLIVARES CERECEDA" },
  { rut: "14376073-1", nombre: "EDUARDO GABRIEL MORENO VALENZUELA" },
  { rut: "10663665-6", nombre: "MAURICIO NUMA NARANJO HERRERA" },
  { rut: "10330357-5", nombre: "CARLOS ALFREDO MONDACA ABARCA" },
  { rut: "14541140-8", nombre: "LUIS ALVARO MARIN ARENAS" },
  { rut: "10050737-4", nombre: "JUAN DANIEL LATORRE PACHECO" },
  { rut: "13878405-3", nombre: "RAUL EDUARDO GONZALEZ CARCAMO" },
];

// Simulación de generación de tokens JWT compatibles con validartoken()
const generarToken = (user) => {
  return jwt.sign({
    sub: String(user._id),
    rut: user.Rut,
    cargo: user.cargo || 'trabajador',
    type: 'access',
    sessionVersion: user.sessionVersion || 0
  }, key, { expiresIn: "2h" });
};

async function iniciarSimulacion() {
  console.log("Connectando a la base de datos...");
  await mongoose.connect(uri);
  console.log("✅ Conexión exitosa");

  // Crear clientes simulados
  const clientes = [];

  for (const t of trabajadores.slice(0, NUM_CLIENTS)) {
    const user = await trabajador_MongooseModel.findOne({ Rut: t.rut });
    
    if (!user) {
      console.warn(`⚠️ Trabajador con RUT ${t.rut} no encontrado en la DB. Saltando...`);
      continue;
    }

    const token = generarToken(user);
    const socket = io(SERVER_URL, {
      transports: ["websocket"],
      auth: { token }, // Usar auth en lugar de query es preferible en Socket.io 4+
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 3000,
    });

    let intervaloEnvio;

    socket.on("connect", () => {
      console.log(`✅ Cliente conectado: ${user.Nombre} (${user.Rut})`);

      socket.emit("registrarTrabajador", { ubicacion: generarUbicacion() });

      intervaloEnvio = setInterval(() => {
        const nuevaUbicacion = generarUbicacion();
        console.log(`📡 ${user.Nombre} -> ${JSON.stringify(nuevaUbicacion)}`);
        socket.emit("actualizarUbicacion", { ubicacion: nuevaUbicacion });
      }, INTERVALO_ENVIO);
    });

    socket.on("connect_error", (err) => {
      console.error(`❌ Error de conexión (${user.Nombre}):`, err.message);
    });

    socket.on("disconnect", (reason) => {
      console.log(`❌ Cliente desconectado: ${user.Nombre} (${user.Rut}) - Motivo: ${reason}`);
      clearInterval(intervaloEnvio);
    });

    clientes.push({ socket, intervaloEnvio });
  }

  // Finalizar la simulación después de `SIMULACION_DURACION`
  setTimeout(() => {
    clientes.forEach(({ socket, intervaloEnvio }) => {
      clearInterval(intervaloEnvio);
      socket.disconnect();
    });
    console.log("🛑 Simulación terminada");
    mongoose.connection.close();
    process.exit(0);
  }, SIMULACION_DURACION);
}

iniciarSimulacion().catch(err => {
  console.error("💥 Error fatal en la simulación:", err);
  process.exit(1);
});
