const fs = require('fs');

const mapId = Number(process.argv[2] || 3);
const targets = new Set([19, 21, 22, 40, 63, 238]);

const mapPath = `C:/Program Files (x86)/Steam/steamapps/common/Look Outside/data/Map${String(
    mapId
).padStart(3, '0')}.json`;
const mapData = JSON.parse(fs.readFileSync(mapPath, 'utf8'));

mapData.events
    .filter(Boolean)
    .forEach(event => {
        let printed = false;
        event.pages.forEach((page, pageIndex) => {
            page.list.forEach((command, idx) => {
                if (command.code === 122 && targets.has(command.parameters?.[0])) {
                    if (!printed) {
                        console.log(`Event ${event.id} (${event.name || 'Unnamed'})`);
                        printed = true;
                    }
                    console.log(
                        `  Page ${pageIndex + 1}, idx ${idx}, start=${command.parameters[0]}, params=${JSON.stringify(
                            command.parameters
                        )}`
                    );
                }
            });
        });
    });



