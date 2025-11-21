const fs = require('fs');

const [mapId, targetId] = process.argv.slice(2).map(Number);
if (!Number.isFinite(mapId) || !Number.isFinite(targetId)) {
    console.error('Usage: node scripts/find-common-event-usage.js <mapId> <commonEventId>');
    process.exit(1);
}

const mapPath = `C:/Program Files (x86)/Steam/steamapps/common/Look Outside/data/Map${String(
    mapId
).padStart(3, '0')}.json`;

const mapData = JSON.parse(fs.readFileSync(mapPath, 'utf8'));

mapData.events
    .filter(Boolean)
    .forEach(event => {
        event.pages.forEach((page, pageIndex) => {
            page.list.forEach((command, idx) => {
                if (command.code === 117 && command.parameters?.[0] === targetId) {
                    console.log(
                        `Event ${event.id} (${event.name || 'Unnamed'}) page ${pageIndex + 1} index ${idx}`
                    );
                }
            });
        });
    });



