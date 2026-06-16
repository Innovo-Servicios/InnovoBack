const test = require('node:test');
const assert = require('node:assert/strict');

const {
    clearHolidayCache,
    getChileanHolidays,
    isHolidayDate,
    normalizeHolidayPayload,
} = require('../src/utils/chileanHolidays.js');

test('normalizeHolidayPayload keeps valid holidays for the requested year', () => {
    const holidays = normalizeHolidayPayload({
        data: [
            {
                date: '2026-05-01',
                title: 'Día Nacional del Trabajo',
                type: 'Civil',
                inalienable: true,
            },
            {
                date: '2025-12-25',
                title: 'Navidad',
                type: 'Religioso',
                inalienable: true,
            },
            { date: 'sin-fecha', title: 'Inválido' },
        ],
    }, 2026);

    assert.deepEqual(holidays, [
        {
            date: '2026-05-01',
            title: 'Día Nacional del Trabajo',
            type: 'Civil',
            inalienable: true,
        },
    ]);
});

test('isHolidayDate detects dates from normalized holidays', () => {
    const holidays = normalizeHolidayPayload({
        data: [
            {
                date: '2026-01-01',
                title: 'Año Nuevo',
                type: 'Civil',
                inalienable: true,
            },
        ],
    }, 2026);

    assert.equal(isHolidayDate('2026-01-01', holidays), true);
    assert.equal(isHolidayDate('2026-01-02', holidays), false);
});

test('getChileanHolidays caches fresh data and falls back to stale cache on API failure', async () => {
    clearHolidayCache();

    let calls = 0;
    const axiosClient = {
        get: async () => {
            calls += 1;

            if (calls > 1) {
                throw new Error('API unavailable');
            }

            return {
                data: {
                    status: 'success',
                    data: [
                        {
                            date: '2026-01-01',
                            title: 'Año Nuevo',
                            type: 'Civil',
                            inalienable: true,
                        },
                    ],
                },
            };
        },
    };

    const first = await getChileanHolidays(2026, { axiosClient, now: 0 });
    assert.equal(first.cached, false);
    assert.equal(calls, 1);

    const freshCache = await getChileanHolidays(2026, { axiosClient, now: 1000 });
    assert.equal(freshCache.cached, true);
    assert.equal(freshCache.stale, undefined);
    assert.equal(calls, 1);

    const staleCache = await getChileanHolidays(2026, {
        axiosClient,
        now: 24 * 60 * 60 * 1000 + 1,
    });
    assert.equal(staleCache.cached, true);
    assert.equal(staleCache.stale, true);
    assert.equal(calls, 2);
});
