//=============================================================================
// CabbyCodes Doorbell
//=============================================================================
/*:
 * @target MZ
 * @plugindesc CabbyCodes Doorbell - Instantly summon the next door visitor.
 * @author CabbyCodes
 * @help
 * Adds an Options menu action that immediately sends the next visitor to the
 * apartment door. The feature favors already scheduled knock encounters and
 * falls back to rolling a fresh visitor from the existing encounter pools.
 */

(() => {
    'use strict';

    if (typeof window.CabbyCodes === 'undefined') {
        console.warn('[CabbyCodes] Doorbell requires CabbyCodes core.');
        return;
    }

    const settingKey = 'sendNextDoorVisitor';
    const logPrefix = '[CabbyCodes]';

    const queueSlots = [
        { name: 'KnockEnc1', typeVar: 52, hourVar: 53, indexVar: 54 },
        { name: 'KnockEnc2', typeVar: 55, hourVar: 56, indexVar: 57 },
        { name: 'KnockEnc3', typeVar: 58, hourVar: 59, indexVar: 60 },
        { name: 'KnockEnc4', typeVar: 626, hourVar: 624, indexVar: 625 }
    ];

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

        $gameVariables.setValue(51, encounterId);
        $gameVariables.setValue(50, currentHour + 1);
        $gameVariables.setValue(67, encounterType || 0);

        $gameSwitches.setValue(24, true);

        if ($gameMessage && typeof $gameMessage.add === 'function') {
            $gameMessage.add('You hear a knock at the door...');
        }

        CabbyCodes.log(
            `${logPrefix} Summoned door visitor ${encounterId}${
                visitorInfo.slot ? ` from ${visitorInfo.slot.name}` : ' from encounter pool'
            }.`
        );
    }

    function sendNextDoorVisitor() {
        if (!hasGameObjects()) {
            CabbyCodes.warn(
                `${logPrefix} Door visitor summon requested before game state was ready.`
            );
            return false;
        }

        if ($gameSwitches.value(24)) {
            CabbyCodes.warn(`${logPrefix} Someone is already at the door.`);
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

    CabbyCodes.registerSetting(settingKey, 'Send Next Door Visitor', {
        defaultValue: false,
        order: 55,
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
    });

    CabbyCodes.log('[CabbyCodes] Doorbell module loaded');
})();


