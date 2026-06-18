const ASSIGNMENT_TYPE_ALIASES = {
    delantoVerificacion: 'adelantoVerificacion',
};

const normalizeAssignmentType = (tipo) => {
    const normalized = String(tipo || '').trim();
    return ASSIGNMENT_TYPE_ALIASES[normalized] || normalized;
};

const normalizeAssignmentTypes = (tipos, allowedTypes) => {
    const allowed = new Set(allowedTypes || []);
    const selected = Array.isArray(tipos)
        ? Array.from(new Set(
            tipos
                .map(normalizeAssignmentType)
                .filter((tipo) => allowed.has(tipo))
        ))
        : [];

    return selected.length ? selected : [...allowedTypes];
};

const serializeCompanyList = (value) => {
    if (Array.isArray(value)) {
        return Array.from(new Set(value.map((item) => String(item || '').trim()).filter(Boolean)));
    }
    if (typeof value === 'string' && value.trim()) {
        return [value.trim()];
    }
    return [];
};

const incrementWorkerLoad = (loadByWorker, workerId) => {
    if (!workerId) return;
    loadByWorker.set(workerId, (loadByWorker.get(workerId) || 0) + 1);
};

const pickBalancedWorker = ({ candidateIds, workersById, loadByWorker }) => {
    const validCandidates = Array.from(new Set(candidateIds || []))
        .filter((id) => workersById.has(id))
        .sort((left, right) => {
            const leftLoad = loadByWorker.get(left) || 0;
            const rightLoad = loadByWorker.get(right) || 0;
            if (leftLoad !== rightLoad) return leftLoad - rightLoad;

            const leftName = workersById.get(left)?.nombre || '';
            const rightName = workersById.get(right)?.nombre || '';
            const byName = leftName.localeCompare(rightName, 'es');
            return byName || left.localeCompare(right);
        });

    const selected = validCandidates[0] || null;
    if (selected) {
        incrementWorkerLoad(loadByWorker, selected);
    }

    return selected;
};

module.exports = {
    normalizeAssignmentType,
    normalizeAssignmentTypes,
    pickBalancedWorker,
    incrementWorkerLoad,
    serializeCompanyList,
};
