const fs = require('fs');

const [mapIdArg, eventIdArg, pageIndexArg] = process.argv.slice(2);
const mapId = Number(mapIdArg);
const eventId = Number(eventIdArg);
const pageIndex = pageIndexArg ? Number(pageIndexArg) : 0;

if (!Number.isFinite(mapId) || !Number.isFinite(eventId)) {
    console.error('Usage: node scripts/dump-map-event.js <mapId> <eventId> [pageIndex]');
    process.exit(1);
}

const mapPath = `C:/Program Files (x86)/Steam/steamapps/common/Look Outside/data/Map${String(
    mapId
).padStart(3, '0')}.json`;

const mapData = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
const event = mapData.events?.[eventId];

if (!event) {
    console.error(`Event ${eventId} not found on map ${mapId}.`);
    process.exit(1);
}

const page = event.pages?.[pageIndex];
if (!page) {
    console.error(`Page ${pageIndex} not found for event ${eventId}.`);
    process.exit(1);
}

console.log(`Event ${eventId} (${event.name || 'Unnamed'}) page ${pageIndex + 1}`);
page.list.forEach((command, idx) => {
    if (!command) {
        return;
    }
    console.log(
        `${String(idx).padStart(3, '0')}: code=${command.code} params=${JSON.stringify(
            command.parameters
        )}`
    );
});



