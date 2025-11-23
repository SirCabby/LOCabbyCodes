const path = require('path');
const data = require(path.join(__dirname, '..', 'game_files', 'CommonEvents.json'));
const label = 'endCraft';
const targetEvents = new Set([42, 44, 45]);
let found = false;
for (let eventId = 1; eventId < data.length; eventId += 1) {
    const evt = data[eventId];
    if (!evt || !Array.isArray(evt.list)) {
        continue;
    }
    const idx = evt.list.findIndex(
        cmd => cmd && cmd.code === 118 && Array.isArray(cmd.parameters) && cmd.parameters[0] === label
    );
    if (idx !== -1) {
        console.log('eventId', eventId, 'name', evt.name, 'commands', evt.list.length, 'label', label, 'index', idx);
        found = true;
    }
    if (targetEvents.has(eventId)) {
        console.log('eventId', eventId, 'name', evt.name, 'commands', evt.list.length);
    }
}
if (!found) {
    console.log('Label not found');
}

