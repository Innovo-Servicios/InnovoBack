const router = require('express').Router();
const clienteRouter = require('./cliente.Router.js');
const direccionRouter = require('./direccion.Router.js');
const lecturaRouter = require('./lectura.Router.js');
const medidorRouter = require('./medidor.Router.js');
const rutaRouter = require('./ruta.Router.js');
const sectorRouter = require('./sector.Router.js');
const trabajadorRouter = require('./trabajador.Router.js');
const asignacion = require('./asignacion.Router.js')
const token =require('./token.Router.js');
const notificaciones = require('./notificaciones.Router.js');
const ate= require('./ate.Router.js');
const novedad = require('./novedad.Router.js');
const tipoNovedad = require('./tipoNovedad.Router.js');
const notivista= require('./notificacion_vista.Router.js')
const uvComentario = require('./uvComentario.Router.js');
const direccionComentario = require('./ComentarioDireccion.Router.js');
const tipoNotificacion = require('./tipoNotificacion.Routes.js');
const documentoRouter = require('./documento.Routes.js');
const tipoDocumentoRouter = require('./tipoDocumento.Routes.js');
const rol= require('./rol.Routes.js');
const permiso= require('./permiso.Routes.js');
const excelRouter = require('./excel.Router.js');
const { requireAuth } = require('../Middleware/auth.middleware.js');

module.exports = app => {
    app.use('/cliente', requireAuth, clienteRouter);
    app.use('/direccion', requireAuth, direccionRouter);
    app.use('/lectura', requireAuth, lecturaRouter);
    app.use('/medidor', requireAuth, medidorRouter);
    app.use('/ruta', requireAuth, rutaRouter);
    app.use('/sector', requireAuth, sectorRouter);
    app.use('/trabajador', trabajadorRouter);
    app.use('/token',token);
    app.use('/asignacion', requireAuth, asignacion);
    app.use('/notificaciones', requireAuth, notificaciones);
    app.use('/middleware', requireAuth, ate);
    app.use('/novedad', requireAuth, novedad);
    app.use('/tipoNovedad', requireAuth, tipoNovedad);
    app.use('/notificacion_vista', requireAuth, notivista);
    app.use('/uvComentario', requireAuth, uvComentario); 
    app.use('/comentarioDireccion', requireAuth, direccionComentario);
    app.use('/tipoNotificacion', requireAuth, tipoNotificacion);
    app.use('/documento', requireAuth, documentoRouter);
    app.use('/tipoDocumento', requireAuth, tipoDocumentoRouter);
    app.use('/rol', requireAuth, rol);
    app.use('/permiso', requireAuth, permiso);
    app.use('/excel', requireAuth, excelRouter);
} 
