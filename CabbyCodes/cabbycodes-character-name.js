//=============================================================================
// CabbyCodes Change Character Name
//=============================================================================
/*:
 * @target MZ
 * @plugindesc CabbyCodes Change Character Name - Rename the player character.
 * @author CabbyCodes
 * @help
 * Adds a "Change Character Name" press option that opens the standard
 * RPG Maker name-input UI prefilled with actor 1's current name. Saving
 * writes the new name straight to actor 1 via Game_Actor.setName.
 *
 * The hint window above the editor calls out three special names the
 * base game branches on:
 *   - "Ash" / "Williams" / "evildead" - TunicateScripts.youAreAsh()
 *     bypasses the missing-arm Shotgun ban so actor 1 can equip the
 *     Shotgun even after losing an arm. Live-checked at every equip
 *     validation, so a mid-game rename takes effect immediately.
 *   - "Casanova" - unlocks the "smooch mode" branches that 94 troop
 *     encounters (Sybil, Shadow, Pierre, Vincent, Grinning Beast, ...)
 *     gate on switch 1199 (SmoochMode). The natural game only sets the
 *     persistent unlock switch 1194 (permaSmooch) inside Sybil's
 *     bus-crash intro on Map002, and TimePasses syncs 1199 from 1194
 *     each tick - so on a mid-game rename TimePasses might not run for
 *     a while (especially under Freeze Time, which blocks HourPassed /
 *     newDay), leaving 1199 stale. To make the cheat take effect
 *     immediately, the rename handler writes BOTH 1194 and 1199 ON
 *     directly when the new name contains "casanova". Neither switch
 *     is in the freeze-time pinned set so no exempt token is needed.
 *   - "lumpy" - Sybil's bus-crash intro on Map002 hands actor 1 a
 *     Straitjacket (armor 336) and equips it. One-shot intro, so this
 *     only fires on a new game with the rename in place beforehand.
 */

(() => {
    'use strict';

    if (typeof window.CabbyCodes === 'undefined') {
        console.warn('[CabbyCodes] Change Character Name requires CabbyCodes core.');
        return;
    }

    const SETTING_KEY = 'changeCharacterName';
    const LOG_PREFIX = '[CabbyCodes][CharacterName]';
    const PLAYER_ACTOR_ID = 1;
    const MAX_NAME_LENGTH = 16;

    // System.json switches: 1194 permaSmooch (persistent unlock,
    // naturally set only inside the Map002 bus-crash intro), 1199
    // SmoochMode (runtime gate that 94 Troops branch on; TimePasses
    // syncs it from 1194). Writing both ourselves bypasses the
    // intro-only gate and the TimePasses sync delay (which Freeze Time
    // blocks via the HourPassed/newDay suppressor).
    const PERMASMOOCH_SWITCH = 1194;
    const SMOOCHMODE_SWITCH = 1199;
    const CASANOVA_TOKEN = 'casanova';

    const HINT_LINES = [
        'Rename your character.',
        'Special names:',
        '  "Ash" - lets you equip the Shotgun even with a missing arm',
        '  "Casanova" - unlocks smooch/kiss dialog branches with many NPCs',
        '  "lumpy" - gives and equips a Straitjacket (new game only)'
    ];

    // Layout budget at Graphics.boxHeight = 624: a 5-line hint at default
    // lineHeight (204px) plus the standard Scene_Name face (144px) and 9
    // keyboard rows at default Window_Selectable itemHeight 44 (lineHeight
    // 36 + 8 row pad) overflows the screen and clips the OK row off the
    // bottom. Drop the (unused) button area at the top (~52px), shrink
    // the face to 96, and tighten the keyboard's per-row height to 28px
    // so all 9 rows fit on one page (no cursor-driven scrolling) with a
    // small bottom margin.
    const FACE_SIZE = 96;
    const INPUT_ITEM_HEIGHT = 28;
    const SCENE_GAP = 8;

    CabbyCodes.registerSetting(SETTING_KEY, 'Change Character Name', {
        defaultValue: 0,
        order: 40,
        formatValue: () => 'Press',
        onActivate: () => {
            openNameScene();
            return true;
        }
    });

    function isSessionReady() {
        if (typeof $gameActors === 'undefined' || !$gameActors) {
            return false;
        }
        if (typeof CabbyCodes.isGameSessionActive === 'function' && !CabbyCodes.isGameSessionActive()) {
            return false;
        }
        const actor = $gameActors.actor(PLAYER_ACTOR_ID);
        return Boolean(actor);
    }

    function openNameScene() {
        if (!isSessionReady()) {
            CabbyCodes.warn(`${LOG_PREFIX} Picker blocked: no active session or actor.`);
            if (typeof SoundManager !== 'undefined') {
                SoundManager.playBuzzer();
            }
            return;
        }
        if (typeof SceneManager === 'undefined' || typeof Scene_CabbyCodesCharacterName === 'undefined') {
            CabbyCodes.warn(`${LOG_PREFIX} SceneManager or name scene unavailable.`);
            return;
        }
        SceneManager.push(Scene_CabbyCodesCharacterName);
        if (typeof SceneManager.prepareNextScene === 'function') {
            SceneManager.prepareNextScene(PLAYER_ACTOR_ID, MAX_NAME_LENGTH);
        }
    }

    //----------------------------------------------------------------------
    // Scene_CabbyCodesCharacterName
    //----------------------------------------------------------------------
    function Scene_CabbyCodesCharacterName() {
        this.initialize(...arguments);
    }

    Scene_CabbyCodesCharacterName.prototype = Object.create(Scene_Name.prototype);
    Scene_CabbyCodesCharacterName.prototype.constructor = Scene_CabbyCodesCharacterName;

    // Scene_Base defaults isBottomHelpMode to true, which puts the help
    // window at the bottom and lets Scene_Name's edit/input rects (which
    // center against full Graphics.boxHeight) overlap it. Force the help
    // window to the top so our re-laid-out edit/input rects sit beneath
    // it without being covered.
    Scene_CabbyCodesCharacterName.prototype.isBottomHelpMode = function() {
        return false;
    };

    // No cancel button - keyboard cancel still works - so we can reclaim
    // the 52px the button area would otherwise reserve at the top.
    Scene_CabbyCodesCharacterName.prototype.buttonAreaHeight = function() {
        return 0;
    };

    Scene_CabbyCodesCharacterName.prototype.needsCancelButton = function() {
        return false;
    };

    Scene_CabbyCodesCharacterName.prototype.helpAreaHeight = function() {
        return this.calcWindowHeight(HINT_LINES.length, false);
    };

    Scene_CabbyCodesCharacterName.prototype.create = function() {
        Scene_MenuBase.prototype.create.call(this);
        this._actor = $gameActors.actor(this._actorId);
        this.createHelpWindow();
        this._helpWindow.setText(HINT_LINES.join('\n'));
        this.createEditWindow();
        this.createInputWindow();
    };

    // Window_NameEdit normally renders a 144x144 face via drawActorFace
    // with no size args. Re-implement refresh on the instance to draw a
    // smaller face and override faceWidth so the name string centers
    // against the new layout.
    Scene_CabbyCodesCharacterName.prototype.createEditWindow = function() {
        Scene_Name.prototype.createEditWindow.call(this);
        const editWindow = this._editWindow;
        editWindow.faceWidth = function() { return FACE_SIZE; };
        editWindow.refresh = function() {
            this.contents.clear();
            this.drawActorFace(this._actor, 0, 0, FACE_SIZE, FACE_SIZE);
            for (let i = 0; i < this._maxLength; i += 1) {
                this.drawUnderline(i);
            }
            for (let j = 0; j < this._name.length; j += 1) {
                this.drawChar(j);
            }
            const rect = this.itemRect(this._index);
            this.setCursorRect(rect.x, rect.y, rect.width, rect.height);
        };
        editWindow.refresh();
    };

    // Window_NameInput is a 9-row Window_Selectable. Override itemHeight
    // (NOT lineHeight) on the instance: Window_Selectable.itemHeight
    // returns lineHeight + 8 row pad, so a lineHeight override alone
    // leaves the row pitch at 36+8=44 and the 9 rows overflow the
    // 252-px inner area, triggering cursor-driven scrolling that hides
    // the top rows when the cursor moves to the OK row. Resizing via
    // move() also re-runs createContents only if the size actually
    // changed, but our inputWindowRect already returned the target
    // height so the bitmap is already correct - the explicit refresh
    // here just repaints items at the new row pitch.
    Scene_CabbyCodesCharacterName.prototype.createInputWindow = function() {
        Scene_Name.prototype.createInputWindow.call(this);
        const inputWindow = this._inputWindow;
        inputWindow.itemHeight = function() { return INPUT_ITEM_HEIGHT; };
        inputWindow.refresh();
        inputWindow.updateCursor();
    };

    Scene_CabbyCodesCharacterName.prototype.editWindowRect = function() {
        const padding = $gameSystem.windowPadding();
        const ww = 600;
        const wh = FACE_SIZE + padding * 2;
        const wx = (Graphics.boxWidth - ww) / 2;
        const wy = this.helpAreaTop() + this.helpAreaHeight();
        return new Rectangle(wx, wy, ww, wh);
    };

    Scene_CabbyCodesCharacterName.prototype.inputWindowRect = function() {
        const padding = $gameSystem.windowPadding();
        const wx = this._editWindow.x;
        const wy = this._editWindow.y + this._editWindow.height + SCENE_GAP;
        const ww = this._editWindow.width;
        const wh = 9 * INPUT_ITEM_HEIGHT + padding * 2;
        return new Rectangle(wx, wy, ww, wh);
    };

    Scene_CabbyCodesCharacterName.prototype.onInputOk = function() {
        const newName = this._editWindow.name();
        Scene_Name.prototype.onInputOk.call(this);
        CabbyCodes.log(`${LOG_PREFIX} Renamed actor ${this._actorId}.`);
        activateSmoochModeIfNamedCasanova(newName);
    };

    function activateSmoochModeIfNamedCasanova(name) {
        if (typeof name !== 'string' || !name.toLowerCase().includes(CASANOVA_TOKEN)) {
            return;
        }
        if (typeof $gameSwitches === 'undefined' || !$gameSwitches) {
            return;
        }
        const wasPerma = Boolean($gameSwitches.value(PERMASMOOCH_SWITCH));
        const wasMode = Boolean($gameSwitches.value(SMOOCHMODE_SWITCH));
        $gameSwitches.setValue(PERMASMOOCH_SWITCH, true);
        $gameSwitches.setValue(SMOOCHMODE_SWITCH, true);
        if (!wasPerma || !wasMode) {
            CabbyCodes.warn(
                `${LOG_PREFIX} Casanova name detected: switches `
                    + `${PERMASMOOCH_SWITCH} (permaSmooch) + ${SMOOCHMODE_SWITCH} (SmoochMode) ON.`
            );
        }
    }

    window.Scene_CabbyCodesCharacterName = Scene_CabbyCodesCharacterName;

    CabbyCodes.log('[CabbyCodes] Change Character Name module loaded');
})();
