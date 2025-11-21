//=============================================================================
// CabbyCodes Friendly Door Visitors
//=============================================================================
/*:
 * @target MZ
 * @plugindesc CabbyCodes - Prevent hostile door visitors when enabled
 * @author CabbyCodes
 * @help
 * Adds an Options menu toggle that removes the pool of cursed/hostile door
 * knock encounters. When enabled, the door encounter system will only schedule
 * non-hostile visitors by keeping the "allowed cursed encounters" variable
 * empty, while preserving the player's original data so it can be restored if
 * the option is turned off later.
 */

(() => {
    'use strict';

    if (typeof window.CabbyCodes === 'undefined') {
        console.warn('[CabbyCodes] Friendly Door Visitors requires CabbyCodes core.');
        return;
    }

    const settingKey = 'friendlyDoorVisitors';
    const DOOR_CURSED_VAR_ID = 168;
    const DEFAULT_CURSED_VISITORS = Object.freeze([49, 56, 59, 61, 68, 60]);
    const DOOR_POOL_VARIABLES = Object.freeze([
        { id: 164, label: 'trader pool', type: 0 },
        { id: 165, label: 'general pool', type: 1 },
        { id: 166, label: 'special pool', type: 2 },
        { id: 170, label: 'rare pool', type: 3 }
    ]);
    const DOOR_QUEUE_SLOTS = Object.freeze([
        { name: 'KnockEnc1', typeVar: 52, hourVar: 53, indexVar: 54 },
        { name: 'KnockEnc2', typeVar: 55, hourVar: 56, indexVar: 57 },
        { name: 'KnockEnc3', typeVar: 58, hourVar: 59, indexVar: 60 },
        { name: 'KnockEnc4', typeVar: 626, hourVar: 624, indexVar: 625 }
    ]);
    const DOOR_ACTIVE_ENCOUNTER_VAR_ID = 51;
    const DOOR_PENDING_RESULT_VAR_ID = 2;
    const DOOR_PENDING_TYPE_VAR_ID = 3;
    const EXCLUDED_VISITOR_IDS = Object.freeze([1]); // Troop #1 = TestDummy
    const DEFAULT_VISITOR_POOLS = Object.freeze({
        164: Object.freeze([50, 51, 52, 53, 54]),
        165: Object.freeze([57, 61, 49, 59, 71, 48, 64, 55]),
        166: Object.freeze([56, 58, 68, 60, 63]),
        170: Object.freeze([])
    });
    const KNOWN_VISITOR_IDS = Object.freeze(
        Array.from(
            new Set(
                Object.values(DEFAULT_VISITOR_POOLS)
                    .flat()
                    .filter(id => typeof id === 'number')
            )
        )
    );

    let pendingMode = null;
    let friendlyModeApplied = false;

    const logPrefix = '[CabbyCodes]';

    const hasGameVariables = () =>
        typeof $gameVariables !== 'undefined' && $gameVariables !== null;

    const hasGameSystem = () =>
        typeof $gameSystem !== 'undefined' && $gameSystem !== null;

    const cloneList = list => (Array.isArray(list) ? list.slice() : null);
    const knownVisitorSet = new Set(KNOWN_VISITOR_IDS);

    const normalizeVisitorId = value => {
        const numeric = Number(value);
        return Number.isFinite(numeric) ? numeric : null;
    };

    const isKnownVisitor = value =>
        Number.isFinite(value) && (knownVisitorSet.has(value) || value === 71);

    const isCursedVariant = value => Number.isFinite(value) && value >= 200;

    function ensureBackup(sourceList) {
        if (!hasGameSystem()) {
            return;
        }

        const backup = $gameSystem._cabbycodesDoorCursedBackup;
        if (backup && backup._cabbycodesActive) {
            return;
        }

        $gameSystem._cabbycodesDoorCursedBackup = {
            _cabbycodesActive: true,
            list: cloneList(sourceList) ?? DEFAULT_CURSED_VISITORS.slice()
        };
    }

    function getBackup() {
        if (!hasGameSystem()) {
            return null;
        }

        const backup = $gameSystem._cabbycodesDoorCursedBackup;
        if (backup && backup._cabbycodesActive) {
            return cloneList(backup.list) ?? DEFAULT_CURSED_VISITORS.slice();
        }

        return null;
    }

    function clearBackup() {
        if (!hasGameSystem()) {
            return;
        }
        delete $gameSystem._cabbycodesDoorCursedBackup;
    }

    const isExcludedVisitor = value => {
        const numeric = normalizeVisitorId(value);
        return numeric !== null && EXCLUDED_VISITOR_IDS.includes(numeric);
    };

    function sanitizeDoorPools() {
        const removedSummaries = [];

        DOOR_POOL_VARIABLES.forEach(pool => {
            const current = $gameVariables.value(pool.id);
            if (!Array.isArray(current) || current.length === 0) {
                return;
            }

            const canonical = DEFAULT_VISITOR_POOLS[pool.id] || [];
            const canonicalSet =
                canonical.length > 0 ? new Set(canonical) : null;

            const normalizedEntries = [];
            const removedEntries = [];

            current.forEach(entry => {
                const normalized = normalizeVisitorId(entry);
                const shouldRemove =
                    normalized === null ||
                    isExcludedVisitor(normalized) ||
                    isCursedVariant(normalized) ||
                    (canonicalSet && !canonicalSet.has(normalized));

                if (shouldRemove) {
                    removedEntries.push(entry);
                } else {
                    normalizedEntries.push(normalized);
                }
            });

            let reseeded = false;
            if (normalizedEntries.length === 0 && canonical.length > 0) {
                normalizedEntries.push(
                    ...canonical.filter(id => !EXCLUDED_VISITOR_IDS.includes(id))
                );
                reseeded = true;
            }

            if (removedEntries.length === 0 && !reseeded) {
                return;
            }

            $gameVariables.setValue(pool.id, normalizedEntries);
            const detailParts = [];
            if (removedEntries.length > 0) {
                detailParts.push(`removed [${removedEntries.join(', ')}]`);
            }
            if (reseeded) {
                detailParts.push('reseeded defaults');
            }
            removedSummaries.push(`${pool.label}: ${detailParts.join(' + ')}`);
        });

        return removedSummaries;
    }

    function sanitizeDoorQueues() {
        const removedSummaries = [];

        const shouldRemoveVisitor = value => {
            const normalized = normalizeVisitorId(value);
            if (normalized === null || normalized <= 0) {
                return { remove: false };
            }
            if (
                isExcludedVisitor(normalized) ||
                isCursedVariant(normalized) ||
                !isKnownVisitor(normalized)
            ) {
                return { remove: true, loggedValue: normalized };
            }
            return { remove: false };
        };

        DOOR_QUEUE_SLOTS.forEach(slot => {
            const encounterValue = $gameVariables.value(slot.indexVar);
            const { remove, loggedValue } = shouldRemoveVisitor(encounterValue);
            if (!remove) {
                return;
            }

            $gameVariables.setValue(slot.indexVar, 0);
            $gameVariables.setValue(slot.typeVar, 0);
            $gameVariables.setValue(slot.hourVar, 0);
            removedSummaries.push(`${slot.name}:${loggedValue ?? 'unknown'}`);
        });

        const pendingValue = $gameVariables.value(DOOR_PENDING_RESULT_VAR_ID);
        const pendingResult = shouldRemoveVisitor(pendingValue);
        if (pendingResult.remove) {
            $gameVariables.setValue(DOOR_PENDING_RESULT_VAR_ID, 0);
            removedSummaries.push(`pending:${pendingResult.loggedValue ?? 'unknown'}`);
        }

        const activeValue = $gameVariables.value(DOOR_ACTIVE_ENCOUNTER_VAR_ID);
        const activeResult = shouldRemoveVisitor(activeValue);
        if (activeResult.remove) {
            $gameVariables.setValue(DOOR_ACTIVE_ENCOUNTER_VAR_ID, 0);
            removedSummaries.push(`active:${activeResult.loggedValue ?? 'unknown'}`);
        }

        return removedSummaries;
    }

    function sanitizeDoorData() {
        if (!hasGameVariables()) {
            return false;
        }

        const poolRemovals = sanitizeDoorPools();
        const queueRemovals = sanitizeDoorQueues();

        if (poolRemovals.length > 0 || queueRemovals.length > 0) {
            const details = [];
            if (poolRemovals.length > 0) {
                details.push(`pools [${poolRemovals.join('; ')}]`);
            }
            if (queueRemovals.length > 0) {
                details.push(`queues [${queueRemovals.join('; ')}]`);
            }
            CabbyCodes.log(
                `${logPrefix} Friendly door visitors removed excluded encounters -> ${details.join(
                    ' | '
                )}`
            );
        }

        return true;
    }

    function pickFriendlyVisitorFromPools() {
        if (!hasGameVariables()) {
            return null;
        }

        for (let i = 0; i < DOOR_POOL_VARIABLES.length; i += 1) {
            const pool = DOOR_POOL_VARIABLES[i];
            const entries = $gameVariables.value(pool.id);
            if (!Array.isArray(entries) || entries.length === 0) {
                continue;
            }

            const nextIndex = entries.findIndex(entry => {
                const normalized = normalizeVisitorId(entry);
                return (
                    normalized !== null &&
                    !isExcludedVisitor(normalized) &&
                    !isCursedVariant(normalized) &&
                    isKnownVisitor(normalized)
                );
            });

            if (nextIndex === -1) {
                continue;
            }

            const normalized = normalizeVisitorId(entries[nextIndex]);
            const updated = entries.slice();
            updated.splice(nextIndex, 1);
            $gameVariables.setValue(pool.id, updated);

            return {
                encounterId: normalized,
                type: typeof pool.type === 'number' ? pool.type : i
            };
        }

        return null;
    }

    function forceFriendlyVisitor(invalidatedId = null) {
        if (!hasGameVariables()) {
            return null;
        }

        sanitizeDoorData();

        let candidate = pickFriendlyVisitorFromPools();
        if (!candidate) {
            DOOR_POOL_VARIABLES.forEach(pool => {
                const canonical = DEFAULT_VISITOR_POOLS[pool.id] || [];
                if (canonical.length === 0) {
                    return;
                }
                const filtered = canonical.filter(
                    id =>
                        !EXCLUDED_VISITOR_IDS.includes(id) &&
                        !isCursedVariant(id)
                );
                if (filtered.length > 0) {
                    $gameVariables.setValue(pool.id, filtered.slice());
                }
            });
            candidate = pickFriendlyVisitorFromPools();
        }

        if (!candidate) {
            candidate = { encounterId: 71, type: 1 };
        }

        $gameVariables.setValue(DOOR_PENDING_RESULT_VAR_ID, candidate.encounterId);
        $gameVariables.setValue(DOOR_PENDING_TYPE_VAR_ID, candidate.type);

        CabbyCodes.log(
            `${logPrefix} Friendly door visitors supplied fallback encounter ${
                candidate.encounterId
            }${
                invalidatedId !== null
                    ? ` (replacing ${invalidatedId ?? 'unknown'})`
                    : ''
            }.`
        );

        return candidate;
    }

    function enforceFriendlyList() {
        if (!hasGameVariables()) {
            pendingMode = true;
            return false;
        }

        const currentList = $gameVariables.value(DOOR_CURSED_VAR_ID);
        ensureBackup(currentList);

        if (!Array.isArray(currentList) || currentList.length > 0) {
            $gameVariables.setValue(DOOR_CURSED_VAR_ID, []);
            CabbyCodes.log(
                `${logPrefix} Friendly door visitors active - disabled cursed encounter pool.`
            );
        }

        friendlyModeApplied = true;
        return true;
    }

    function restoreCursedList() {
        if (!friendlyModeApplied) {
            pendingMode = null;
            return true;
        }

        if (!hasGameVariables()) {
            pendingMode = false;
            return false;
        }

        const backup = getBackup() ?? DEFAULT_CURSED_VISITORS.slice();
        $gameVariables.setValue(DOOR_CURSED_VAR_ID, backup);

        clearBackup();
        friendlyModeApplied = false;
        CabbyCodes.log(
            `${logPrefix} Friendly door visitors disabled - restored original cursed encounter pool.`
        );
        return true;
    }

    function applyFriendlyMode(forceState = null) {
        const desiredState =
            typeof forceState === 'boolean'
                ? forceState
                : CabbyCodes.getSetting(settingKey, false);

        const succeeded = desiredState ? enforceFriendlyList() : restoreCursedList();

        if (succeeded && desiredState) {
            sanitizeDoorData();
        }

        if (!succeeded) {
            pendingMode = desiredState;
        } else {
            pendingMode = null;
        }

        return succeeded;
    }

    function scheduleApply() {
        if (pendingMode === null) {
            pendingMode = CabbyCodes.getSetting(settingKey, false);
        }
        applyFriendlyMode(pendingMode);
    }

    CabbyCodes.registerSetting(
        settingKey,
        'Friendly Door Visitors',
        {
            defaultValue: false,
            order: 100
        },
        newValue => {
            applyFriendlyMode(newValue);
            CabbyCodes.log(
                `${logPrefix} Friendly door visitors ${newValue ? 'enabled' : 'disabled'}`
            );
        }
    );

    if (typeof DataManager !== 'undefined') {
        ['setupNewGame', 'loadGame'].forEach(methodName => {
            if (typeof DataManager[methodName] === 'function') {
                CabbyCodes.after(DataManager, methodName, scheduleApply);
            }
        });
    }

    function ensureFriendlyGrabResult() {
        if (!CabbyCodes.getSetting(settingKey, false)) {
            return;
        }

        if (!hasGameVariables()) {
            return;
        }

        const encounterValue = $gameVariables.value(DOOR_PENDING_RESULT_VAR_ID);
        const encounterId = normalizeVisitorId(encounterValue);

        if (
            encounterId === null ||
            isExcludedVisitor(encounterId) ||
            isCursedVariant(encounterId) ||
            !isKnownVisitor(encounterId)
        ) {
            forceFriendlyVisitor(encounterId);
        }
    }

    let grabDoorEncounterPatched = false;

    function tryPatchGrabDoorEncounter() {
        if (grabDoorEncounterPatched) {
            return;
        }
        if (typeof window.grabDoorEncounter !== 'function') {
            return;
        }
        CabbyCodes.after(window, 'grabDoorEncounter', ensureFriendlyGrabResult);
        grabDoorEncounterPatched = true;
    }

    if (typeof window.setupDoorEncounters === 'function') {
        CabbyCodes.after(window, 'setupDoorEncounters', () => {
            if (CabbyCodes.getSetting(settingKey, false)) {
                const enforced = enforceFriendlyList();
                if (enforced) {
                    sanitizeDoorData();
                }
            }
            tryPatchGrabDoorEncounter();
        });
    } else {
        CabbyCodes.warn(
            `${logPrefix} Friendly Door Visitors could not find setupDoorEncounters(); hostile visitors may still appear.`
        );
        tryPatchGrabDoorEncounter();
    }

    applyFriendlyMode();
    tryPatchGrabDoorEncounter();

    CabbyCodes.log('[CabbyCodes] Friendly Door Visitors module loaded');
})();


