const toPlainObject = (value) => {
    if (!value) {
        return value;
    }

    return typeof value.toObject === 'function' ? value.toObject() : value;
};

const normalizeLocation = (location) => {
    if (!location) {
        return null;
    }

    if (
        location.lat === null ||
        location.lat === undefined ||
        location.lat === '' ||
        location.lng === null ||
        location.lng === undefined ||
        location.lng === ''
    ) {
        return null;
    }

    const lat = Number(location.lat);
    const lng = Number(location.lng);

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return null;
    }

    return { lat, lng };
};

const normalizeDate = (value) => {
    if (!value) {
        return null;
    }

    const date = value instanceof Date ? value : new Date(value);

    if (Number.isNaN(date.getTime())) {
        return null;
    }

    return date.toISOString();
};

const buildLastUbicationUpdate = (location, date = new Date()) => {
    const normalizedLocation = normalizeLocation(location);

    if (!normalizedLocation) {
        return null;
    }

    return {
        ...normalizedLocation,
        date,
    };
};

const getWorkerId = (worker) => {
    const plainWorker = toPlainObject(worker);
    return String(plainWorker?.id_trabajador || plainWorker?.Rut || plainWorker?.id || '').trim();
};

const getWorkerName = (worker) => {
    const plainWorker = toPlainObject(worker);
    return String(plainWorker?.nombre || plainWorker?.Nombre || '').trim();
};

const buildTrackingEntry = ({
    id_trabajador,
    nombre,
    ubicacion,
    conectado,
    ultimaActualizacion,
}) => {
    const normalizedLocation = normalizeLocation(ubicacion);
    const workerId = String(id_trabajador || '').trim();

    if (!workerId || !normalizedLocation) {
        return null;
    }

    return {
        id_trabajador: workerId,
        nombre: String(nombre || '').trim(),
        ubicacion: normalizedLocation,
        conectado: Boolean(conectado),
        ultimaActualizacion: normalizeDate(ultimaActualizacion),
    };
};

const workerDocumentToTrackingEntry = (worker) => {
    const plainWorker = toPlainObject(worker);
    const lastUbication = plainWorker?.lastUbication;

    return buildTrackingEntry({
        id_trabajador: getWorkerId(plainWorker),
        nombre: getWorkerName(plainWorker),
        ubicacion: lastUbication,
        conectado: false,
        ultimaActualizacion: lastUbication?.date,
    });
};

const connectedWorkerToTrackingEntry = (worker) => {
    const plainWorker = toPlainObject(worker);

    return buildTrackingEntry({
        id_trabajador: getWorkerId(plainWorker),
        nombre: getWorkerName(plainWorker),
        ubicacion: plainWorker?.ubicacion,
        conectado: true,
        ultimaActualizacion: plainWorker?.ultimaActualizacion || plainWorker?.lastUbication?.date,
    });
};

const mergeWorkerLocationSnapshots = ({ workers = [], connectedWorkers = [] } = {}) => {
    const merged = new Map();

    workers
        .map(workerDocumentToTrackingEntry)
        .filter(Boolean)
        .forEach((worker) => {
            merged.set(worker.id_trabajador, worker);
        });

    connectedWorkers
        .map(connectedWorkerToTrackingEntry)
        .filter(Boolean)
        .forEach((worker) => {
            merged.set(worker.id_trabajador, worker);
        });

    return Array.from(merged.values()).sort((a, b) =>
        a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' })
    );
};

module.exports = {
    buildLastUbicationUpdate,
    buildTrackingEntry,
    mergeWorkerLocationSnapshots,
    normalizeLocation,
};
