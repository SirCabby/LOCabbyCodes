//=============================================================================
// CabbyCodes Doorbell
//=============================================================================
/*:
 * @target MZ
 * @plugindesc CabbyCodes Doorbell - Select and summon door visitors on demand.
 * @author CabbyCodes
 * @help
 * Adds an Options menu action that opens a selector for the next door visitor.
 * Choose anyone from the currently available pools or force an unavailable
 * encounter to knock immediately. Falls back to the legacy "next visitor"
 * behavior if the selector cannot be opened (e.g., during early boot).
 */

(() => {
    'use strict';

    if (typeof window.CabbyCodes === 'undefined') {
        console.warn('[CabbyCodes] Doorbell requires CabbyCodes core.');
        return;
    }

    const settingKey = 'sendNextDoorVisitor';
    const settingSymbol = `cabbycodes_${settingKey}`;
    const editorSettingKey = 'editUpcomingVisitors';
    const editorSettingSymbol = `cabbycodes_${editorSettingKey}`;
    // Set by the queue editor before it pushes the (shared) visitor selector so
    // the selector assigns the picked visitor to a queue slot instead of
    // summoning them immediately. Cleared after the assignment, and on cancel /
    // terminate so a later Send-Now open never inherits assignment mode.
    let pendingSlotAssignment = null;
    const friendlyDoorVisitorsSettingKey = 'friendlyDoorVisitors';
    const logPrefix = '[CabbyCodes]';
    const doorKnockSwitchId = 24;
    const doorBattlerPrefix = 'DoorEncs/';
    // The natural-knock event fires a slot when currentHour (var 16) lands
    // exactly on the slot's hour, so any 0-23 hour is valid; the game's own
    // visiting window is roughly 7-22 (see event 71 random ranges).
    const MIN_DOOR_HOUR = 0;
    const MAX_DOOR_HOUR = 23;

    const queueSlots = [
        { name: 'KnockEnc1', typeVar: 52, hourVar: 53, indexVar: 54 },
        { name: 'KnockEnc2', typeVar: 55, hourVar: 56, indexVar: 57 },
        { name: 'KnockEnc3', typeVar: 58, hourVar: 59, indexVar: 60 },
        { name: 'KnockEnc4', typeVar: 626, hourVar: 624, indexVar: 625 }
    ];

    const doorPoolDefinitions = Object.freeze([
        { varId: 164, label: 'Trader Pool', shortLabel: 'Traders', type: 0 },
        { varId: 165, label: 'General Pool', shortLabel: 'General', type: 1 },
        { varId: 166, label: 'Special Pool', shortLabel: 'Special', type: 2 },
        { varId: 170, label: 'Rare Pool', shortLabel: 'Rare', type: 3 }
    ]);

    const DEFAULT_VISITOR_POOLS = Object.freeze({
        164: Object.freeze([50, 51, 52, 53, 54]),
        165: Object.freeze([57, 61, 49, 59, 71, 48, 64, 55]),
        166: Object.freeze([56, 58, 68, 60, 63]),
        170: Object.freeze([])
    });

    const DEFAULT_VISITOR_ID_LIST = Object.freeze(
        Array.from(
            new Set(
                Object.values(DEFAULT_VISITOR_POOLS)
                    .flat()
                    .filter(value => Number.isFinite(value))
            )
        )
    );

    const EXCLUDED_VISITOR_IDS = Object.freeze([1]);
    // A cursed door encounter is the base visitor's troop ID plus this offset
    // (the game's knock-queue common event does `var += 200` when a base
    // visitor in the "allowed cursed" list rolls its cursed variant). So
    // troop 63 (Sophie) -> troop 263 ("Cursed Child" / the Trickster).
    const CURSED_TROOP_OFFSET = 200;

    const typeLabels = Object.freeze({
        0: 'Trader',
        1: 'General',
        2: 'Special',
        3: 'Rare'
    });

    const visitorNameCache = new Map();
    const visitorTypeCache = new Map();
    let optionsHookInstalled = false;

    // While a summoned visitor is pending, exempt the door-state IDs from the
    // Freeze Time restore loop so vars 50/51/67 and switch 24 stick long enough
    // for the player to reach the door. Released when switch 24 flips back to
    // false (= encounter resolved), at which point freeze-time re-syncs its
    // snapshot to the post-encounter values and resumes normal freezing.
    const DOOR_EXEMPT_VARIABLE_IDS = [50, 51, 67];
    const DOOR_EXEMPT_SWITCH_IDS = [doorKnockSwitchId];
    let activeDoorExemption = null;

    function acquireDoorExemption() {
        const api = CabbyCodes.freezeTime;
        if (!api || typeof api.exemptFromRestore !== 'function') {
            return;
        }
        if (activeDoorExemption) {
            activeDoorExemption.release();
            activeDoorExemption = null;
        }
        activeDoorExemption = api.exemptFromRestore({
            variables: DOOR_EXEMPT_VARIABLE_IDS,
            switches: DOOR_EXEMPT_SWITCH_IDS
        });
    }

    function releaseDoorExemption() {
        if (!activeDoorExemption) {
            return;
        }
        const token = activeDoorExemption;
        activeDoorExemption = null;
        token.release();
    }

    const hasGameObjects = () =>
        typeof $gameVariables !== 'undefined' &&
        $gameVariables &&
        typeof $gameSwitches !== 'undefined' &&
        $gameSwitches;

    function ensureDoorPoolsInitialized() {
        if (typeof window.setupDoorEncounters === 'function') {
            try {
                window.setupDoorEncounters();
            } catch (error) {
                CabbyCodes.warn(
                    `${logPrefix} setupDoorEncounters() failed: ${error?.message || error}`
                );
            }
        }
    }

    function readNumber(value) {
        const numeric = Number(value);
        return Number.isFinite(numeric) ? numeric : 0;
    }

    function normalizeEncounterId(value) {
        const numeric = readNumber(value);
        if (numeric >= 200) {
            return numeric - 200;
        }
        return numeric;
    }

    function windowScreenToLocalCoords(windowInstance, screenX, screenY) {
        if (!windowInstance || typeof PIXI === 'undefined' || !windowInstance.worldTransform) {
            return { x: screenX, y: screenY };
        }
        const point = new PIXI.Point(screenX, screenY);
        windowInstance.worldTransform.applyInverse(point, point);
        return point;
    }

    const cursedVariantCache = new Map();

    // True only when a base visitor actually has a real cursed troop at
    // base+200 (i.e. a populated DoorEncs troop). Many IDs in the game's
    // "allowed cursed" list have no distinct troop, so we never offer those.
    function hasCursedDoorVariant(baseId) {
        const normalized = readNumber(baseId);
        if (!Number.isFinite(normalized) || normalized <= 0) {
            return false;
        }
        if (cursedVariantCache.has(normalized)) {
            return cursedVariantCache.get(normalized);
        }
        let result = false;
        if (typeof $dataTroops !== 'undefined' && $dataTroops) {
            result = isDoorTroop($dataTroops[normalized + CURSED_TROOP_OFFSET]);
        }
        cursedVariantCache.set(normalized, result);
        return result;
    }

    function getTypeLabel(type) {
        if (typeof type === 'number' && Object.prototype.hasOwnProperty.call(typeLabels, type)) {
            return typeLabels[type];
        }
        return 'Unknown';
    }

    function getVisitorName(encounterId) {
        if (visitorNameCache.has(encounterId)) {
            return visitorNameCache.get(encounterId);
        }

        let result = `Visitor #${encounterId}`;

        if (typeof $dataTroops !== 'undefined' && $dataTroops) {
            const troop = $dataTroops[encounterId];
            if (troop && typeof troop.name === 'string' && troop.name.trim().length > 0) {
                result = troop.name.trim();
            } else if (troop && Array.isArray(troop.members) && troop.members.length > 0) {
                const enemyId = troop.members[0]?.enemyId;
                const enemyName = $dataEnemies?.[enemyId]?.name;
                if (enemyName && enemyName.trim().length > 0) {
                    result = enemyName.trim();
                }
            }
        }

        visitorNameCache.set(encounterId, result);
        return result;
    }

    function getVisitorThumbnail(encounterId) {
        if (
            typeof $dataTroops === 'undefined' ||
            !$dataTroops ||
            typeof $dataEnemies === 'undefined' ||
            !$dataEnemies
        ) {
            return null;
        }

        const troop = $dataTroops[encounterId];
        if (!troop || !Array.isArray(troop.members) || troop.members.length === 0) {
            return null;
        }

        const enemyId = troop.members[0]?.enemyId;
        const enemy = $dataEnemies[enemyId];
        if (!enemy || !enemy.battlerName) {
            return null;
        }

        return {
            battlerName: enemy.battlerName,
            hue: enemy.battlerHue || 0
        };
    }

    function isDoorTroop(troop) {
        if (!troop || !Array.isArray(troop.members) || troop.members.length === 0) {
            return false;
        }
        return troop.members.some(member => {
            const enemy = $dataEnemies?.[member.enemyId];
            const battlerName = enemy?.battlerName || '';
            return typeof battlerName === 'string' && battlerName.startsWith(doorBattlerPrefix);
        });
    }

    function collectKnownDoorVisitorIds() {
        if (typeof $dataTroops === 'undefined' || !$dataTroops || typeof $dataEnemies === 'undefined') {
            return DEFAULT_VISITOR_ID_LIST.slice();
        }

        const ids = [];
        for (let i = 1; i < $dataTroops.length; i += 1) {
            if (isDoorTroop($dataTroops[i])) {
                ids.push(i);
            }
        }

        if (ids.length === 0) {
            return DEFAULT_VISITOR_ID_LIST.slice();
        }

        return ids;
    }

    function findQueuedVisitor() {
        const candidates = queueSlots
            .map(slot => {
                const encounterId = readNumber($gameVariables.value(slot.indexVar));
                if (encounterId <= 0) {
                    return null;
                }
                return {
                    slot,
                    encounterId,
                    encounterType: readNumber($gameVariables.value(slot.typeVar)),
                    hour: readNumber($gameVariables.value(slot.hourVar))
                };
            })
            .filter(Boolean);

        if (candidates.length === 0) {
            return null;
        }

        candidates.sort((a, b) => a.hour - b.hour);
        return candidates[0];
    }

    function clearQueuedSlot(slot) {
        if (!slot) {
            return;
        }
        $gameVariables.setValue(slot.indexVar, 0);
        $gameVariables.setValue(slot.typeVar, 0);
        $gameVariables.setValue(slot.hourVar, 0);
    }

    function rollFreshVisitor() {
        if (typeof window.grabDoorEncounter !== 'function') {
            return null;
        }

        try {
            window.grabDoorEncounter();
        } catch (error) {
            CabbyCodes.error(
                `${logPrefix} grabDoorEncounter() failed: ${error?.message || error}`
            );
            return null;
        }

        const encounterId = readNumber($gameVariables.value(2));
        const encounterType = readNumber($gameVariables.value(3));

        if (encounterId <= 0) {
            return null;
        }

        return { encounterId, encounterType, slot: null, hour: null };
    }

    function activateDoorVisitor(visitorInfo) {
        const { encounterId, encounterType } = visitorInfo;
        const currentHour = readNumber($gameVariables.value(16));

        acquireDoorExemption();

        $gameVariables.setValue(51, encounterId);
        $gameVariables.setValue(50, currentHour + 1);
        $gameVariables.setValue(
            67,
            typeof encounterType === 'number' && encounterType >= 0 ? encounterType : 0
        );

        $gameSwitches.setValue(doorKnockSwitchId, true);

        if ($gameMessage && typeof $gameMessage.add === 'function') {
            $gameMessage.add('You hear a knock at the door...');
        }

        let sourceSummary = 'from encounter pool';
        if (visitorInfo.sourceLabel) {
            sourceSummary = `via ${visitorInfo.sourceLabel}`;
        } else if (visitorInfo.slot) {
            sourceSummary = `from ${visitorInfo.slot.name}`;
        }

        CabbyCodes.log(
            `${logPrefix} Summoned door visitor ${encounterId} ${sourceSummary}.`
        );
    }

    function ensureDoorReady() {
        if (!hasGameObjects()) {
            return { success: false, message: 'Game state is not ready yet.' };
        }
        if ($gameSwitches.value(doorKnockSwitchId)) {
            return { success: false, message: 'Someone is already at the door.' };
        }
        return { success: true };
    }

    function sendNextDoorVisitor() {
        const readyState = ensureDoorReady();
        if (!readyState.success) {
            CabbyCodes.warn(`${logPrefix} ${readyState.message}`);
            return false;
        }

        ensureDoorPoolsInitialized();

        let visitorInfo = findQueuedVisitor();
        if (visitorInfo) {
            clearQueuedSlot(visitorInfo.slot);
        } else {
            visitorInfo = rollFreshVisitor();
        }

        if (!visitorInfo || visitorInfo.encounterId <= 0) {
            CabbyCodes.warn(`${logPrefix} Unable to find a visitor to send.`);
            return false;
        }

        activateDoorVisitor(visitorInfo);
        return true;
    }

    function scheduleReset() {
        if (typeof setTimeout !== 'function') {
            CabbyCodes.setSetting(settingKey, false);
            return;
        }
        setTimeout(() => {
            CabbyCodes.setSetting(settingKey, false);
        }, 0);
    }

    function scheduleEditorReset() {
        if (typeof setTimeout !== 'function') {
            CabbyCodes.setSetting(editorSettingKey, false);
            return;
        }
        setTimeout(() => {
            CabbyCodes.setSetting(editorSettingKey, false);
        }, 0);
    }

    function gatherQueueEntries() {
        if (!hasGameObjects()) {
            return [];
        }
        return queueSlots
            .map(slot => {
                const encounterId = readNumber($gameVariables.value(slot.indexVar));
                if (encounterId <= 0) {
                    return null;
                }
                return {
                    id: encounterId,
                    rawValue: encounterId,
                    type: readNumber($gameVariables.value(slot.typeVar)),
                    hour: readNumber($gameVariables.value(slot.hourVar)),
                    slot
                };
            })
            .filter(Boolean);
    }

    function gatherPoolEntries() {
        if (!hasGameObjects()) {
            return [];
        }

        const entries = [];
        doorPoolDefinitions.forEach(def => {
            const poolValues = $gameVariables.value(def.varId);
            if (!Array.isArray(poolValues) || poolValues.length === 0) {
                return;
            }

            poolValues.forEach((rawValue, index) => {
                const normalized = normalizeEncounterId(rawValue);
                if (
                    normalized <= 0 ||
                    EXCLUDED_VISITOR_IDS.includes(normalized)
                ) {
                    return;
                }
                entries.push({
                    id: normalized,
                    rawValue,
                    poolVarId: def.varId,
                    poolIndex: index,
                    poolLabel: def.label,
                    type: def.type
                });
            });
        });

        return entries;
    }

    function inferDoorVisitorType(visitorId) {
        if (visitorTypeCache.has(visitorId)) {
            return visitorTypeCache.get(visitorId);
        }

        let inferred = null;
        doorPoolDefinitions.some(def => {
            const poolValues = $gameVariables?.value
                ? $gameVariables.value(def.varId)
                : null;
            if (Array.isArray(poolValues)) {
                const match = poolValues.some(value => normalizeEncounterId(value) === visitorId);
                if (match) {
                    inferred = def.type;
                    return true;
                }
            }
            return false;
        });

        if (inferred === null) {
            const defaults = doorPoolDefinitions.find(def =>
                (DEFAULT_VISITOR_POOLS[def.varId] || []).some(value => normalizeEncounterId(value) === visitorId)
            );
            if (defaults) {
                inferred = defaults.type;
            }
        }

        visitorTypeCache.set(visitorId, inferred);
        return inferred;
    }

    function createEntryDescriptor(entry, source) {
        const type =
            typeof entry.type === 'number'
                ? entry.type
                : inferDoorVisitorType(entry.id);
        const typeLabel = getTypeLabel(type);
        const rawValue = Number.isFinite(entry.rawValue) ? entry.rawValue : entry.id;
        const canBeCursed = hasCursedDoorVariant(entry.id);
        // If the game already promoted this queued/pooled entry to its cursed
        // variant (raw troop ID >= base+200), default the toggle to Cursed.
        const alreadyCursed = canBeCursed && Number.isFinite(rawValue) && rawValue >= CURSED_TROOP_OFFSET;
        const descriptor = {
            id: entry.id,
            name: getVisitorName(entry.id),
            type,
            detail: '',
            subtext: '',
            helpText: '',
            source,
            sourceLabel: null,
            canBeCursed,
            variant: alreadyCursed ? 'cursed' : 'friendly',
            thumbnail: getVisitorThumbnail(entry.id)
        };

        const cursedHint = canBeCursed
            ? ' Has a cursed variant — use the Friendly/Cursed button to choose, then Send.'
            : '';

        if (source === 'queue') {
            const hourText =
                entry.hour && entry.hour > 0
                    ? `Scheduled hour ${entry.hour}`
                    : 'Ready immediately';
            descriptor.detail = `${entry.slot.name} • ${typeLabel}`;
            descriptor.subtext = hourText;
            descriptor.helpText = `Pulls the queued visitor "${descriptor.name}" (${typeLabel}) immediately and clears ${entry.slot.name}.${cursedHint}`;
            descriptor.slot = entry.slot;
            descriptor.sourceLabel = entry.slot.name;
            return descriptor;
        }

        if (source === 'pool') {
            descriptor.detail = `${entry.poolLabel} • ${typeLabel}`;
            descriptor.subtext = `Position ${entry.poolIndex + 1} in pool`;
            descriptor.helpText = `Consumes "${descriptor.name}" from ${entry.poolLabel} so they knock right now.${cursedHint}`;
            descriptor.poolVarId = entry.poolVarId;
            descriptor.sourceLabel = entry.poolLabel;
            return descriptor;
        }

        descriptor.detail = `${typeLabel} • Forced visit`;
        descriptor.subtext = 'Not in current pools';
        descriptor.helpText = `Forces "${descriptor.name}" to knock even if unavailable. Pools remain unchanged.${cursedHint}`;
        descriptor.sourceLabel = 'Forced';
        return descriptor;
    }

    function buildDoorVisitorCatalog() {
        if (!hasGameObjects()) {
            return { available: [], unavailable: [] };
        }

        ensureDoorPoolsInitialized();

        const availableEntries = [];
        const availableIdSet = new Set();

        // In queue-edit assignment mode, never offer a visitor who is already
        // scheduled in a slot: each NPC can only knock once per day, so picking
        // a duplicate just blanks the slot. Seeding availableIdSet with the
        // queued ids (and skipping the queue section) hides them everywhere.
        const assignmentMode = !!(pendingSlotAssignment && pendingSlotAssignment.slot);

        const queueEntries = gatherQueueEntries();
        queueEntries.sort((a, b) => a.hour - b.hour);
        queueEntries.forEach(entry => {
            availableIdSet.add(entry.id);
            if (assignmentMode) {
                return;
            }
            availableEntries.push(createEntryDescriptor(entry, 'queue'));
        });

        const poolEntries = gatherPoolEntries();
        poolEntries.forEach(entry => {
            if (availableIdSet.has(entry.id)) {
                return;
            }
            availableEntries.push(createEntryDescriptor(entry, 'pool'));
            availableIdSet.add(entry.id);
        });

        const unavailableEntries = [];
        const unavailableIdSet = new Set();
        const knownIds = collectKnownDoorVisitorIds();
        knownIds.forEach(id => {
            // A base visitor and its cursed troop (base+200) both normalize to
            // the same id; collapse them into one row so each NPC appears once.
            const normalized = normalizeEncounterId(id);
            if (
                normalized <= 0 ||
                availableIdSet.has(normalized) ||
                unavailableIdSet.has(normalized) ||
                EXCLUDED_VISITOR_IDS.includes(normalized)
            ) {
                return;
            }
            unavailableIdSet.add(normalized);
            unavailableEntries.push(
                createEntryDescriptor({ id: normalized, rawValue: normalized }, 'unavailable')
            );
        });

        unavailableEntries.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

        if (assignmentMode) {
            // Scheduling a slot, the in-pool vs not-in-pool split is meaningless
            // (anyone can be slotted), and the pools are usually near-empty since
            // queued visitors were pulled out of them — which left Available
            // blank. Collapse everyone non-queued into one alphabetical list.
            const merged = availableEntries.concat(unavailableEntries);
            merged.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
            return { available: merged, unavailable: [] };
        }

        return { available: availableEntries, unavailable: unavailableEntries };
    }

    function computeSubtypeCounts(catalog) {
        const availableEntries = Array.isArray(catalog.available) ? catalog.available : [];
        const unavailableEntries = Array.isArray(catalog.unavailable) ? catalog.unavailable : [];

        const counts = {
            available: {
                all: availableEntries.length,
                queue: 0,
                trader: 0,
                general: 0,
                special: 0,
                rare: 0
            },
            unavailable: {
                all: unavailableEntries.length,
                trader: 0,
                general: 0,
                special: 0,
                rare: 0
            }
        };

        availableEntries.forEach(entry => {
            if (entry.source === 'queue') {
                counts.available.queue += 1;
            }
            if (entry.type === 0) {
                counts.available.trader += 1;
            } else if (entry.type === 1) {
                counts.available.general += 1;
            } else if (entry.type === 2) {
                counts.available.special += 1;
            } else if (entry.type === 3) {
                counts.available.rare += 1;
            }
        });

        unavailableEntries.forEach(entry => {
            if (entry.type === 0) {
                counts.unavailable.trader += 1;
            } else if (entry.type === 1) {
                counts.unavailable.general += 1;
            } else if (entry.type === 2) {
                counts.unavailable.special += 1;
            } else if (entry.type === 3) {
                counts.unavailable.rare += 1;
            }
        });

        return counts;
    }

    function consumeVisitorFromPool(poolVarId, encounterId) {
        const poolValues = $gameVariables.value(poolVarId);
        if (!Array.isArray(poolValues) || poolValues.length === 0) {
            return;
        }
        const updated = poolValues.slice();
        let index = updated.findIndex(value => normalizeEncounterId(value) === encounterId);
        if (index === -1) {
            index = updated.findIndex(value => readNumber(value) === encounterId);
        }
        if (index >= 0) {
            updated.splice(index, 1);
            $gameVariables.setValue(poolVarId, updated);
        }
    }

    function sendVisitorFromEntry(entry) {
        if (!entry || !entry.id) {
            return { success: false, message: 'Invalid visitor selection.' };
        }

        const readyState = ensureDoorReady();
        if (!readyState.success) {
            return readyState;
        }

        ensureDoorPoolsInitialized();

        if (entry.source === 'queue' && entry.slot) {
            clearQueuedSlot(entry.slot);
        } else if (entry.source === 'pool' && entry.poolVarId) {
            consumeVisitorFromPool(entry.poolVarId, entry.id);
        }

        // Pool consumption keys off the base id, but the encounter we actually
        // summon is the cursed troop (base+200) when the Cursed variant is
        // selected for a visitor that has one.
        const useCursed = entry.variant === 'cursed' && hasCursedDoorVariant(entry.id);
        const summonId = useCursed ? entry.id + CURSED_TROOP_OFFSET : entry.id;

        activateDoorVisitor({
            encounterId: summonId,
            encounterType: entry.type,
            slot: entry.slot || null,
            sourceLabel: entry.sourceLabel || null
        });

        const variantSuffix = useCursed ? ' (Cursed)' : '';
        return { success: true, message: `${entry.name}${variantSuffix} is heading to your door.` };
    }

    // -------------------------------------------------------------------------
    // Queue editing (writes the upcoming-knock slots WITHOUT summoning anyone)
    //
    // The natural-knock event (CommonEvents.json event 4, "TimePasses") copies a
    // slot's indexVar into the live encounter when var 16 reaches the slot's
    // hour, so editing the slot vars alone reschedules who knocks. We never set
    // switch 24 / vars 50-51-67 here, and the slot vars are not in Freeze Time's
    // frozen set, so no exemption token is needed (unlike the Send-Now path).
    // -------------------------------------------------------------------------

    function clampDoorHour(hour) {
        const numeric = Math.round(readNumber(hour));
        if (numeric < MIN_DOOR_HOUR) {
            return MIN_DOOR_HOUR;
        }
        if (numeric > MAX_DOOR_HOUR) {
            return MAX_DOOR_HOUR;
        }
        return numeric;
    }

    // Midpoint of each slot's natural visiting band (event 71, subsequent-day
    // ranges 7-10 / 11-14 / 15-18 / 19-22) — used to seed an hour when filling a
    // previously empty slot so the knock lands during waking hours.
    function defaultHourForSlot(slot) {
        const seeds = { KnockEnc1: 8, KnockEnc2: 12, KnockEnc3: 16, KnockEnc4: 20 };
        return seeds[slot?.name] || 12;
    }

    function friendlyModeActive() {
        return CabbyCodes.getSetting(friendlyDoorVisitorsSettingKey, false) === true;
    }

    // --- Draft model -------------------------------------------------------
    // The editor stages edits in a draft and only writes the slot vars on
    // Accept, so Cancel discards cleanly. The draft is module-level so it
    // survives the scene recreation that happens when the (shared) visitor
    // selector is pushed for the Reassign step.
    let activeSlotDraft = null;

    function makeSlotDraft(slot) {
        const state = readSlotState(slot);
        return {
            slot,
            id: state.baseId,
            type: state.type,
            hour: state.hour,
            cursed: state.cursed,
            filled: state.filled
        };
    }

    function draftCanBeCursed(draft) {
        return !!draft && draft.filled && draft.id > 0 && hasCursedDoorVariant(draft.id);
    }

    // Fold a picked catalog entry into the active draft (no var writes).
    function applyEntryToDraft(entry) {
        if (!activeSlotDraft || !entry || !entry.id) {
            return;
        }
        activeSlotDraft.id = entry.id;
        activeSlotDraft.type = typeof entry.type === 'number' && entry.type >= 0 ? entry.type : 0;
        activeSlotDraft.cursed = entry.variant === 'cursed' && hasCursedDoorVariant(entry.id);
        activeSlotDraft.filled = true;
        // Seed a valid knock hour if the slot had none (or a sentinel the clock
        // never reaches, e.g. the unused slot-4 hour 99 on day one).
        if (
            !(activeSlotDraft.hour >= MIN_DOOR_HOUR && activeSlotDraft.hour <= MAX_DOOR_HOUR) ||
            activeSlotDraft.hour === 0
        ) {
            activeSlotDraft.hour = defaultHourForSlot(activeSlotDraft.slot);
        }
    }

    // Persist a draft to its slot's vars (or clear the slot). Returns a result
    // with the Friendly-mode conflict flag so the caller can warn. Never sets
    // switch 24 / vars 50-51-67, and the slot vars are not Freeze-Time frozen,
    // so no exemption token is needed (unlike the Send-Now path).
    function commitSlotDraft(draft) {
        if (!draft || !draft.slot || !hasGameObjects()) {
            return { success: false, message: 'Game state is not ready yet.' };
        }
        const slot = draft.slot;
        if (!draft.filled || draft.id <= 0) {
            clearQueuedSlot(slot);
            CabbyCodes.log(`${logPrefix} Cleared ${slot.name}.`);
            return { success: true, cleared: true, message: `${slot.name} cleared.` };
        }

        const useCursed = draft.cursed && hasCursedDoorVariant(draft.id);
        const indexValue = useCursed ? draft.id + CURSED_TROOP_OFFSET : draft.id;
        const hour = clampDoorHour(draft.hour > 0 ? draft.hour : defaultHourForSlot(slot));

        $gameVariables.setValue(slot.indexVar, indexValue);
        $gameVariables.setValue(slot.typeVar, typeof draft.type === 'number' && draft.type >= 0 ? draft.type : 0);
        $gameVariables.setValue(slot.hourVar, hour);

        CabbyCodes.log(
            `${logPrefix} Saved ${slot.name}: visitor ${indexValue} type ${draft.type} hour ${hour}.`
        );
        const variantSuffix = useCursed ? ' (Cursed)' : '';
        let message = `${slot.name}: ${getVisitorName(draft.id)}${variantSuffix} scheduled for hour ${hour}.`;
        if (useCursed && friendlyModeActive()) {
            message += ' Friendly Door Visitors is ON and clears cursed slots next day.';
        }
        return { success: true, cursed: useCursed, message };
    }

    // Live read of a single slot's current contents for the editor UI.
    function readSlotState(slot) {
        const rawIndex = readNumber($gameVariables.value(slot.indexVar));
        const baseId = normalizeEncounterId(rawIndex);
        const filled = rawIndex > 0;
        return {
            slot,
            rawIndex,
            baseId,
            filled,
            cursed: filled && rawIndex >= CURSED_TROOP_OFFSET,
            type: readNumber($gameVariables.value(slot.typeVar)),
            hour: readNumber($gameVariables.value(slot.hourVar)),
            name: filled ? getVisitorName(baseId) : '',
            canBeCursed: filled && hasCursedDoorVariant(baseId),
            thumbnail: filled ? getVisitorThumbnail(rawIndex) || getVisitorThumbnail(baseId) : null
        };
    }

    function openDoorbellSelectorScene() {
        if (!hasGameObjects()) {
            CabbyCodes.warn(`${logPrefix} Door visitor selector requested before the game was ready.`);
            return false;
        }
        if (typeof SceneManager === 'undefined') {
            CabbyCodes.warn(`${logPrefix} SceneManager is unavailable; cannot open door visitor selector.`);
            return false;
        }
        if (typeof Scene_CabbyCodesDoorVisitorSelect === 'undefined') {
            CabbyCodes.warn(`${logPrefix} Door visitor selector scene is missing.`);
            return false;
        }

        SceneManager.push(Scene_CabbyCodesDoorVisitorSelect);
        return true;
    }

    function openDoorQueueEditorScene() {
        if (!hasGameObjects()) {
            CabbyCodes.warn(`${logPrefix} Visitor queue editor requested before the game was ready.`);
            return false;
        }
        if (typeof SceneManager === 'undefined') {
            CabbyCodes.warn(`${logPrefix} SceneManager is unavailable; cannot open the visitor queue editor.`);
            return false;
        }
        if (typeof Scene_CabbyCodesDoorQueueEdit === 'undefined') {
            CabbyCodes.warn(`${logPrefix} Visitor queue editor scene is missing.`);
            return false;
        }

        // Never re-enter assignment mode with stale state from a prior visit.
        pendingSlotAssignment = null;
        SceneManager.push(Scene_CabbyCodesDoorQueueEdit);
        return true;
    }

    CabbyCodes.registerSetting(
        settingKey,
        'Send Next Door Visitor',
        {
            defaultValue: false,
            order: 10,
            formatValue: () => 'Press',
            onChange: newValue => {
                if (!newValue) {
                    return;
                }
                const succeeded = sendNextDoorVisitor();
                if (!succeeded) {
                    CabbyCodes.warn(`${logPrefix} Summon request failed.`);
                }
                scheduleReset();
            }
        }
    );

    CabbyCodes.registerSetting(
        editorSettingKey,
        'Edit Upcoming Visitors',
        {
            defaultValue: false,
            order: 11,
            formatValue: () => 'Press',
            onChange: newValue => {
                if (!newValue) {
                    return;
                }
                // The scene normally opens from the Options processOk hook; this
                // is a safety net (e.g. toggled via keyboard) so the value never
                // sticks "on" and we still try to open the editor.
                if (!openDoorQueueEditorScene()) {
                    CabbyCodes.warn(`${logPrefix} Unable to open the visitor queue editor.`);
                }
                scheduleEditorReset();
            }
        }
    );

    function installDoorbellOptionsHook() {
        if (optionsHookInstalled) {
            return true;
        }

        if (typeof Window_Options === 'undefined' || !Window_Options.prototype) {
            return false;
        }

        const previousProcessOk = Window_Options.prototype.processOk;
        Window_Options.prototype.processOk = function() {
            const symbol = this.commandSymbol(this.index());
            if (symbol === settingSymbol) {
                const opened = openDoorbellSelectorScene();
                if (!opened) {
                    const fallback = sendNextDoorVisitor();
                    if (!fallback && typeof SoundManager !== 'undefined' && typeof SoundManager.playBuzzer === 'function') {
                        SoundManager.playBuzzer();
                    }
                }
                return;
            }

            if (symbol === editorSettingSymbol) {
                if (!openDoorQueueEditorScene() && typeof SoundManager !== 'undefined' && typeof SoundManager.playBuzzer === 'function') {
                    SoundManager.playBuzzer();
                }
                return;
            }

            if (typeof previousProcessOk === 'function') {
                previousProcessOk.call(this);
            }
        };

        optionsHookInstalled = true;
        return true;
    }

    if (!installDoorbellOptionsHook()) {
        const hookInterval = setInterval(() => {
            if (installDoorbellOptionsHook()) {
                clearInterval(hookInterval);
            }
        }, 100);
        setTimeout(() => {
            clearInterval(hookInterval);
            if (!optionsHookInstalled) {
                CabbyCodes.warn(`${logPrefix} Failed to hook Options window for the doorbell selector.`);
            }
        }, 5000);
    }

    // -------------------------------------------------------------------------
    // Door visitor selector scene & window
    // -------------------------------------------------------------------------

    function Scene_CabbyCodesDoorVisitorSelect() {
        this.initialize(...arguments);
        this._catalog = { available: [], unavailable: [] };
        this._currentCategory = 'available';
        this._currentSubtype = {
            available: 'all',
            unavailable: 'all'
        };
    }

    Scene_CabbyCodesDoorVisitorSelect.prototype = Object.create(Scene_MenuBase.prototype);
    Scene_CabbyCodesDoorVisitorSelect.prototype.constructor = Scene_CabbyCodesDoorVisitorSelect;

    Scene_CabbyCodesDoorVisitorSelect.prototype.create = function() {
        Scene_MenuBase.prototype.create.call(this);
        // Queue-edit assignment mode shows every unassigned NPC under a single
        // list, so the Available/Unavailable picker is meaningless — skip it.
        this._assignmentMode = !!(pendingSlotAssignment && pendingSlotAssignment.slot);
        this.createHelpWindow();
        if (!this._assignmentMode) {
            this.createCategoryWindow();
        }
        this.createSubtypeWindow();
        this.createListWindow();
        this.refreshVisitorData();
    };

    Scene_CabbyCodesDoorVisitorSelect.prototype.helpAreaHeight = function() {
        return this.calcWindowHeight(1, false);
    };

    Scene_CabbyCodesDoorVisitorSelect.prototype.helpAreaTop = function() {
        return 0;
    };

    Scene_CabbyCodesDoorVisitorSelect.prototype.categoryWindowHeight = function() {
        if (this._assignmentMode) {
            return 0;
        }
        return this.calcWindowHeight(1, false) + 4;
    };

    Scene_CabbyCodesDoorVisitorSelect.prototype.subtypeWindowHeight = function() {
        return this.calcWindowHeight(1, false) + 4;
    };

    Scene_CabbyCodesDoorVisitorSelect.prototype.createHelpWindow = function() {
        Scene_MenuBase.prototype.createHelpWindow.call(this);
        this._helpWindow.y = 0;
        this.updateHelpSummary();
    };

    Scene_CabbyCodesDoorVisitorSelect.prototype.categoryWindowRect = function() {
        const wy = this.helpAreaHeight();
        const ww = Graphics.boxWidth;
        const wh = this.categoryWindowHeight();
        return new Rectangle(0, wy, ww, wh);
    };

    Scene_CabbyCodesDoorVisitorSelect.prototype.createCategoryWindow = function() {
        const rect = this.categoryWindowRect();
        this._categoryWindow = new Window_CabbyCodesDoorVisitorCategory(rect);
        this._categoryWindow.deactivate();
        this._categoryWindow.selectSymbolByKey(this._currentCategory);
        this.addWindow(this._categoryWindow);
    };

    Scene_CabbyCodesDoorVisitorSelect.prototype.subtypeWindowRect = function() {
        const wy = this.helpAreaHeight() + this.categoryWindowHeight();
        const ww = Graphics.boxWidth;
        const wh = this.subtypeWindowHeight();
        return new Rectangle(0, wy, ww, wh);
    };

    Scene_CabbyCodesDoorVisitorSelect.prototype.createSubtypeWindow = function() {
        const rect = this.subtypeWindowRect();
        this._subtypeWindow = new Window_CabbyCodesDoorVisitorSubtype(rect);
        this._subtypeWindow.deactivate();
        // Must precede setCategory(): it drives whether the "Queue" tab is built.
        this._subtypeWindow.setAssignmentMode(this._assignmentMode);
        this._subtypeWindow.setCategory(
            this._currentCategory,
            this._currentSubtype[this._currentCategory]
        );
        this.addWindow(this._subtypeWindow);
    };

    Scene_CabbyCodesDoorVisitorSelect.prototype.listWindowRect = function() {
        const wy =
            this.helpAreaHeight() + this.categoryWindowHeight() + this.subtypeWindowHeight();
        const ww = Graphics.boxWidth;
        const wh = Graphics.boxHeight - wy;
        return new Rectangle(0, wy, ww, wh);
    };

    Scene_CabbyCodesDoorVisitorSelect.prototype.createListWindow = function() {
        const rect = this.listWindowRect();
        this._listWindow = new Window_CabbyCodesDoorVisitorList(rect);
        this._listWindow.setHandler('ok', this.onVisitorOk.bind(this));
        this._listWindow.setHandler('cancel', this.onListCancel.bind(this));
        // No category cycling in assignment mode — there's only one category.
        if (!this._assignmentMode) {
            this._listWindow.setHandler('pageup', this.onListCategoryCycle.bind(this, -1));
            this._listWindow.setHandler('pagedown', this.onListCategoryCycle.bind(this, 1));
        }
        this.addWindow(this._listWindow);
    };

    Scene_CabbyCodesDoorVisitorSelect.prototype.refreshVisitorData = function() {
        this._catalog = buildDoorVisitorCatalog();
        this._listWindow.setCatalog(this._catalog);
        this._listWindow.setSubtypeFilter('available', this._currentSubtype.available);
        this._listWindow.setSubtypeFilter('unavailable', this._currentSubtype.unavailable);
        this._listWindow.setCategory(this._currentCategory);
        if (this._categoryWindow) {
            this._categoryWindow.setCounts(this._catalog);
            this._categoryWindow.selectSymbolByKey(this._currentCategory);
        }
        this._subtypeWindow.setCounts(computeSubtypeCounts(this._catalog));
        this._subtypeWindow.setCategory(
            this._currentCategory,
            this._currentSubtype[this._currentCategory]
        );
        this.updateHelpSummary();
        this._listWindow.ensureSelection();
    };

    Scene_CabbyCodesDoorVisitorSelect.prototype.categoryDescription = function(categoryKey) {
        const summaries = {
            available: 'Available visitors from the queue and encounter pools.',
            unavailable: 'Unavailable visitors (force anyone even if not scheduled).'
        };
        if (categoryKey === 'available') {
            const subtype = this._currentSubtype?.available || 'all';
            switch (subtype) {
                case 'queue':
                    summaries.available = 'Queued and scheduled knocks waiting to happen.';
                    break;
                case 'trader':
                    summaries.available = 'Trader pool visitors currently in rotation.';
                    break;
                case 'general':
                    summaries.available = 'General pool visitors ready to summon.';
                    break;
                case 'special':
                    summaries.available = 'Special pool visitors ready to summon.';
                    break;
                case 'rare':
                    summaries.available = 'Rare pool visitors ready to summon.';
                    break;
                default:
                    summaries.available = 'All queued and pooled visitors you can summon.';
            }
        } else {
            const subtype = this._currentSubtype?.unavailable || 'all';
            summaries.unavailable =
                subtype === 'force'
                    ? 'Force any known visitor, even if not in current pools.'
                    : 'Review every known visitor for a manual summon.';
        }
        return summaries[categoryKey] || 'Select a category.';
    };

    Scene_CabbyCodesDoorVisitorSelect.prototype.updateHelpSummary = function() {
        if (!this._helpWindow) {
            return;
        }
        if (pendingSlotAssignment && pendingSlotAssignment.slot) {
            this._helpWindow.setText(
                `Pick who to schedule for ${pendingSlotAssignment.slot.name} (they knock at its hour, not now).`
            );
            return;
        }
        this._helpWindow.setText('Choose who knocks next and summon them immediately.');
    };

    Scene_CabbyCodesDoorVisitorSelect.prototype.setCurrentCategory = function(symbol) {
        const valid = symbol === 'unavailable' ? 'unavailable' : 'available';
        if (this._currentCategory === valid) {
            return;
        }
        this._currentCategory = valid;
        if (this._categoryWindow) {
            this._categoryWindow.selectSymbolByKey(valid);
        }
        if (this._listWindow) {
            this._listWindow.setCategory(valid);
            this._listWindow.ensureSelection();
        }
        if (this._subtypeWindow) {
            this._subtypeWindow.setCategory(
                this._currentCategory,
                this._currentSubtype[this._currentCategory]
            );
        }
        this.updateHelpSummary();
    };

    Scene_CabbyCodesDoorVisitorSelect.prototype.onListCategoryCycle = function(step) {
        const categories = ['available', 'unavailable'];
        const currentIndex = categories.indexOf(this._currentCategory);
        const nextIndex = (currentIndex + step + categories.length) % categories.length;
        this._currentCategory = categories[nextIndex];
        this._categoryWindow.selectSymbolByKey(this._currentCategory);
        this._listWindow.setCategory(this._currentCategory);
        this._listWindow.ensureSelection();
        this._subtypeWindow.setCategory(
            this._currentCategory,
            this._currentSubtype[this._currentCategory]
        );
        this.updateHelpSummary();
    };

    Scene_CabbyCodesDoorVisitorSelect.prototype.onVisitorOk = function() {
        const entry = this._listWindow.currentEntry();
        if (!entry) {
            if (typeof SoundManager !== 'undefined' && typeof SoundManager.playBuzzer === 'function') {
                SoundManager.playBuzzer();
            }
            this._listWindow.activate();
            return;
        }

        // Assignment mode: fold the picked visitor into the editor's draft (not
        // the game vars — the editor commits on Accept) and return to it.
        if (pendingSlotAssignment && pendingSlotAssignment.slot) {
            applyEntryToDraft(entry);
            pendingSlotAssignment = null;
            this.popScene();
            return;
        }

        const result = sendVisitorFromEntry(entry);
        if (!result.success) {
            this._helpWindow.setText(result.message || 'Unable to send visitor.');
            if (typeof SoundManager !== 'undefined' && typeof SoundManager.playBuzzer === 'function') {
                SoundManager.playBuzzer();
            }
            this._listWindow.activate();
            return;
        }

        this._helpWindow.setText(result.message || 'Visitor dispatched.');
        this.popScene();
    };

    Scene_CabbyCodesDoorVisitorSelect.prototype.onListCancel = function() {
        pendingSlotAssignment = null;
        this.popScene();
    };

    const baseDoorVisitorTerminate = Scene_CabbyCodesDoorVisitorSelect.prototype.terminate;
    Scene_CabbyCodesDoorVisitorSelect.prototype.terminate = function() {
        // Never leak assignment mode into a later Send-Now open of this scene.
        pendingSlotAssignment = null;
        if (typeof baseDoorVisitorTerminate === 'function') {
            baseDoorVisitorTerminate.call(this);
        } else {
            Scene_MenuBase.prototype.terminate.call(this);
        }
    };

    Scene_CabbyCodesDoorVisitorSelect.prototype.onCategoryOk = function() {
        const symbol = this._categoryWindow.currentSymbol();
        this.setCurrentCategory(symbol);
        this._categoryWindow.deactivate();
        this._listWindow.ensureSelection();
        this._listWindow.activate();
    };

    Scene_CabbyCodesDoorVisitorSelect.prototype.onCategoryCancel = function() {
        if (this._listWindow) {
            this._categoryWindow.deactivate();
            this._listWindow.ensureSelection();
            this._listWindow.activate();
        } else {
            this.popScene();
        }
    };

    Scene_CabbyCodesDoorVisitorSelect.prototype.onSubtypeOk = function() {
        const symbol = this._subtypeWindow.currentSymbol();
        if (symbol) {
            this._currentSubtype[this._currentCategory] = symbol;
            this._listWindow.setSubtypeFilter(this._currentCategory, symbol);
            this._listWindow.rebuildItems();
            this.updateHelpSummary();
        }
        this._subtypeWindow.deactivate();
        this._listWindow.ensureSelection();
        this._listWindow.activate();
    };

    Scene_CabbyCodesDoorVisitorSelect.prototype.onSubtypeCancel = function() {
        if (this._listWindow) {
            this._subtypeWindow.deactivate();
            this._listWindow.ensureSelection();
            this._listWindow.activate();
        } else {
            this.popScene();
        }
    };

    Scene_CabbyCodesDoorVisitorSelect.prototype.update = function() {
        Scene_MenuBase.prototype.update.call(this);
        this.handleTabTouch(this._categoryWindow, this.onCategoryOk);
        this.handleTabTouch(this._subtypeWindow, this.onSubtypeOk);
    };

    Scene_CabbyCodesDoorVisitorSelect.prototype.handleTabTouch = function(targetWindow, callback) {
        if (!targetWindow || !targetWindow.isOpen()) {
            return;
        }
        if (!TouchInput.isTriggered()) {
            return;
        }
        const local = windowScreenToLocalCoords(targetWindow, TouchInput.x, TouchInput.y);
        const hitIndex = targetWindow.hitTest(local.x, local.y);
        if (hitIndex >= 0) {
            targetWindow.select(hitIndex);
            if (typeof callback === 'function') {
                callback.call(this);
            }
        }
    };

    window.Scene_CabbyCodesDoorVisitorSelect = Scene_CabbyCodesDoorVisitorSelect;

    function Window_CabbyCodesDoorVisitorList() {
        this.initialize(...arguments);
    }

    Window_CabbyCodesDoorVisitorList.prototype = Object.create(Window_Selectable.prototype);
    Window_CabbyCodesDoorVisitorList.prototype.constructor = Window_CabbyCodesDoorVisitorList;

    Window_CabbyCodesDoorVisitorList.prototype.initialize = function(rect) {
        Window_Selectable.prototype.initialize.call(this, rect);
        this._catalog = { available: [], unavailable: [] };
        this._categoryKey = 'available';
        this._subtypeFilters = {
            available: 'all',
            unavailable: 'all'
        };
        this._items = [];
        this._hoverButton = null;
        this.refresh();
    };

    Window_CabbyCodesDoorVisitorList.prototype.maxCols = function() {
        return 1;
    };

    Window_CabbyCodesDoorVisitorList.prototype.itemHeight = function() {
        const titleHeight = this.lineHeight();
        const detailHeight = Math.floor(this.lineHeight() * 0.6);
        const padding = 4;
        return titleHeight + detailHeight + padding;
    };

    Window_CabbyCodesDoorVisitorList.prototype.setCatalog = function(catalog) {
        this._catalog = catalog || { available: [], unavailable: [] };
        this.rebuildItems();
    };

    Window_CabbyCodesDoorVisitorList.prototype.setCategory = function(categoryKey) {
        const normalized = categoryKey === 'unavailable' ? 'unavailable' : 'available';
        if (this._categoryKey === normalized) {
            return;
        }
        this._categoryKey = normalized;
        this.rebuildItems();
    };

    Window_CabbyCodesDoorVisitorList.prototype.setSubtypeFilter = function(categoryKey, subtype) {
        const normalizedCategory = categoryKey === 'unavailable' ? 'unavailable' : 'available';
        const normalizedSubtype = subtype || 'all';
        if (this._subtypeFilters[normalizedCategory] === normalizedSubtype) {
            return;
        }
        this._subtypeFilters[normalizedCategory] = normalizedSubtype;
        if (this._categoryKey === normalizedCategory) {
            this.rebuildItems();
        }
    };

    Window_CabbyCodesDoorVisitorList.prototype.rebuildItems = function() {
        this._items = this.buildItemsForCategory(this._categoryKey);
        const previousIndex = this.index();
        this.refresh();
        if (this.isEntryIndex(previousIndex)) {
            this.select(previousIndex);
        } else {
            const firstSelectable = this.firstSelectableIndex();
            this.select(firstSelectable >= 0 ? firstSelectable : 0);
        }
        this.updateHelp();
    };

    Window_CabbyCodesDoorVisitorList.prototype.firstSelectableIndex = function() {
        const index = this._items.findIndex(item => item.kind === 'entry');
        return index >= 0 ? index : -1;
    };

    Window_CabbyCodesDoorVisitorList.prototype.ensureSelection = function() {
        const first = this.firstSelectableIndex();
        if (first >= 0) {
            if (!this.isEntryIndex(this.index())) {
                this.select(first);
            }
            this.activate();
        } else {
            this.select(0);
            this.deactivate();
        }
    };

    Window_CabbyCodesDoorVisitorList.prototype.maxItems = function() {
        return this._items.length;
    };

    Window_CabbyCodesDoorVisitorList.prototype.itemAt = function(index) {
        return this._items[index] || null;
    };

    Window_CabbyCodesDoorVisitorList.prototype.currentEntry = function() {
        const item = this.itemAt(this.index());
        return item && item.kind === 'entry' ? item.entry : null;
    };

    Window_CabbyCodesDoorVisitorList.prototype.hasSelectableEntries = function() {
        return this._items.some(item => item.kind === 'entry');
    };

    Window_CabbyCodesDoorVisitorList.prototype.buildItemsForCategory = function(categoryKey) {
        const entries = Array.isArray(this._catalog?.[categoryKey])
            ? this._catalog[categoryKey]
            : [];
        const filterKey = this._subtypeFilters?.[categoryKey] || 'all';
        const filteredEntries =
            filterKey === 'all'
                ? entries
                : entries.filter(entry => this.matchesFilter(entry, categoryKey, filterKey));
        if (entries.length === 0 || filteredEntries.length === 0) {
            const label =
                categoryKey === 'unavailable'
                    ? 'No extra visitors are available to force right now.'
                    : 'No visitors are queued or ready in the pools.';
            return [{ kind: 'placeholder', label }];
        }
        return filteredEntries.map(entry => ({ kind: 'entry', entry }));
    };

    Window_CabbyCodesDoorVisitorList.prototype.matchesFilter = function(entry, categoryKey, subtype) {
        if (!entry || subtype === 'all') {
            return true;
        }
        if (categoryKey === 'available') {
            switch (subtype) {
                case 'queue':
                    return entry.source === 'queue';
                case 'trader':
                    return entry.type === 0;
                case 'general':
                    return entry.type === 1;
                case 'special':
                    return entry.type === 2;
                case 'rare':
                    return entry.type === 3;
                default:
                    return true;
            }
        }
        if (categoryKey === 'unavailable') {
            switch (subtype) {
                case 'trader':
                    return entry.type === 0;
                case 'general':
                    return entry.type === 1;
                case 'special':
                    return entry.type === 2;
                case 'rare':
                    return entry.type === 3;
                default:
                    return true;
            }
        }
        return true;
    };

    Window_CabbyCodesDoorVisitorList.prototype.isEntryIndex = function(index) {
        const item = this.itemAt(index);
        return !!item && item.kind === 'entry';
    };

    Window_CabbyCodesDoorVisitorList.prototype.cursorDown = function(wrap) {
        if (!this.hasSelectableEntries()) {
            return;
        }
        const previous = this.index();
        Window_Selectable.prototype.cursorDown.call(this, wrap);
        if (!this.isEntryIndex(this.index())) {
            this.select(previous);
        }
    };

    Window_CabbyCodesDoorVisitorList.prototype.cursorUp = function(wrap) {
        if (!this.hasSelectableEntries()) {
            return;
        }
        const previous = this.index();
        Window_Selectable.prototype.cursorUp.call(this, wrap);
        if (!this.isEntryIndex(this.index())) {
            this.select(previous);
        }
    };

    // Single column, so left/right are free to flip the variant of the
    // selected visitor (keyboard parity with the on-row toggle button).
    Window_CabbyCodesDoorVisitorList.prototype.cursorRight = function() {
        this.toggleVariantAt(this.index());
    };

    Window_CabbyCodesDoorVisitorList.prototype.cursorLeft = function() {
        this.toggleVariantAt(this.index());
    };

    Window_CabbyCodesDoorVisitorList.prototype.toggleVariantAt = function(index) {
        const item = this.itemAt(index);
        if (!item || item.kind !== 'entry' || !item.entry.canBeCursed) {
            if (typeof SoundManager !== 'undefined' && typeof SoundManager.playBuzzer === 'function') {
                SoundManager.playBuzzer();
            }
            return false;
        }
        item.entry.variant = item.entry.variant === 'cursed' ? 'friendly' : 'cursed';
        this.redrawItem(index);
        this.updateHelp();
        return true;
    };

    // The right edge of each row carries a [Friendly/Cursed] toggle (only for
    // visitors that have a cursed troop) and a [Send] button. Both drawing and
    // hit-testing derive from itemRect so they stay aligned while scrolling.
    Window_CabbyCodesDoorVisitorList.prototype.entryButtonRects = function(index) {
        const item = this.itemAt(index);
        const rect = this.itemRect(index);
        const pad = 6;
        const btnH = Math.min(this.lineHeight() - 2, rect.height - 6);
        const btnY = rect.y + Math.floor((rect.height - btnH) / 2);
        const sendW = 86;
        const send = new Rectangle(rect.x + rect.width - pad - sendW, btnY, sendW, btnH);
        let toggle = null;
        if (item && item.kind === 'entry' && item.entry.canBeCursed) {
            const togW = 118;
            toggle = new Rectangle(send.x - 8 - togW, btnY, togW, btnH);
        }
        const textRight = (toggle ? toggle.x : send.x) - 8;
        return { send, toggle, textRight };
    };

    // Convert window-local touch coords into content space (matching how
    // Window_Selectable.hitTest maps a click onto itemRect) and report which
    // button, if any, sits under the cursor.
    Window_CabbyCodesDoorVisitorList.prototype.buttonAtLocal = function(index, local) {
        if (!this.isEntryIndex(index)) {
            return 'row';
        }
        const cx = this.origin.x + local.x - this.padding;
        const cy = this.origin.y + local.y - this.padding;
        const rects = this.entryButtonRects(index);
        if (rects.toggle && rects.toggle.contains(cx, cy)) {
            return 'toggle';
        }
        if (rects.send && rects.send.contains(cx, cy)) {
            return 'send';
        }
        return 'row';
    };

    Window_CabbyCodesDoorVisitorList.prototype.processTouch = function() {
        if (!this.isOpenAndActive()) {
            return;
        }
        // A click spans two frames: isTriggered() on press, isClicked() on
        // release. We must intercept BOTH frames for our button regions —
        // otherwise the release frame falls through to the base handler, which
        // fires onTouchOk() and sends/closes the menu on a toggle tap.
        if (TouchInput.isTriggered() || TouchInput.isClicked()) {
            const local = windowScreenToLocalCoords(this, TouchInput.x, TouchInput.y);
            const hitIndex = this.hitTest(local.x, local.y);
            if (hitIndex >= 0 && this.isEntryIndex(hitIndex)) {
                const kind = this.buttonAtLocal(hitIndex, local);
                if (kind === 'toggle') {
                    if (TouchInput.isTriggered()) {
                        this.select(hitIndex);
                        this.toggleVariantAt(hitIndex);
                    }
                    return;
                }
                if (kind === 'send') {
                    this.select(hitIndex);
                    if (TouchInput.isClicked()) {
                        this.processOk();
                    }
                    return;
                }
                if (TouchInput.isTriggered()) {
                    this.select(hitIndex);
                    if (typeof SoundManager !== 'undefined' && typeof SoundManager.playCursor === 'function') {
                        SoundManager.playCursor();
                    }
                    this.updateHelp();
                }
                return;
            }
        }
        Window_Selectable.prototype.processTouch.call(this);
    };

    Window_CabbyCodesDoorVisitorList.prototype.update = function() {
        Window_Selectable.prototype.update.call(this);
        this.updateButtonHover();
    };

    Window_CabbyCodesDoorVisitorList.prototype.updateButtonHover = function() {
        let hover = null;
        if (this.isOpen() && this.visible && typeof TouchInput !== 'undefined') {
            const local = windowScreenToLocalCoords(this, TouchInput.x, TouchInput.y);
            const idx = this.hitTest(local.x, local.y);
            if (idx >= 0 && this.isEntryIndex(idx)) {
                const kind = this.buttonAtLocal(idx, local);
                if (kind === 'toggle' || kind === 'send') {
                    hover = { index: idx, kind };
                }
            }
        }
        const previous = this._hoverButton;
        const changed =
            !!hover !== !!previous ||
            (hover && previous && (hover.index !== previous.index || hover.kind !== previous.kind));
        if (changed) {
            this._hoverButton = hover;
            this.refresh();
        }
    };

    Window_CabbyCodesDoorVisitorList.prototype.updateHelp = function() {
        if (!this._helpWindow) {
            return;
        }
        const item = this.itemAt(this.index());
        if (!item || item.kind !== 'entry') {
            const fallback =
                this._categoryKey === 'unavailable'
                    ? 'No unavailable visitors can be forced at this time.'
                    : 'No visitors are ready to be summoned right now.';
            this._helpWindow.setText(fallback);
            return;
        }
        if (pendingSlotAssignment && pendingSlotAssignment.slot) {
            const variantHint = item.entry.canBeCursed
                ? ' Use ←/→ or the Friendly/Cursed button to choose, then Assign.'
                : '';
            this._helpWindow.setText(
                `Schedule "${item.entry.name}" for ${pendingSlotAssignment.slot.name}.${variantHint}`
            );
            return;
        }
        this._helpWindow.setText(item.entry.helpText || 'Select a visitor to knock on the door.');
    };

    Window_CabbyCodesDoorVisitorList.prototype.drawItem = function(index) {
        const item = this.itemAt(index);
        if (!item) {
            return;
        }
        const rect = this.itemRect(index);
        const padding = 4;
        const thumbnailSize = item.entry && item.entry.thumbnail ? this.thumbnailSize() : 0;
        if (thumbnailSize > 0 && item.entry.thumbnail) {
            const thumbY = rect.y + Math.max(0, Math.floor((rect.height - thumbnailSize) / 2));
            this.drawEntryThumbnail(item.entry, rect.x + padding, thumbY, thumbnailSize);
        }
        const textOffset = thumbnailSize > 0 ? thumbnailSize + padding : 0;
        const textRect = new Rectangle(
            rect.x + padding + textOffset,
            rect.y,
            rect.width - padding * 2 - textOffset,
            rect.height
        );

        if (item.kind === 'placeholder') {
            const color =
                typeof ColorManager !== 'undefined' && typeof ColorManager.textColor === 'function'
                    ? ColorManager.textColor(8)
                    : '#9fa0a4';
            this.changeTextColor(color);
            const textY = textRect.y + Math.floor((textRect.height - this.lineHeight()) / 2);
            this.drawText(item.label, textRect.x, Math.max(textRect.y, textY), textRect.width, 'center');
            this.resetTextColor();
            return;
        }

        const entry = item.entry;
        const buttons = this.entryButtonRects(index);
        const textWidth = Math.max(40, buttons.textRight - textRect.x);

        this.resetTextColor();
        this.drawText(entry.name, textRect.x, textRect.y, textWidth);
        this.changeTextColor(
            typeof ColorManager !== 'undefined' && typeof ColorManager.textColor === 'function'
                ? ColorManager.textColor(6)
                : this.normalColor()
        );
        this.drawText(entry.detail || '', textRect.x, textRect.y, textWidth, 'right');
        this.resetTextColor();
        const secondLineY = Math.min(
            textRect.y + this.lineHeight() - 2,
            rect.y + rect.height - this.lineHeight()
        );
        this.drawText(entry.subtext || '', textRect.x, secondLineY, textWidth);

        if (buttons.toggle) {
            const isCursed = entry.variant === 'cursed';
            this.drawListButton(buttons.toggle, isCursed ? 'Cursed' : 'Friendly', {
                kind: 'toggle',
                index,
                active: isCursed
            });
        }
        const sendLabel = pendingSlotAssignment ? 'Assign' : 'Send';
        this.drawListButton(buttons.send, sendLabel, { kind: 'send', index });
    };

    Window_CabbyCodesDoorVisitorList.prototype.drawListButton = function(rect, label, opts) {
        const options = opts || {};
        const hovered =
            this._hoverButton &&
            this._hoverButton.index === options.index &&
            this._hoverButton.kind === options.kind;

        let bgColor = 'rgba(255, 255, 255, 0.08)';
        if (options.kind === 'toggle' && options.active) {
            bgColor = 'rgba(190, 55, 55, 0.38)';
        }
        if (hovered) {
            bgColor = options.kind === 'send' ? 'rgba(70, 150, 240, 0.5)' : 'rgba(255, 255, 255, 0.24)';
        }
        this.contents.fillRect(rect.x, rect.y, rect.width, rect.height, bgColor);
        this.contents.fillRect(rect.x, rect.y, rect.width, 2, 'rgba(255, 255, 255, 0.28)');
        this.contents.fillRect(rect.x, rect.y + rect.height - 2, rect.width, 2, 'rgba(0, 0, 0, 0.35)');

        if (options.kind === 'toggle' && options.active) {
            this.changeTextColor('#ffb0b0');
        } else if (options.kind === 'send') {
            this.changeTextColor(
                typeof ColorManager !== 'undefined' && typeof ColorManager.systemColor === 'function'
                    ? ColorManager.systemColor()
                    : '#80c0ff'
            );
        } else {
            this.resetTextColor();
        }

        const previousFontSize = this.contents.fontSize;
        this.contents.fontSize = Math.max(18, previousFontSize - 4);
        const textY = rect.y + Math.floor((rect.height - this.lineHeight()) / 2);
        this.drawText(label, rect.x, textY, rect.width, 'center');
        this.contents.fontSize = previousFontSize;
        this.resetTextColor();
    };

    Window_CabbyCodesDoorVisitorList.prototype.thumbnailSize = function() {
        return Math.max(20, Math.min(32, this.itemHeight() - 6));
    };

    Window_CabbyCodesDoorVisitorList.prototype.drawEntryThumbnail = function(entry, x, y, size) {
        if (!entry || !entry.thumbnail || !entry.thumbnail.battlerName) {
            return;
        }
        const bitmap = ImageManager.loadEnemy(entry.thumbnail.battlerName, entry.thumbnail.hue || 0);
        if (!bitmap || bitmap.width <= 0 || bitmap.height <= 0) {
            if (bitmap && bitmap.addLoadListener) {
                bitmap.addLoadListener(() => this.refresh());
            }
            return;
        }
        this.contents.fillRect(x - 1, y - 1, size + 2, size + 2, '#ffffff');
        const scale = size / Math.max(bitmap.width, bitmap.height);
        const drawWidth = bitmap.width * scale;
        const drawHeight = bitmap.height * scale;
        const offsetX = x + Math.max(0, (size - drawWidth) / 2);
        const offsetY = y + Math.max(0, (size - drawHeight) / 2);
        this.contents.blt(bitmap, 0, 0, bitmap.width, bitmap.height, offsetX, offsetY, drawWidth, drawHeight);
    };

    window.Window_CabbyCodesDoorVisitorList = Window_CabbyCodesDoorVisitorList;

    function Window_CabbyCodesDoorVisitorCategory() {
        this.initialize(...arguments);
    }

    Window_CabbyCodesDoorVisitorCategory.prototype = Object.create(Window_HorzCommand.prototype);
    Window_CabbyCodesDoorVisitorCategory.prototype.constructor = Window_CabbyCodesDoorVisitorCategory;

    Window_CabbyCodesDoorVisitorCategory.prototype.initialize = function(rect) {
        Window_HorzCommand.prototype.initialize.call(this, rect);
        this._counts = { available: 0, unavailable: 0 };
        this._activeSymbol = 'available';
        this._hoverIndex = -1;
    };

    Window_CabbyCodesDoorVisitorCategory.prototype.windowHeight = function() {
        return this.fittingHeight(1);
    };

    Window_CabbyCodesDoorVisitorCategory.prototype.maxCols = function() {
        return 2;
    };

    Window_CabbyCodesDoorVisitorCategory.prototype.updateArrows = function() {
        Window_HorzCommand.prototype.updateArrows.call(this);
        this.downArrowVisible = false;
        this.upArrowVisible = false;
    };

    Window_CabbyCodesDoorVisitorCategory.prototype.update = function() {
        Window_HorzCommand.prototype.update.call(this);
        const hoverIndex = this.currentHoverIndex();
        if (this._hoverIndex !== hoverIndex) {
            this._hoverIndex = hoverIndex;
            this.refresh();
        }
    };

    Window_CabbyCodesDoorVisitorCategory.prototype.ensureCursorVisible = function() {};

    Window_CabbyCodesDoorVisitorCategory.prototype.cursorVisible = function() {
        return false;
    };

    Window_CabbyCodesDoorVisitorCategory.prototype.processCursorMove = function() {};
    Window_CabbyCodesDoorVisitorCategory.prototype.processHandling = function() {};
    Window_CabbyCodesDoorVisitorCategory.prototype.processWheel = function() {};
    Window_CabbyCodesDoorVisitorCategory.prototype.processTouch = function() {};
    Window_CabbyCodesDoorVisitorCategory.prototype.processCancel = function() {};

    Window_CabbyCodesDoorVisitorCategory.prototype.ensureCursorVisible = function() {};

    Window_CabbyCodesDoorVisitorCategory.prototype.cursorVisible = function() {
        return false;
    };

    Window_CabbyCodesDoorVisitorCategory.prototype.update = function() {
        Window_HorzCommand.prototype.update.call(this);
        this.updateHoverHighlight();
    };

    Window_CabbyCodesDoorVisitorCategory.prototype.updateHoverHighlight = function() {
        const hoverIndex = this.currentHoverIndex();
        if (this._hoverIndex !== hoverIndex) {
            this._hoverIndex = hoverIndex;
            this.refresh();
        }
    };

    Window_CabbyCodesDoorVisitorCategory.prototype.makeCommandList = function() {
        this.addCommand('Available', 'available');
        this.addCommand('Unavailable', 'unavailable');
    };

    Window_CabbyCodesDoorVisitorCategory.prototype.currentHoverIndex = function() {
        if (!this.isOpen() || !this.visible || typeof TouchInput === 'undefined') {
            return -1;
        }
        const local = windowScreenToLocalCoords(this, TouchInput.x, TouchInput.y);
        return this.hitTest(local.x, local.y);
    };

    Window_CabbyCodesDoorVisitorCategory.prototype.setCounts = function(catalog) {
        this._counts.available = Array.isArray(catalog?.available)
            ? catalog.available.length
            : Number(catalog?.available ?? 0);
        this._counts.unavailable = Array.isArray(catalog?.unavailable)
            ? catalog.unavailable.length
            : Number(catalog?.unavailable ?? 0);
        this.refresh();
    };

    Window_CabbyCodesDoorVisitorCategory.prototype.selectSymbolByKey = function(symbol) {
        const index = ['available', 'unavailable'].indexOf(symbol);
        if (index >= 0) {
            this._index = index;
            this._activeSymbol = symbol;
            this.refresh();
        }
    };

    Window_CabbyCodesDoorVisitorCategory.prototype.drawItem = function(index) {
        const rect = this.itemRect(index);
        const symbol = this.commandSymbol(index);
        const label = this.commandName(index);
        const count = this._counts?.[symbol] || 0;
        const text = count > 0 ? `${label} (${count})` : label;
        const isActive = symbol === this._activeSymbol;
        const isHover = !isActive && this._hoverIndex === index;

        const fontSize = this.contents.fontSize;
        this.contents.fontSize = fontSize + 4;
        if (isActive) {
            this.changeTextColor(
                typeof ColorManager !== 'undefined' && typeof ColorManager.systemColor === 'function'
                    ? ColorManager.systemColor()
                    : this.textColor(14)
            );
        } else if (isHover) {
            this.changeTextColor(
                typeof ColorManager !== 'undefined' && typeof ColorManager.textColor === 'function'
                    ? ColorManager.textColor(7)
                    : '#808080'
            );
        } else {
            this.resetTextColor();
        }
        this.drawText(text, rect.x, rect.y, rect.width, 'center');
        this.contents.fontSize = fontSize;
        this.resetTextColor();
    };

    window.Window_CabbyCodesDoorVisitorCategory = Window_CabbyCodesDoorVisitorCategory;

    function Window_CabbyCodesDoorVisitorSubtype() {
        this.initialize(...arguments);
    }

    Window_CabbyCodesDoorVisitorSubtype.prototype = Object.create(Window_HorzCommand.prototype);
    Window_CabbyCodesDoorVisitorSubtype.prototype.constructor = Window_CabbyCodesDoorVisitorSubtype;

    Window_CabbyCodesDoorVisitorSubtype.prototype.initialize = function(rect) {
        Window_HorzCommand.prototype.initialize.call(this, rect);
        this._category = 'available';
        this._selection = 'all';
        this._hoverIndex = -1;
        this._assignmentMode = false;
    };

    Window_CabbyCodesDoorVisitorSubtype.prototype.windowHeight = function() {
        return this.fittingHeight(1);
    };

    // Assignment mode has no scheduled-queue concept, so the "Queue" tab is
    // dropped from the Available subtypes (6 columns become 5).
    Window_CabbyCodesDoorVisitorSubtype.prototype.setAssignmentMode = function(flag) {
        this._assignmentMode = !!flag;
    };

    Window_CabbyCodesDoorVisitorSubtype.prototype.maxCols = function() {
        if (this._category === 'available') {
            return this._assignmentMode ? 5 : 6;
        }
        return 5;
    };

    Window_CabbyCodesDoorVisitorSubtype.prototype.updateArrows = function() {
        Window_HorzCommand.prototype.updateArrows.call(this);
        this.downArrowVisible = false;
        this.upArrowVisible = false;
    };

    Window_CabbyCodesDoorVisitorSubtype.prototype.ensureCursorVisible = function() {};

    Window_CabbyCodesDoorVisitorSubtype.prototype.cursorVisible = function() {
        return false;
    };

    Window_CabbyCodesDoorVisitorSubtype.prototype.processCursorMove = function() {};
    Window_CabbyCodesDoorVisitorSubtype.prototype.processHandling = function() {};
    Window_CabbyCodesDoorVisitorSubtype.prototype.processWheel = function() {};
    Window_CabbyCodesDoorVisitorSubtype.prototype.processTouch = function() {};
    Window_CabbyCodesDoorVisitorSubtype.prototype.processCancel = function() {};

    Window_CabbyCodesDoorVisitorSubtype.prototype.update = function() {
        Window_HorzCommand.prototype.update.call(this);
        this.updateHoverHighlight();
    };

    Window_CabbyCodesDoorVisitorSubtype.prototype.updateHoverHighlight = function() {
        const hoverIndex = this.currentHoverIndex();
        if (this._hoverIndex !== hoverIndex) {
            this._hoverIndex = hoverIndex;
            this.refresh();
        }
    };

    Window_CabbyCodesDoorVisitorSubtype.prototype.currentHoverIndex = function() {
        if (!this.isOpen() || !this.visible || typeof TouchInput === 'undefined') {
            return -1;
        }
        const local = windowScreenToLocalCoords(this, TouchInput.x, TouchInput.y);
        return this.hitTest(local.x, local.y);
    };

    Window_CabbyCodesDoorVisitorSubtype.prototype.setCategory = function(categoryKey, selection) {
        const normalized = categoryKey === 'unavailable' ? 'unavailable' : 'available';
        this._category = normalized;
        const requested = selection || 'all';
        this.clearCommandList();
        this.makeCommandList();
        let index = this.findSymbol(requested);
        if (index == null || index < 0) {
            this._selection = 'all';
            index = this.findSymbol(this._selection);
            if (index == null || index < 0) {
                index = 0;
            }
        } else {
            this._selection = requested;
        }
        this.refresh();
        this.select(index);
    };

    Window_CabbyCodesDoorVisitorSubtype.prototype.setCounts = function(countMatrix) {
        this._countsMatrix = countMatrix || {
            available: {},
            unavailable: {}
        };
        this.refresh();
    };

    Window_CabbyCodesDoorVisitorSubtype.prototype.makeCommandList = function() {
        const list =
            this._category === 'available'
                ? [
                      { name: 'All', symbol: 'all' },
                      ...(this._assignmentMode ? [] : [{ name: 'Queue', symbol: 'queue' }]),
                      { name: 'Traders', symbol: 'trader' },
                      { name: 'General', symbol: 'general' },
                      { name: 'Special', symbol: 'special' },
                      { name: 'Rare', symbol: 'rare' }
                  ]
                : [
                      { name: 'All', symbol: 'all' },
                      { name: 'Traders', symbol: 'trader' },
                      { name: 'General', symbol: 'general' },
                      { name: 'Special', symbol: 'special' },
                      { name: 'Rare', symbol: 'rare' }
                  ];
        list.forEach(entry => this.addCommand(entry.name, entry.symbol));
    };

    Window_CabbyCodesDoorVisitorSubtype.prototype.drawItem = function(index) {
        const rect = this.itemRect(index);
        const symbol = this.commandSymbol(index);
        const label = this.commandName(index);
        const countsForCategory = this._countsMatrix?.[this._category] || {};
        const count = countsForCategory[symbol];
        const text = typeof count === 'number' ? `${label} (${count})` : label;
        const isSelected = symbol === this._selection;
        const isHover = !isSelected && this._hoverIndex === index;

        const fontSize = this.contents.fontSize;
        if (isSelected) {
            this.contents.fontSize = fontSize + 2;
        }
        if (isSelected) {
            this.changeTextColor(
                typeof ColorManager !== 'undefined' && typeof ColorManager.systemColor === 'function'
                    ? ColorManager.systemColor()
                    : this.textColor(14)
            );
        } else if (isHover) {
            this.changeTextColor(
                typeof ColorManager !== 'undefined' && typeof ColorManager.textColor === 'function'
                    ? ColorManager.textColor(7)
                    : '#808080'
            );
        } else {
            this.resetTextColor();
        }
        this.drawText(text, rect.x, rect.y, rect.width, 'center');
        this.contents.fontSize = fontSize;
        this.resetTextColor();
    };

    window.Window_CabbyCodesDoorVisitorSubtype = Window_CabbyCodesDoorVisitorSubtype;

    // -------------------------------------------------------------------------
    // Upcoming-visitor queue editor (slot-first; reuses the selector above for
    // the "reassign visitor" step via assignment mode).
    // -------------------------------------------------------------------------

    function blitDoorThumbnail(win, thumbnail, x, y, size) {
        if (!win || !thumbnail || !thumbnail.battlerName || typeof ImageManager === 'undefined') {
            return;
        }
        const bitmap = ImageManager.loadEnemy(thumbnail.battlerName, thumbnail.hue || 0);
        if (!bitmap || bitmap.width <= 0 || bitmap.height <= 0) {
            if (bitmap && bitmap.addLoadListener) {
                bitmap.addLoadListener(() => win.refresh());
            }
            return;
        }
        win.contents.fillRect(x - 1, y - 1, size + 2, size + 2, '#ffffff');
        const scale = size / Math.max(bitmap.width, bitmap.height);
        const drawWidth = bitmap.width * scale;
        const drawHeight = bitmap.height * scale;
        const offsetX = x + Math.max(0, (size - drawWidth) / 2);
        const offsetY = y + Math.max(0, (size - drawHeight) / 2);
        win.contents.blt(bitmap, 0, 0, bitmap.width, bitmap.height, offsetX, offsetY, drawWidth, drawHeight);
    }

    // The stock Window_Help draws on a single line and clips anything wider than
    // the window. The queue editor's per-slot help can be long, so wrap it on
    // word boundaries to fit the (2-line) help area instead of running off the
    // right edge.
    function Window_CabbyCodesWrappedHelp() {
        this.initialize(...arguments);
    }

    Window_CabbyCodesWrappedHelp.prototype = Object.create(Window_Help.prototype);
    Window_CabbyCodesWrappedHelp.prototype.constructor = Window_CabbyCodesWrappedHelp;

    Window_CabbyCodesWrappedHelp.prototype.refresh = function() {
        const rect = this.baseTextRect();
        this.contents.clear();
        this.resetFontSettings();
        this.drawTextEx(this.wrapText(this._text, rect.width), rect.x, rect.y, rect.width);
    };

    Window_CabbyCodesWrappedHelp.prototype.wrapText = function(text, maxWidth) {
        if (!text) {
            return '';
        }
        // Honor any explicit breaks the caller inserted, wrapping each segment.
        return String(text)
            .split('\n')
            .map(line => this.wrapLine(line, maxWidth))
            .join('\n');
    };

    Window_CabbyCodesWrappedHelp.prototype.wrapLine = function(line, maxWidth) {
        const words = line.split(' ');
        const wrapped = [];
        let current = '';
        words.forEach(word => {
            const candidate = current ? `${current} ${word}` : word;
            if (current && this.textWidth(candidate) > maxWidth) {
                wrapped.push(current);
                current = word;
            } else {
                current = candidate;
            }
        });
        if (current) {
            wrapped.push(current);
        }
        return wrapped.join('\n');
    };

    window.Window_CabbyCodesWrappedHelp = Window_CabbyCodesWrappedHelp;

    function Scene_CabbyCodesDoorQueueEdit() {
        this.initialize(...arguments);
        this._slots = [];
        this._activeSlot = null;
        this._awaitingAssignment = false;
    }

    Scene_CabbyCodesDoorQueueEdit.prototype = Object.create(Scene_MenuBase.prototype);
    Scene_CabbyCodesDoorQueueEdit.prototype.constructor = Scene_CabbyCodesDoorQueueEdit;

    Scene_CabbyCodesDoorQueueEdit.prototype.create = function() {
        Scene_MenuBase.prototype.create.call(this);
        this.createHelpWindow();
        this.createSlotWindow();
        this.createActionWindow();
        this.createHourWindow();
        this.refreshSlots();
        if (activeSlotDraft) {
            // Returned from the Reassign selector mid-edit (scene was recreated);
            // resume the same slot's action menu with the in-progress draft.
            this._activeSlot = activeSlotDraft.slot;
            this.openActionMenu();
        } else {
            this._slotWindow.activate();
            this._slotWindow.select(0);
        }
    };

    Scene_CabbyCodesDoorQueueEdit.prototype.helpAreaHeight = function() {
        return this.calcWindowHeight(2, false);
    };

    Scene_CabbyCodesDoorQueueEdit.prototype.helpAreaTop = function() {
        return 0;
    };

    Scene_CabbyCodesDoorQueueEdit.prototype.createHelpWindow = function() {
        const rect = this.helpWindowRect();
        this._helpWindow = new Window_CabbyCodesWrappedHelp(rect);
        this.addWindow(this._helpWindow);
        this._helpWindow.y = 0;
        this.setSummaryHelp();
    };

    Scene_CabbyCodesDoorQueueEdit.prototype.setSummaryHelp = function() {
        if (this._helpWindow) {
            this._helpWindow.setText(
                "Edit today's queue — visitors knock at their scheduled hour, not now. The game re-rolls all slots each new day."
            );
        }
    };

    Scene_CabbyCodesDoorQueueEdit.prototype.slotWindowRect = function() {
        const wy = this.helpAreaHeight();
        const ww = Graphics.boxWidth;
        const wh = Graphics.boxHeight - wy;
        return new Rectangle(0, wy, ww, wh);
    };

    Scene_CabbyCodesDoorQueueEdit.prototype.createSlotWindow = function() {
        const rect = this.slotWindowRect();
        this._slotWindow = new Window_CabbyCodesDoorQueueSlots(rect);
        this._slotWindow.setHelpWindow(this._helpWindow);
        this._slotWindow.setHandler('ok', this.onSlotOk.bind(this));
        this._slotWindow.setHandler('cancel', this.onSlotCancel.bind(this));
        this.addWindow(this._slotWindow);
    };

    Scene_CabbyCodesDoorQueueEdit.prototype.actionWindowRect = function() {
        const ww = Math.min(380, Graphics.boxWidth - 80);
        const lines = 6;
        const wh = this.calcWindowHeight(lines, true);
        const wx = Math.floor((Graphics.boxWidth - ww) / 2);
        const wy = Math.floor((Graphics.boxHeight - wh) / 2);
        return new Rectangle(wx, wy, ww, wh);
    };

    Scene_CabbyCodesDoorQueueEdit.prototype.createActionWindow = function() {
        const rect = this.actionWindowRect();
        this._actionWindow = new Window_CabbyCodesDoorSlotActions(rect);
        this._actionWindow.setHandler('reassign', this.onActionReassign.bind(this));
        this._actionWindow.setHandler('variant', this.onActionVariant.bind(this));
        this._actionWindow.setHandler('hour', this.onActionHour.bind(this));
        this._actionWindow.setHandler('clear', this.onActionClear.bind(this));
        this._actionWindow.setHandler('accept', this.onActionAccept.bind(this));
        this._actionWindow.setHandler('cancel', this.onActionCancel.bind(this));
        this._actionWindow.hide();
        this._actionWindow.deactivate();
        this.addWindow(this._actionWindow);
    };

    Scene_CabbyCodesDoorQueueEdit.prototype.hourWindowRect = function() {
        const ww = Math.min(380, Graphics.boxWidth - 80);
        const wh = this.calcWindowHeight(2, false);
        const wx = Math.floor((Graphics.boxWidth - ww) / 2);
        const wy = Math.floor((Graphics.boxHeight - wh) / 2);
        return new Rectangle(wx, wy, ww, wh);
    };

    Scene_CabbyCodesDoorQueueEdit.prototype.createHourWindow = function() {
        const rect = this.hourWindowRect();
        this._hourWindow = new Window_CabbyCodesDoorHourInput(rect);
        this._hourWindow.setHandler('ok', this.onHourOk.bind(this));
        this._hourWindow.setHandler('cancel', this.onHourCancel.bind(this));
        this._hourWindow.hide();
        this._hourWindow.deactivate();
        this.addWindow(this._hourWindow);
    };

    Scene_CabbyCodesDoorQueueEdit.prototype.refreshSlots = function() {
        this._slots = queueSlots.map(slot => readSlotState(slot));
        if (this._slotWindow) {
            this._slotWindow.setSlots(this._slots);
        }
    };

    Scene_CabbyCodesDoorQueueEdit.prototype.onSlotOk = function() {
        const state = this._slotWindow.currentSlotState();
        if (!state) {
            this._slotWindow.activate();
            return;
        }
        this._activeSlot = state.slot;
        activeSlotDraft = makeSlotDraft(state.slot);
        this.openActionMenu();
    };

    Scene_CabbyCodesDoorQueueEdit.prototype.onSlotCancel = function() {
        this.popScene();
    };

    // One-line preview of the in-progress draft, shown in the help bar while the
    // action menu is open so unsaved edits are visible before Accept.
    Scene_CabbyCodesDoorQueueEdit.prototype.draftHelpText = function() {
        const draft = activeSlotDraft;
        if (!draft) {
            return '';
        }
        if (!draft.filled || draft.id <= 0) {
            return `${draft.slot.name}: will be cleared. Accept to save, Cancel to discard.`;
        }
        const variant = draft.cursed ? 'Cursed' : 'Friendly';
        let text = `${draft.slot.name} → ${getVisitorName(draft.id)} • ${getTypeLabel(draft.type)} • ${variant} • hour ${draft.hour} (unsaved).`;
        if (draft.cursed && friendlyModeActive()) {
            text += ' Friendly Door Visitors is ON — it clears cursed slots next day.';
        }
        return text;
    };

    Scene_CabbyCodesDoorQueueEdit.prototype.openActionMenu = function() {
        this._actionWindow.setDraft(activeSlotDraft);
        this._actionWindow.show();
        this._actionWindow.open();
        this._actionWindow.activate();
        this._actionWindow.select(0);
        this._slotWindow.deactivate();
        if (this._helpWindow) {
            this._helpWindow.setText(this.draftHelpText());
        }
    };

    Scene_CabbyCodesDoorQueueEdit.prototype.closeActionMenu = function() {
        if (this._actionWindow) {
            this._actionWindow.deactivate();
            this._actionWindow.hide();
        }
    };

    Scene_CabbyCodesDoorQueueEdit.prototype.returnToSlots = function() {
        this.closeActionMenu();
        this.closeHourWindow();
        this.refreshSlots();
        this._slotWindow.activate();
        this._slotWindow.callUpdateHelp();
    };

    Scene_CabbyCodesDoorQueueEdit.prototype.onActionReassign = function() {
        if (!this._activeSlot || !activeSlotDraft) {
            this.returnToSlots();
            return;
        }
        // Hand off to the shared selector in assignment mode. Pushing here
        // terminates this scene; when the selector pops it has folded the pick
        // into activeSlotDraft (module-level, so it survives), and SceneManager
        // builds a FRESH editor whose create() resumes this draft's action menu.
        // _awaitingAssignment keeps terminate() from wiping the draft/handoff.
        pendingSlotAssignment = { slot: this._activeSlot };
        this._awaitingAssignment = true;
        this.closeActionMenu();
        this._slotWindow.deactivate();
        SceneManager.push(Scene_CabbyCodesDoorVisitorSelect);
    };

    Scene_CabbyCodesDoorQueueEdit.prototype.onActionVariant = function() {
        if (!draftCanBeCursed(activeSlotDraft)) {
            if (typeof SoundManager !== 'undefined' && typeof SoundManager.playBuzzer === 'function') {
                SoundManager.playBuzzer();
            }
            this._actionWindow.activate();
            return;
        }
        activeSlotDraft.cursed = !activeSlotDraft.cursed;
        // Stage only — rebuild the menu for the new label and refresh the preview.
        this._actionWindow.setDraft(activeSlotDraft);
        this._actionWindow.activate();
        if (this._helpWindow) {
            this._helpWindow.setText(this.draftHelpText());
        }
    };

    Scene_CabbyCodesDoorQueueEdit.prototype.onActionHour = function() {
        const seed = activeSlotDraft.hour > 0 ? activeSlotDraft.hour : defaultHourForSlot(this._activeSlot);
        this._hourWindow.setHour(seed);
        this._hourWindow.show();
        this._hourWindow.open();
        this._hourWindow.activate();
        this.closeActionMenu();
        if (this._helpWindow) {
            this._helpWindow.setText(
                'Use ←/→ to set the knock hour (0–23; 7–22 is the natural visiting window). OK to confirm.'
            );
        }
    };

    Scene_CabbyCodesDoorQueueEdit.prototype.closeHourWindow = function() {
        if (this._hourWindow) {
            this._hourWindow.deactivate();
            this._hourWindow.hide();
        }
    };

    Scene_CabbyCodesDoorQueueEdit.prototype.onHourOk = function() {
        if (activeSlotDraft) {
            activeSlotDraft.hour = clampDoorHour(this._hourWindow.hour());
        }
        this.closeHourWindow();
        this.openActionMenu();
    };

    Scene_CabbyCodesDoorQueueEdit.prototype.onHourCancel = function() {
        this.closeHourWindow();
        this.openActionMenu();
    };

    Scene_CabbyCodesDoorQueueEdit.prototype.onActionClear = function() {
        if (!activeSlotDraft || !activeSlotDraft.filled) {
            if (typeof SoundManager !== 'undefined' && typeof SoundManager.playBuzzer === 'function') {
                SoundManager.playBuzzer();
            }
            this._actionWindow.activate();
            return;
        }
        // Stage the clear; user still has to Accept. Stay in the menu so it can
        // be undone with Cancel or replaced via Fill Slot.
        activeSlotDraft.filled = false;
        activeSlotDraft.id = 0;
        this._actionWindow.setDraft(activeSlotDraft);
        this._actionWindow.activate();
        if (this._helpWindow) {
            this._helpWindow.setText(this.draftHelpText());
        }
    };

    Scene_CabbyCodesDoorQueueEdit.prototype.onActionAccept = function() {
        const result = commitSlotDraft(activeSlotDraft);
        activeSlotDraft = null;
        this.returnToSlots();
        if (result && result.message && this._helpWindow) {
            this._helpWindow.setText(result.message);
        }
    };

    Scene_CabbyCodesDoorQueueEdit.prototype.onActionCancel = function() {
        // Discard the draft; the slot vars were never touched, so refreshing
        // shows the original values.
        activeSlotDraft = null;
        this.returnToSlots();
    };

    Scene_CabbyCodesDoorQueueEdit.prototype.terminate = function() {
        // Clear leftover edit state on a normal exit, but NOT when handing off to
        // the selector (terminate fires before the selector reads the draft).
        if (!this._awaitingAssignment) {
            pendingSlotAssignment = null;
            activeSlotDraft = null;
        }
        Scene_MenuBase.prototype.terminate.call(this);
    };

    window.Scene_CabbyCodesDoorQueueEdit = Scene_CabbyCodesDoorQueueEdit;

    function Window_CabbyCodesDoorQueueSlots() {
        this.initialize(...arguments);
    }

    Window_CabbyCodesDoorQueueSlots.prototype = Object.create(Window_Selectable.prototype);
    Window_CabbyCodesDoorQueueSlots.prototype.constructor = Window_CabbyCodesDoorQueueSlots;

    Window_CabbyCodesDoorQueueSlots.prototype.initialize = function(rect) {
        Window_Selectable.prototype.initialize.call(this, rect);
        this._slots = [];
        this.refresh();
    };

    Window_CabbyCodesDoorQueueSlots.prototype.maxCols = function() {
        return 1;
    };

    Window_CabbyCodesDoorQueueSlots.prototype.maxItems = function() {
        return this._slots.length || queueSlots.length;
    };

    Window_CabbyCodesDoorQueueSlots.prototype.itemHeight = function() {
        const titleHeight = this.lineHeight();
        const detailHeight = Math.floor(this.lineHeight() * 0.7);
        return titleHeight + detailHeight + 6;
    };

    Window_CabbyCodesDoorQueueSlots.prototype.setSlots = function(slots) {
        this._slots = Array.isArray(slots) ? slots : [];
        const previous = this.index();
        this.refresh();
        this.select(previous >= 0 && previous < this.maxItems() ? previous : 0);
        this.updateHelp();
    };

    Window_CabbyCodesDoorQueueSlots.prototype.currentSlotState = function() {
        return this._slots[this.index()] || null;
    };

    Window_CabbyCodesDoorQueueSlots.prototype.thumbnailSize = function() {
        return Math.max(20, Math.min(36, this.itemHeight() - 6));
    };

    Window_CabbyCodesDoorQueueSlots.prototype.updateHelp = function() {
        if (!this._helpWindow) {
            return;
        }
        const state = this.currentSlotState();
        if (!state) {
            return;
        }
        if (!state.filled) {
            this._helpWindow.setText(`${state.slot.name} is empty — press to add a visitor.`);
            return;
        }
        const variant = state.cursed ? 'Cursed' : 'Friendly';
        this._helpWindow.setText(
            `${state.slot.name}: ${state.name} • ${getTypeLabel(state.type)} • ${variant} • hour ${state.hour}. Press to edit.`
        );
    };

    Window_CabbyCodesDoorQueueSlots.prototype.drawItem = function(index) {
        const state = this._slots[index];
        if (!state) {
            return;
        }
        const rect = this.itemRectWithPadding(index);
        const padding = 4;
        const gap = 8;
        const slotName = state.slot.name;

        // Always reserve the thumbnail column (even for empty slots) so every
        // row's text starts at the same x, and leave a gap after the image so
        // the text never butts up against it.
        const thumbnailSize = this.thumbnailSize();
        if (state.thumbnail) {
            const thumbY = rect.y + Math.max(0, Math.floor((rect.height - thumbnailSize) / 2));
            blitDoorThumbnail(this, state.thumbnail, rect.x + padding, thumbY, thumbnailSize);
        }
        const textOffset = padding + thumbnailSize + gap;
        const textX = rect.x + textOffset;
        const textWidth = rect.width - textOffset;
        const secondLineY = Math.min(
            rect.y + this.lineHeight() - 2,
            rect.y + rect.height - Math.floor(this.lineHeight() * 0.7)
        );

        if (!state.filled) {
            const dimColor =
                typeof ColorManager !== 'undefined' && typeof ColorManager.textColor === 'function'
                    ? ColorManager.textColor(8)
                    : '#9fa0a4';
            this.resetTextColor();
            this.drawText(`${slotName}: Empty`, textX, rect.y, textWidth);
            this.changeTextColor(dimColor);
            this.drawText('Press to add a visitor', textX, secondLineY, textWidth);
            this.resetTextColor();
            return;
        }

        this.resetTextColor();
        this.drawText(`${slotName}: ${state.name}`, textX, rect.y, textWidth);
        this.changeTextColor(
            typeof ColorManager !== 'undefined' && typeof ColorManager.textColor === 'function'
                ? ColorManager.textColor(6)
                : this.normalColor()
        );
        this.drawText(`Hour ${state.hour}`, textX, rect.y, textWidth, 'right');
        this.resetTextColor();

        const variant = state.cursed ? 'Cursed' : 'Friendly';
        if (state.cursed) {
            this.changeTextColor('#ffb0b0');
        }
        this.drawText(`${getTypeLabel(state.type)} • ${variant}`, textX, secondLineY, textWidth);
        this.resetTextColor();
    };

    window.Window_CabbyCodesDoorQueueSlots = Window_CabbyCodesDoorQueueSlots;

    function Window_CabbyCodesDoorSlotActions() {
        this.initialize(...arguments);
    }

    Window_CabbyCodesDoorSlotActions.prototype = Object.create(Window_Command.prototype);
    Window_CabbyCodesDoorSlotActions.prototype.constructor = Window_CabbyCodesDoorSlotActions;

    Window_CabbyCodesDoorSlotActions.prototype.initialize = function(rect) {
        this._draft = null;
        Window_Command.prototype.initialize.call(this, rect);
    };

    // Keep the same draft object the scene mutates; rebuild keeps the selected
    // command index stable so toggling a label doesn't jump the cursor away.
    Window_CabbyCodesDoorSlotActions.prototype.setDraft = function(draft) {
        this._draft = draft || null;
        const previous = this.index();
        this.clearCommandList();
        this.makeCommandList();
        this.refresh();
        const max = this.maxItems();
        this.select(previous >= 0 && previous < max ? previous : 0);
    };

    Window_CabbyCodesDoorSlotActions.prototype.makeCommandList = function() {
        const draft = this._draft;
        if (!draft) {
            return;
        }
        if (!draft.filled || draft.id <= 0) {
            this.addCommand('Fill Slot', 'reassign');
            this.addCommand('Accept', 'accept');
            this.addCommand('Cancel', 'cancel');
            return;
        }
        this.addCommand('Reassign Visitor', 'reassign');
        if (draftCanBeCursed(draft)) {
            this.addCommand(draft.cursed ? 'Make Friendly' : 'Make Cursed', 'variant');
        }
        this.addCommand('Set Hour', 'hour');
        this.addCommand('Clear Slot', 'clear');
        this.addCommand('Accept', 'accept');
        this.addCommand('Cancel', 'cancel');
    };

    window.Window_CabbyCodesDoorSlotActions = Window_CabbyCodesDoorSlotActions;

    function Window_CabbyCodesDoorHourInput() {
        this.initialize(...arguments);
    }

    Window_CabbyCodesDoorHourInput.prototype = Object.create(Window_Selectable.prototype);
    Window_CabbyCodesDoorHourInput.prototype.constructor = Window_CabbyCodesDoorHourInput;

    Window_CabbyCodesDoorHourInput.prototype.initialize = function(rect) {
        Window_Selectable.prototype.initialize.call(this, rect);
        this._hour = 12;
        this.refresh();
        this.select(0);
    };

    Window_CabbyCodesDoorHourInput.prototype.maxCols = function() {
        return 1;
    };

    Window_CabbyCodesDoorHourInput.prototype.maxItems = function() {
        return 1;
    };

    Window_CabbyCodesDoorHourInput.prototype.setHour = function(hour) {
        this._hour = clampDoorHour(hour);
        this.refresh();
    };

    Window_CabbyCodesDoorHourInput.prototype.hour = function() {
        return this._hour;
    };

    Window_CabbyCodesDoorHourInput.prototype.cursorRight = function() {
        const next = clampDoorHour(this._hour + 1);
        if (next !== this._hour) {
            this._hour = next;
            this.refresh();
            if (typeof SoundManager !== 'undefined' && typeof SoundManager.playCursor === 'function') {
                SoundManager.playCursor();
            }
        }
    };

    Window_CabbyCodesDoorHourInput.prototype.cursorLeft = function() {
        const next = clampDoorHour(this._hour - 1);
        if (next !== this._hour) {
            this._hour = next;
            this.refresh();
            if (typeof SoundManager !== 'undefined' && typeof SoundManager.playCursor === 'function') {
                SoundManager.playCursor();
            }
        }
    };

    Window_CabbyCodesDoorHourInput.prototype.cursorDown = function() {};
    Window_CabbyCodesDoorHourInput.prototype.cursorUp = function() {};

    Window_CabbyCodesDoorHourInput.prototype.drawAllItems = function() {
        const rect = this.itemRectWithPadding(0);
        this.resetTextColor();
        this.drawText(`Knock hour:  ${this._hour}`, rect.x, rect.y, rect.width, 'center');
        this.changeTextColor(
            typeof ColorManager !== 'undefined' && typeof ColorManager.textColor === 'function'
                ? ColorManager.textColor(6)
                : this.normalColor()
        );
        const fontSize = this.contents.fontSize;
        this.contents.fontSize = Math.max(18, fontSize - 6);
        this.drawText('← / →  adjust   •   OK confirm', rect.x, rect.y + this.lineHeight(), rect.width, 'center');
        this.contents.fontSize = fontSize;
        this.resetTextColor();
    };

    window.Window_CabbyCodesDoorHourInput = Window_CabbyCodesDoorHourInput;

    if (typeof Game_Switches !== 'undefined' && Game_Switches.prototype) {
        CabbyCodes.override(
            Game_Switches.prototype,
            'setValue',
            function(switchId, value) {
                const numericId = Number(switchId);
                const becameFalse =
                    activeDoorExemption &&
                    numericId === doorKnockSwitchId &&
                    !value &&
                    this.value(numericId);

                const result = CabbyCodes.callOriginal(
                    Game_Switches.prototype,
                    'setValue',
                    this,
                    [switchId, value]
                );

                if (becameFalse) {
                    releaseDoorExemption();
                }

                return result;
            }
        );
    }

    CabbyCodes.log('[CabbyCodes] Doorbell module loaded');
})();

