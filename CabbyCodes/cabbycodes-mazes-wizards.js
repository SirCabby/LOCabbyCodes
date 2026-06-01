//=============================================================================
// CabbyCodes Mazes and Wizards Replay
//=============================================================================
/*:
 * @target MZ
 * @plugindesc CabbyCodes Replay Mazes and Wizards - Removes Lyle's once-per-day limit on the tabletop sessions.
 * @author CabbyCodes
 * @help
 * Lyle's "Mazes and Wizards" tabletop quest can normally only be played once
 * per in-game day. The daily gate is switch 1001 (`playedMazesAndWizards`):
 *
 *   - CE 6 (newDay) clears switch 1001 each morning.
 *   - CE 239 (MWCore) sets switch 1001 ON as part of starting a session.
 *   - CE 231 (-MWEntryPoint-) refuses with Lyle's "I need time to prepare our
 *     next session. C-come back tomorrow, okay?" line whenever switch 1001 is
 *     already ON.
 *
 * When this cheat is on we keep switch 1001 from ever latching ON, so the
 * entry-point check always falls through to the play branch and the player
 * can run as many sessions as they like in a single day. Toggling the cheat
 * on mid-session also clears the flag immediately, so a "played today" state
 * from earlier in the day is lifted right away.
 *
 * Only the daily gate reads switch 1001 (verified against CommonEvents.json:
 * newDay / MWCore / -MWEntryPoint- are its only consumers), so suppressing it
 * has no other side effects. Quest progression itself is tracked by var 701
 * (`sessionNb`), which we never touch.
 */

(() => {
    'use strict';

    if (typeof window.CabbyCodes === 'undefined') {
        console.warn('[CabbyCodes] Replay Mazes and Wizards requires CabbyCodes core.');
        return;
    }

    const LOG_PREFIX = '[CabbyCodes][MazesWizards]';

    // The once-per-day gate flag. newDay (CE 6) clears it, MWCore (CE 239)
    // sets it ON, and -MWEntryPoint- (CE 231) blocks replaying while it is ON.
    const PLAYED_TODAY_SWITCH = 1001;

    const settingKey = 'replayMazesWizards';

    CabbyCodes.registerSetting(
        settingKey,
        'Replay Mazes and Wizards',
        {
            defaultValue: false,
            order: 165
        },
        (newValue) => {
            CabbyCodes.log(`${LOG_PREFIX} ${newValue ? 'enabled' : 'disabled'}`);
            // If the player already played today, lift the gate right away so
            // they don't have to wait for the next session start to take hold.
            if (newValue) {
                clearPlayedTodayFlag();
            }
        }
    );

    const isEnabled = () => CabbyCodes.getSetting(settingKey, false);

    function isSessionActive() {
        return typeof CabbyCodes.isGameSessionActive !== 'function'
            || CabbyCodes.isGameSessionActive();
    }

    function clearPlayedTodayFlag() {
        if (typeof $gameSwitches === 'undefined' || !$gameSwitches) {
            return;
        }
        if (!isSessionActive()) {
            return;
        }
        if ($gameSwitches.value(PLAYED_TODAY_SWITCH)) {
            // setValue(false) passes straight through our own override below
            // (we only intercept truthy writes), so this lands as a normal OFF.
            $gameSwitches.setValue(PLAYED_TODAY_SWITCH, false);
            CabbyCodes.log(`${LOG_PREFIX} Cleared "played today" gate (switch ${PLAYED_TODAY_SWITCH}).`);
        }
    }

    // Keep switch 1001 from ever latching ON while the cheat is active. Another
    // module (doorbell) also patches Game_Switches.setValue, so go through the
    // chain-safe callOriginal rather than touching the prototype directly.
    if (typeof Game_Switches !== 'undefined' && Game_Switches.prototype) {
        CabbyCodes.override(
            Game_Switches.prototype,
            'setValue',
            function (switchId, value) {
                if (isEnabled() && Number(switchId) === PLAYED_TODAY_SWITCH && value) {
                    return CabbyCodes.callOriginal(
                        Game_Switches.prototype,
                        'setValue',
                        this,
                        [switchId, false]
                    );
                }
                return CabbyCodes.callOriginal(
                    Game_Switches.prototype,
                    'setValue',
                    this,
                    [switchId, value]
                );
            }
        );
    }

    CabbyCodes.log('[CabbyCodes] Replay Mazes and Wizards module loaded');
})();
