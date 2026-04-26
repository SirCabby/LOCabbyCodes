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
    const logPrefix = '[CabbyCodes]';
    const doorKnockSwitchId = 24;
    const doorBattlerPrefix = 'DoorEncs/';

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
    const DOOR_CURSED_VAR_ID = 168;

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

    function isHostileDoorVisitor(encounterId, rawValue = encounterId) {
        const normalized = readNumber(encounterId);
        if (!Number.isFinite(normalized)) {
            return false;
        }
        if (Number.isFinite(rawValue) && rawValue >= 200) {
            return true;
        }
        const cursedList =
            typeof $gameVariables !== 'undefined' && $gameVariables
                ? $gameVariables.value(DOOR_CURSED_VAR_ID)
                : null;
        return (
            Array.isArray(cursedList) &&
            cursedList.some(value => normalizeEncounterId(value) === normalized)
        );
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
        const hostile = isHostileDoorVisitor(entry.id, rawValue);
        const descriptor = {
            id: entry.id,
            name: getVisitorName(entry.id),
            type,
            detail: '',
            subtext: '',
            helpText: '',
            source,
            sourceLabel: null,
            isHostile: hostile,
            thumbnail: getVisitorThumbnail(entry.id)
        };

        if (source === 'queue') {
            const hourText =
                entry.hour && entry.hour > 0
                    ? `Scheduled hour ${entry.hour}`
                    : 'Ready immediately';
            descriptor.detail = `${entry.slot.name} • ${typeLabel}`;
            descriptor.subtext = hourText;
            descriptor.helpText = `Pulls the queued visitor "${descriptor.name}" (${typeLabel}) immediately and clears ${entry.slot.name}.`;
            descriptor.slot = entry.slot;
            descriptor.sourceLabel = entry.slot.name;
            return descriptor;
        }

        if (source === 'pool') {
            descriptor.detail = `${entry.poolLabel} • ${typeLabel}`;
            descriptor.subtext = `Position ${entry.poolIndex + 1} in pool`;
            descriptor.helpText = `Consumes "${descriptor.name}" from ${entry.poolLabel} so they knock right now.`;
            descriptor.poolVarId = entry.poolVarId;
            descriptor.sourceLabel = entry.poolLabel;
            return descriptor;
        }

        descriptor.detail = `${typeLabel} • Forced visit`;
        descriptor.subtext = 'Not in current pools';
        descriptor.helpText = `Forces "${descriptor.name}" to knock even if unavailable. Pools remain unchanged.`;
        descriptor.sourceLabel = 'Forced';
        return descriptor;
    }

    function appendHostileLabel(descriptor) {
        if (!descriptor || !descriptor.isHostile) {
            return descriptor;
        }
        descriptor.detail = descriptor.detail ? `${descriptor.detail} • Hostile` : 'Hostile';
        descriptor.helpText = `${descriptor.helpText || ''} Hostile visitors may start combat.`.trim();
        return descriptor;
    }

    function buildDoorVisitorCatalog() {
        if (!hasGameObjects()) {
            return { available: [], unavailable: [] };
        }

        ensureDoorPoolsInitialized();

        const availableEntries = [];
        const availableIdSet = new Set();

        const queueEntries = gatherQueueEntries();
        queueEntries.sort((a, b) => a.hour - b.hour);
        queueEntries.forEach(entry => {
            const descriptor = appendHostileLabel(createEntryDescriptor(entry, 'queue'));
            availableEntries.push(descriptor);
            availableIdSet.add(entry.id);
        });

        const poolEntries = gatherPoolEntries();
        poolEntries.forEach(entry => {
            if (availableIdSet.has(entry.id)) {
                return;
            }
            const descriptor = appendHostileLabel(createEntryDescriptor(entry, 'pool'));
            availableEntries.push(descriptor);
            availableIdSet.add(entry.id);
        });

        const unavailableEntries = [];
        const knownIds = collectKnownDoorVisitorIds();
        knownIds.forEach(id => {
            const normalized = normalizeEncounterId(id);
            if (
                normalized <= 0 ||
                availableIdSet.has(normalized) ||
                EXCLUDED_VISITOR_IDS.includes(normalized)
            ) {
                return;
            }
            unavailableEntries.push(
                appendHostileLabel(createEntryDescriptor({ id: normalized, rawValue: id }, 'unavailable'))
            );
        });

        unavailableEntries.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

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

        activateDoorVisitor({
            encounterId: entry.id,
            encounterType: entry.type,
            slot: entry.slot || null,
            sourceLabel: entry.sourceLabel || null
        });

        return { success: true, message: `${entry.name} is heading to your door.` };
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
        this.createHelpWindow();
        this.createCategoryWindow();
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
        this._listWindow.setHandler('pageup', this.onListCategoryCycle.bind(this, -1));
        this._listWindow.setHandler('pagedown', this.onListCategoryCycle.bind(this, 1));
        this.addWindow(this._listWindow);
    };

    Scene_CabbyCodesDoorVisitorSelect.prototype.refreshVisitorData = function() {
        this._catalog = buildDoorVisitorCatalog();
        this._listWindow.setCatalog(this._catalog);
        this._listWindow.setSubtypeFilter('available', this._currentSubtype.available);
        this._listWindow.setSubtypeFilter('unavailable', this._currentSubtype.unavailable);
        this._listWindow.setCategory(this._currentCategory);
        this._categoryWindow.setCounts(this._catalog);
        this._subtypeWindow.setCounts(computeSubtypeCounts(this._catalog));
        this._categoryWindow.selectSymbolByKey(this._currentCategory);
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
        if (this._helpWindow) {
            this._helpWindow.setText('Choose who knocks next and summon them immediately.');
        }
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
        this.popScene();
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
        this.resetTextColor();
        this.drawText(entry.name, textRect.x, textRect.y, textRect.width);
        this.changeTextColor(
            typeof ColorManager !== 'undefined' && typeof ColorManager.textColor === 'function'
                ? ColorManager.textColor(6)
                : this.normalColor()
        );
        this.drawText(entry.detail || '', textRect.x, textRect.y, textRect.width, 'right');
        this.resetTextColor();
        const secondLineY = Math.min(
            textRect.y + this.lineHeight() - 2,
            rect.y + rect.height - this.lineHeight()
        );
        this.drawText(entry.subtext || '', textRect.x, secondLineY, textRect.width);
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
    };

    Window_CabbyCodesDoorVisitorSubtype.prototype.windowHeight = function() {
        return this.fittingHeight(1);
    };

    Window_CabbyCodesDoorVisitorSubtype.prototype.maxCols = function() {
        return this._category === 'available' ? 6 : 5;
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
                      { name: 'Queue', symbol: 'queue' },
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

