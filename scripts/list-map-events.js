const fs = require('fs');

const mapId = Number(process.argv[2]);
if (!Number.isFinite(mapId)) {
    console.error('Usage: node scripts/list-map-events.js <mapId>');
    process.exit(1);
}

const mapPath = `C:/Program Files (x86)/Steam/steamapps/common/Look Outside/data/Map${String(
    mapId
).padStart(3, '0')}.json`;

const mapData = JSON.parse(fs.readFileSync(mapPath, 'utf8'));

mapData.events
    .filter(Boolean)
    .forEach(event => {
        console.log(`${event.id}: ${event.name || ''}`);
    });



