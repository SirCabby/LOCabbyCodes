const fs = require('fs');

const ids = process.argv.slice(2).map(Number);
if (!ids.length) {
    console.error('Usage: node scripts/read-common-events.js <id> [id...]');
    process.exit(1);
}

const dataPath =
    'C:/Program Files (x86)/Steam/steamapps/common/Look Outside/data/CommonEvents.json';
const events = JSON.parse(fs.readFileSync(dataPath, 'utf8'));

ids.forEach(id => {
    if (!Number.isFinite(id)) {
        return;
    }
    const ev = events[id];
    if (!ev) {
        console.log(`${id}: <missing>`);
        return;
    }
    console.log(`${id}: ${ev.name || ''}`);
});



