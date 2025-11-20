const fs = require('fs');

const targets = new Set([19, 21, 22, 40, 63, 238]);
const path =
    'C:/Program Files (x86)/Steam/steamapps/common/Look Outside/data/CommonEvents.json';
const data = JSON.parse(fs.readFileSync(path, 'utf8'));

data.forEach((event, id) => {
    if (!event || !Array.isArray(event.list)) {
        return;
    }
    let printed = false;
    event.list.forEach((command, idx) => {
        if (command.code === 122 && targets.has(command.parameters?.[0])) {
            if (!printed) {
                console.log(`Common ${id} (${event.name || 'Unnamed'})`);
                printed = true;
            }
            console.log(
                `  idx ${idx} start=${command.parameters[0]} params=${JSON.stringify(
                    command.parameters
                )}`
            );
        }
    });
});


