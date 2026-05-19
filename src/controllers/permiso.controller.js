const mongoose = require('mongoose');
const Token = require('../controllers/token.controller.js')
const {Permiso} = require('../models/permiso.model.js');

const obtenerPermisos = async (req, res) => {
    const {token} = req.body;
    const tokenValido = await Token.validartoken(token);
    if (tokenValido.valid){
        try{
            const permisos = await Permiso.find();
            res.send(permisos);
        }catch (error) {
            res.status(500).send('Error interno del servidor');
        }
    }
}

const crearPermiso = async (req, res) => {
    const {token} = req.body;
    const tokenValido = await Token.validartoken(token);
    if (tokenValido.valid){
        const {nombre, descripcion} = req.body;
        try{
            const nuevoPermiso = new Permiso({
                nombre,
                descripcion
            });
            await nuevoPermiso.save();
            res.send('Permiso creado con éxito');
        }catch (error) {
            res.status(500).send('Error interno del servidor');
        }
    }
}

const eliminarPermiso = async (req, res) => {
    const {token} = req.body;
    const tokenValido = await Token.validartoken(token);
    if (tokenValido.valid){
        const {id} = req.body;
        try{
            await
            Permiso.findByIdAndDelete(String(id));
            res.send('Permiso eliminado con éxito');
        }
        catch (error) {
            res.status(500).send('Error interno del servidor');
        }
    }
}

module.exports = {obtenerPermisos, crearPermiso, eliminarPermiso};