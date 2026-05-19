const mongoose = require('mongoose');
const Token = require('../controllers/token.controller.js')
const {Permiso} = require('../models/permiso.model.js');
const {Rol} = require('../models/rol.model.js');
const {trabajador_MongooseModel} = require('../models/trabajador.model.js');

const obtenerRoles = async (req, res) => {
    const {token} = req.body;
    const tokenValido = await Token.validartoken(token);
    if (tokenValido.valid){
        try{
            const roles = await Promise.all(
                x = Rol.find().map(async rol => {
                    const permisos = await Promise.all(
                        rol.permisos.map(async permiso => {
                            return await Permiso.findById(permiso);
                        })
                    );
                    return {
                        nombre: rol.nombre,
                        permisos
                    }
                }
                )
            );
            res.send(roles);
        }catch (error) {
            res.status(500).send('Error interno del servidor');
        }
    }
}

const crearRol = async (req, res) => {
    const {token} = req.body;
    const tokenValido = await Token.validartoken(token);
    if (tokenValido.valid){
        const {nombre, permisos} = req.body;
        try{
            const nuevoRol = new Rol({
                nombre,
                permisos
            });
            await nuevoRol.save();
            res.send('Rol creado con éxito');
        }catch (error) {
            res.status(500).send('Error interno del servidor');
        }
    }
}

const rolesTemporales = async (req, res) => {
    const {token} = req.body;
    const tokenValido = await Token.validartoken(token);
    if (tokenValido.valid){
        const {objetivo,horas,rol}=req.body;
        const expires= new Date();
        expires.setHours(expires.getHours()+horas);
        try {
            const trabajador = await trabajador_MongooseModel.findOne({ _id: { $eq: String(objetivo) } });
            trabajador.rolTemporal.rol=rol;
            trabajador.rolTemporal.expiracion=expires;
            await trabajador.save();
            res.status(200).send('Rol temporal asignado con éxito');
        } catch (error) {
            
            res.status(500).send('Error interno del servidor');
        }
    }else{
        res.status(401).send('Token inválido');
    }
}

const darRol = async (req,res) => {
    const {token} = req.body;
    const tokenValido = await Token.validartoken(token);
    if (tokenValido.valid){
        const {objetivo,rol}=req.body;
        try {
            const trabajador = await trabajador_MongooseModel.findOne({ _id: { $eq: String(objetivo) } });
            trabajador.rol=rol;
            await trabajador.save();
            res.status(200).send('Rol asignado con éxito');
        } catch (error) {
            res.status(500).send('Error interno del servidor');
        }
    }else{
        res.status(401).send('Token inválido');
    }
}

const modificarRol = async (req, res) => {
    const {token} = req.body;
    const tokenValido = await Token.validartoken(token);
    if (tokenValido.valid){
        const {id,nombre, permisos} = req.body;
        try{
            await Rol.findByIdAndUpdate(String(id), {nombre, permisos});
            res.send('Rol modificado con éxito');
        }catch (error) {
            res.status(500).send('Error interno del servidor');
        }
    }
}

module.exports = {obtenerRoles, crearRol, rolesTemporales, modificarRol,darRol};