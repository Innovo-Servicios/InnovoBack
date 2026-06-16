const axios = require('axios');

const HOLIDAYS_API_BASE_URL = 'https://api.boostr.cl/holidays';
const HOLIDAY_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const holidayCache = new Map();

const normalizeYear = (year) => {
    const normalized = Number(year);

    if (!Number.isInteger(normalized) || normalized < 2020 || normalized > 2100) {
        throw new Error('Año de feriados inválido.');
    }

    return normalized;
};

const normalizeHoliday = (rawHoliday, year) => {
    const date = String(rawHoliday?.date || '').trim();

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
    if (year && !date.startsWith(`${year}-`)) return null;

    return {
        date,
        title: String(rawHoliday?.title || 'Feriado').trim(),
        type: String(rawHoliday?.type || '').trim(),
        inalienable: Boolean(rawHoliday?.inalienable),
    };
};

const normalizeHolidayPayload = (payload, year) => {
    const normalizedYear = year ? normalizeYear(year) : null;
    const holidays = Array.isArray(payload?.data)
        ? payload.data
        : Array.isArray(payload)
            ? payload
            : [];

    return holidays
        .map((holiday) => normalizeHoliday(holiday, normalizedYear))
        .filter(Boolean)
        .sort((a, b) => a.date.localeCompare(b.date));
};

const fetchChileanHolidaysFromApi = async (year, axiosClient = axios) => {
    const normalizedYear = normalizeYear(year);
    const response = await axiosClient.get(`${HOLIDAYS_API_BASE_URL}/${normalizedYear}.json`, {
        headers: { accept: 'application/json' },
        timeout: 10000,
    });
    const holidays = normalizeHolidayPayload(response.data, normalizedYear);

    if (!holidays.length) {
        throw new Error(`No se encontraron feriados chilenos para ${normalizedYear}.`);
    }

    return holidays;
};

const getChileanHolidays = async (year, options = {}) => {
    const normalizedYear = normalizeYear(year);
    const now = Number.isFinite(options.now) ? options.now : Date.now();
    const cacheEntry = holidayCache.get(normalizedYear);

    if (cacheEntry && cacheEntry.expiresAt > now) {
        return {
            ...cacheEntry.value,
            cached: true,
        };
    }

    try {
        const holidays = await fetchChileanHolidaysFromApi(
            normalizedYear,
            options.axiosClient || axios
        );
        const value = {
            year: normalizedYear,
            holidays,
            source: 'boostr',
        };

        holidayCache.set(normalizedYear, {
            value,
            expiresAt: now + HOLIDAY_CACHE_TTL_MS,
        });

        return {
            ...value,
            cached: false,
        };
    } catch (error) {
        if (cacheEntry) {
            return {
                ...cacheEntry.value,
                cached: true,
                stale: true,
            };
        }

        throw error;
    }
};

const buildHolidayDateSet = (holidays) => {
    return new Set((holidays || []).map((holiday) => holiday.date).filter(Boolean));
};

const isHolidayDate = (date, holidays) => {
    if (!date) return false;

    return buildHolidayDateSet(holidays).has(date);
};

const clearHolidayCache = () => {
    holidayCache.clear();
};

module.exports = {
    buildHolidayDateSet,
    clearHolidayCache,
    fetchChileanHolidaysFromApi,
    getChileanHolidays,
    isHolidayDate,
    normalizeHolidayPayload,
    normalizeYear,
};
