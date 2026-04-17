import 'dotenv/config';

// Inline the working days logic to verify
function easterSunday(year) {
    const a = year % 19;
    const b = Math.floor(year / 100);
    const c = year % 100;
    const d = Math.floor(b / 4);
    const e = b % 4;
    const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4);
    const k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31);
    const day = ((h + l - 7 * m + 114) % 31) + 1;
    return { month, day };
}

const easter = easterSunday(2026);
console.log('Easter 2026:', `${easter.month}/${easter.day}`);
const pasquettaDate = new Date(Date.UTC(2026, easter.month - 1, easter.day + 1));
console.log('Pasquetta 2026:', pasquettaDate.toISOString().slice(0, 10));

// List all April 2026 days with status
const holidays = new Set([
    '2026-01-01','2026-01-06',
    `2026-${String(pasquettaDate.getUTCMonth()+1).padStart(2,'0')}-${String(pasquettaDate.getUTCDate()).padStart(2,'0')}`,
    '2026-04-25','2026-05-01','2026-06-02','2026-08-15','2026-11-01','2026-12-08','2026-12-25','2026-12-26'
]);

console.log('\nApril 2026 day-by-day:');
let workingTotal = 0;
let elapsedThrough16 = 0;
for (let d = 1; d <= 30; d++) {
    const date = new Date(Date.UTC(2026, 3, d)); // month 3 = April
    const dow = date.getUTCDay(); // 0=Sun
    const iso = `2026-04-${String(d).padStart(2, '0')}`;
    const isSunday = dow === 0;
    const isHoliday = holidays.has(iso);
    const isWorking = !isSunday && !isHoliday;
    const dayName = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][dow];
    if (isWorking) workingTotal++;
    if (d <= 16 && isWorking) elapsedThrough16++;
    console.log(`  ${d} ${dayName} ${isSunday ? '(SUN)' : isHoliday ? '(HOLIDAY: '+iso+')' : '✓'} ${isWorking ? 'WORK #'+workingTotal : 'OFF'}`);
}
console.log(`\nTotal working days in April 2026: ${workingTotal}`);
console.log(`Working days elapsed through April 16 (inclusive): ${elapsedThrough16}`);
console.log(`\nTarget fissati/day = 1225/24 = ${(1225/24).toFixed(2)}`);
console.log(`Target prev (13 days) = ${Math.round(1225/24 * 13)}`);
console.log(`Target prev (14 days) = ${Math.round(1225/24 * 14)}`);
