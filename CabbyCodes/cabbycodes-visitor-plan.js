//=============================================================================
// CabbyCodes Visitor Plan
//=============================================================================
/*:
 * @target MZ
 * @plugindesc CabbyCodes Visitor Plan - Backs the "Visitor Plan" submenu of Story Flags. Per-astronomer "Asked About Killing the Visitor" toggle.
 * @author CabbyCodes
 * @help
 * Surfaces a "Visitor Plan" sub-section inside the Story Flags Quest States
 * picker. Story Flags reaches in via CabbyCodes.openVisitorPlanScene().
 *
 *   - One row per astronomer (Aster, Aurelius, Beryl, Jasper) showing
 *     Asked / Not Asked.
 *
 * Each astronomer's per-NPC dialog gate flips ON the first time the player
 * raises the kill question in their respective troop encounter:
 *   sw 1089 BerylKillIt       — "Maybe we can kill it." in Beryl's troop
 *                                (Troops.json ~108511..108537)
 *   sw 1090 AureliusKillIt    — "Why not kill it instead?" in Aurelius's
 *                                troop (Troops.json ~104413..104440)
 *   sw 1091 friendOrKill      — Aster's troop. The natural game uses ONE
 *                                switch for both Aster's "Maybe it's a
 *                                friend" and "Maybe we can kill it"
 *                                choices, so "Asked" here means "asked
 *                                Aster about kill-or-friend at all".
 *   sw 1092 askedJasperKillV  — "...I think I could kill it." in Jasper's
 *                                troop (Troops.json ~112952..112978)
 *
 * Each natural kill choice ALSO increments var 898 (chooseViolence). The
 * Exalted Four late-game dialog (CommonEvents.json ~123892..) gates the
 * "How do we kill the Visitor?" branch on var 898 >= 2.
 *
 * The Map261 ritual-circle "(Attack!)" choice (the actual end-game fight
 * trigger) is gated on switch 1098 `killThatTHing` instead of reading var
 * 898 directly. The natural game has a one-shot conditional inside the
 * ritual question event: when the player triggers it AND var 898 >= 4
 * AND switch 1100 `HardModePlaytest` is OFF, the conditional flips switch
 * 1098 ON and the "(Attack!)" choice becomes visible. A player who already
 * triggered that event with chooseViolence < 4 has switch 1098 stuck OFF —
 * bumping var 898 after the fact does NOT retroactively re-fire the
 * conditional, so the cheat would silently fail to enable attack.
 *
 * Flipping the fourth astronomer toggle ON here therefore writes BOTH:
 *   var 898 >= 4   (mirrors natural post-progression chooseViolence)
 *   switch 1098 ON (bypasses the one-shot natural conditional so the
 *                   "(Attack!)" choice shows on the next Map261 visit
 *                   regardless of when / whether the player triggered
 *                   the ritual question event)
 * Neither is decremented when astronomers are toggled back OFF — once the
 * kill path is unlocked it stays unlocked, matching the natural game where
 * the choice gate only checks switch 1098 and doesn't re-read the per-
 * astronomer switches or var 898.
 *
 * Cooperates with Freeze Time by acquiring an exempt-from-restore token
 * across writes. A WARN-level log line names each change so the diff is
 * easy to verify in CabbyCodes.log.
 */

(() => {
    'use strict';

    if (typeof window.CabbyCodes === 'undefined') {
        console.warn('[CabbyCodes] Visitor Plan requires CabbyCodes core.');
        return;
    }

    const LOG_PREFIX = '[CabbyCodes][VisitorPlan]';

    // Per-astronomer descriptors. switchId is the canonical "asked about
    // killing the Visitor" dialog gate the natural game flips ON the first
    // time the player raises the kill question in their troop encounter.
    // System.json switch names confirmed via line offset 362 (switch ID =
    // line - 362).
    const ASTRONOMERS = [
        { id: 'aster',    label: 'Aster',    switchId: 1091 }, // friendOrKill
        { id: 'aurelius', label: 'Aurelius', switchId: 1090 }, // AureliusKillIt
        { id: 'beryl',    label: 'Beryl',    switchId: 1089 }, // BerylKillIt
        { id: 'jasper',   label: 'Jasper',   switchId: 1092 }, // askedJasperKillV
    ];

    // chooseViolence: tracks "violent intent established" via the late-game
    // dialog gates. The natural game increments by 1 per kill choice across
    // the four astronomers, so 4 mirrors the post-progression value.
    const VAR_VIOLENCE = 898;
    const VIOLENCE_KILL_THRESHOLD = 4;

    // killThatTHing: gates the "(Attack!)" choice on the Map261 ritual
    // circle (Map261.json ~30797 and ~43225, both `(([!s[1098]]))(Attack!)`
    // — visible only when this switch is ON). The natural game flips it ON
    // inside a one-shot conditional inside the ritual question event when
    // var 898 >= 4 AND switch 1100 `HardModePlaytest` is OFF. We set it
    // directly so the choice is enabled regardless of whether/when the
    // player triggered the natural conditional.
    const SWITCH_KILL_VISITOR = 1098;

    const PICKER_WIDTH = 520;
    const PICKER_SPACING = 12;
    const PICKER_MAX_ROWS = 8;

    let _activeAstronomerId = null;

    function isSessionReady() {
        if (typeof $gameVariables === 'undefined' || !$gameVariables) {
            return false;
        }
        if (typeof $gameSwitches === 'undefined' || !$gameSwitches) {
            return false;
        }
        if (typeof CabbyCodes.isGameSessionActive === 'function' && !CabbyCodes.isGameSessionActive()) {
            return false;
        }
        return true;
    }

    function readVar(varId) {
        const raw = Number($gameVariables.value(varId));
        return Number.isFinite(raw) ? raw : 0;
    }

    function readSwitch(switchId) {
        return Boolean($gameSwitches.value(switchId));
    }

    function isAsked(astronomer) {
        return readSwitch(astronomer.switchId);
    }

    function findAstronomer(id) {
        return ASTRONOMERS.find(a => a.id === id) || null;
    }

    function countAsked() {
        return ASTRONOMERS.reduce((n, a) => n + (isAsked(a) ? 1 : 0), 0);
    }

    function summaryLine() {
        return `Asked ${countAsked()}/${ASTRONOMERS.length}`;
    }

    function withFreezeExemption(varIds, switchIds, fn) {
        const api = CabbyCodes.freezeTime;
        const token = (api && typeof api.exemptFromRestore === 'function')
            ? api.exemptFromRestore({ variables: varIds, switches: switchIds })
            : { release: () => {} };
        try {
            return fn();
        } finally {
            token.release();
        }
    }

    // Returns true if the scene was pushed; false if blocked. Story Flags
    // checks the return value to decide whether to re-activate its category
    // list (so the user is not stranded with no input focus when blocked).
    function openVisitorPlanScene() {
        if (!isSessionReady()) {
            CabbyCodes.warn(`${LOG_PREFIX} Picker blocked: no active session.`);
            SoundManager.playBuzzer();
            return false;
        }
        if (typeof SceneManager === 'undefined' || typeof Scene_CabbyCodesVisitorPlan === 'undefined') {
            CabbyCodes.warn(`${LOG_PREFIX} SceneManager or scene unavailable.`);
            return false;
        }
        SceneManager.push(Scene_CabbyCodesVisitorPlan);
        return true;
    }

    CabbyCodes.openVisitorPlanScene = openVisitorPlanScene;

    // Compact "asked/total" summary (e.g. "2/4") for the Quest States row
    // that hosts the Visitor Plan entry. Falls back to "?" when the session
    // isn't loaded so the row never reads as a misleading "0/4" before save
    // data is available.
    CabbyCodes.getVisitorPlanSummary = function() {
        if (!isSessionReady()) {
            return '?';
        }
        return `${countAsked()}/${ASTRONOMERS.length}`;
    };

    function openValuePickerFor(astronomer) {
        if (!isSessionReady()) {
            SoundManager.playBuzzer();
            return;
        }
        _activeAstronomerId = astronomer.id;
        SceneManager.push(Scene_CabbyCodesVisitorPlanValue);
    }

    //----------------------------------------------------------------------
    // Apply path
    //----------------------------------------------------------------------

    // Flip one astronomer's "asked" switch, then sync the late-game gates
    // (var 898 chooseViolence + switch 1098 killThatTHing) IFF all four
    // switches are ON post-apply. Neither is lowered when toggling back
    // OFF — see the file-header comment for rationale. All writes happen
    // under a single freeze-exemption token so the restore debounce doesn't
    // undo any of them mid-batch.
    function applyAsked(astronomer, wantAsked) {
        if (!isSessionReady()) {
            return false;
        }
        const oldAsked = isAsked(astronomer);
        const switchIds = ASTRONOMERS.map(a => a.switchId).concat([SWITCH_KILL_VISITOR]);
        return withFreezeExemption(
            [VAR_VIOLENCE],
            switchIds,
            () => {
                try {
                    $gameSwitches.setValue(astronomer.switchId, wantAsked);
                    let syncNote = '';
                    const allAsked = ASTRONOMERS.every(a => isAsked(a));
                    if (allAsked) {
                        const curVar = readVar(VAR_VIOLENCE);
                        const varNote = (curVar < VIOLENCE_KILL_THRESHOLD)
                            ? ((() => {
                                $gameVariables.setValue(VAR_VIOLENCE, VIOLENCE_KILL_THRESHOLD);
                                return `var ${VAR_VIOLENCE}=${VIOLENCE_KILL_THRESHOLD} (was ${curVar})`;
                            })())
                            : `var ${VAR_VIOLENCE}=${curVar} (already at gate)`;
                        const curKill = readSwitch(SWITCH_KILL_VISITOR);
                        const killNote = curKill
                            ? `sw ${SWITCH_KILL_VISITOR}=true (already on)`
                            : ((() => {
                                $gameSwitches.setValue(SWITCH_KILL_VISITOR, true);
                                return `sw ${SWITCH_KILL_VISITOR}=true (was false)`;
                            })());
                        syncNote = ` All four asked: ${varNote}, ${killNote}.`;
                    }
                    CabbyCodes.warn(`${LOG_PREFIX} ${astronomer.label} sw ${astronomer.switchId}: ${oldAsked} -> ${wantAsked}.${syncNote}`);
                    return true;
                } catch (error) {
                    CabbyCodes.error(`${LOG_PREFIX} Apply failed for ${astronomer.label}: ${error?.message || error}`);
                    return false;
                }
            }
        );
    }

    //----------------------------------------------------------------------
    // Shared helpers for scene layout
    //----------------------------------------------------------------------

    function pickerLayoutFor(scene, rowCount) {
        const width = Math.min(PICKER_WIDTH, Graphics.boxWidth - 32);
        const helpHeight = scene.calcWindowHeight(2, false);
        const listHeight = scene.calcWindowHeight(Math.min(Math.max(rowCount, 1), PICKER_MAX_ROWS), true);
        const totalHeight = helpHeight + PICKER_SPACING + listHeight;
        const x = Math.max(0, Math.floor((Graphics.boxWidth - width) / 2));
        const baseY = Math.max(0, Math.floor((Graphics.boxHeight - totalHeight) / 2));
        return { x, baseY, width, helpHeight, listHeight };
    }

    //----------------------------------------------------------------------
    // Scene_CabbyCodesVisitorPlan - top-level list (per-astronomer rows)
    //----------------------------------------------------------------------

    function Scene_CabbyCodesVisitorPlan() {
        this.initialize(...arguments);
    }

    Scene_CabbyCodesVisitorPlan.prototype = Object.create(Scene_MenuBase.prototype);
    Scene_CabbyCodesVisitorPlan.prototype.constructor = Scene_CabbyCodesVisitorPlan;

    Scene_CabbyCodesVisitorPlan.prototype.create = function() {
        Scene_MenuBase.prototype.create.call(this);
        this.createHelpWindow();
        this.createListWindow();
    };

    Scene_CabbyCodesVisitorPlan.prototype.createBackground = function() {
        Scene_MenuBase.prototype.createBackground.call(this);
        if (this._backgroundSprite) {
            this._backgroundSprite.opacity = 192;
        }
    };

    Scene_CabbyCodesVisitorPlan.prototype.createHelpWindow = function() {
        const layout = pickerLayoutFor(this, ASTRONOMERS.length);
        const rect = new Rectangle(layout.x, layout.baseY, layout.width, layout.helpHeight);
        this._helpWindow = new Window_Help(rect);
        this._helpWindow.setText(`Visitor Plan\n${summaryLine()} - asked about killing the Visitor`);
        this.addWindow(this._helpWindow);
    };

    Scene_CabbyCodesVisitorPlan.prototype.createListWindow = function() {
        const layout = pickerLayoutFor(this, ASTRONOMERS.length);
        const rect = new Rectangle(
            layout.x,
            layout.baseY + layout.helpHeight + PICKER_SPACING,
            layout.width,
            layout.listHeight
        );
        this._listWindow = new Window_CabbyCodesVisitorPlanList(rect);
        this._listWindow.setHandler('ok', this.onListOk.bind(this));
        this._listWindow.setHandler('cancel', this.onListCancel.bind(this));
        this.addWindow(this._listWindow);
        this._listWindow.select(0);
        this._listWindow.activate();
        this._listWindow.setHelpWindow(this._helpWindow);
    };

    Scene_CabbyCodesVisitorPlan.prototype.onListOk = function() {
        const ext = this._listWindow.currentExt();
        const astronomer = ASTRONOMERS[ext];
        if (!astronomer) {
            this._listWindow.activate();
            return;
        }
        openValuePickerFor(astronomer);
    };

    Scene_CabbyCodesVisitorPlan.prototype.onListCancel = function() {
        SceneManager.pop();
    };

    window.Scene_CabbyCodesVisitorPlan = Scene_CabbyCodesVisitorPlan;

    //----------------------------------------------------------------------
    // Window_CabbyCodesVisitorPlanList
    //----------------------------------------------------------------------

    function Window_CabbyCodesVisitorPlanList() {
        this.initialize(...arguments);
    }

    Window_CabbyCodesVisitorPlanList.prototype = Object.create(Window_Command.prototype);
    Window_CabbyCodesVisitorPlanList.prototype.constructor = Window_CabbyCodesVisitorPlanList;

    Window_CabbyCodesVisitorPlanList.prototype.makeCommandList = function() {
        ASTRONOMERS.forEach((astronomer, index) => {
            this.addCommand(astronomer.label, `astronomer_${astronomer.id}`, true, index);
        });
    };

    Window_CabbyCodesVisitorPlanList.prototype.numVisibleRows = function() {
        return Math.min(PICKER_MAX_ROWS, this.maxItems() || 1);
    };

    Window_CabbyCodesVisitorPlanList.prototype.drawItem = function(index) {
        const rect = this.itemLineRect(index);
        const ext = this._list[index] && this._list[index].ext;
        const astronomer = ASTRONOMERS[ext];
        if (!astronomer) {
            return;
        }
        const asked = isAsked(astronomer);
        const valueText = asked ? 'Asked' : 'Not Asked';
        const valueWidth = this.textWidth('Not Asked');
        const labelWidth = Math.max(0, rect.width - valueWidth - 8);
        this.changeTextColor(ColorManager.systemColor());
        this.drawText(astronomer.label, rect.x, rect.y, labelWidth, 'left');
        if (asked) {
            this.changeTextColor(ColorManager.powerUpColor());
        } else {
            this.resetTextColor();
        }
        this.drawText(valueText, rect.x + rect.width - valueWidth, rect.y, valueWidth, 'right');
        this.resetTextColor();
    };

    Window_CabbyCodesVisitorPlanList.prototype.updateHelp = function() {
        if (!this._helpWindow) {
            return;
        }
        const ext = this.currentExt();
        const astronomer = ASTRONOMERS[ext];
        if (!astronomer) {
            this._helpWindow.setText(`Visitor Plan\n${summaryLine()} - asked about killing the Visitor`);
            return;
        }
        const asked = isAsked(astronomer);
        this._helpWindow.setText(`${astronomer.label}  (sw ${astronomer.switchId})\nCurrent: ${asked ? 'Asked' : 'Not Asked'}    ${summaryLine()}`);
    };

    window.Window_CabbyCodesVisitorPlanList = Window_CabbyCodesVisitorPlanList;

    //----------------------------------------------------------------------
    // Scene_CabbyCodesVisitorPlanValue - per-astronomer value picker
    //----------------------------------------------------------------------

    function Scene_CabbyCodesVisitorPlanValue() {
        this.initialize(...arguments);
    }

    Scene_CabbyCodesVisitorPlanValue.prototype = Object.create(Scene_MenuBase.prototype);
    Scene_CabbyCodesVisitorPlanValue.prototype.constructor = Scene_CabbyCodesVisitorPlanValue;

    Scene_CabbyCodesVisitorPlanValue.prototype.activeAstronomer = function() {
        return findAstronomer(_activeAstronomerId);
    };

    Scene_CabbyCodesVisitorPlanValue.prototype.create = function() {
        Scene_MenuBase.prototype.create.call(this);
        this.createHelpWindow();
        this.createValueWindow();
    };

    Scene_CabbyCodesVisitorPlanValue.prototype.createBackground = function() {
        Scene_MenuBase.prototype.createBackground.call(this);
        if (this._backgroundSprite) {
            this._backgroundSprite.opacity = 192;
        }
    };

    Scene_CabbyCodesVisitorPlanValue.prototype.createHelpWindow = function() {
        const layout = pickerLayoutFor(this, 2);
        const rect = new Rectangle(layout.x, layout.baseY, layout.width, layout.helpHeight);
        this._helpWindow = new Window_Help(rect);
        const astronomer = this.activeAstronomer();
        if (astronomer) {
            const asked = isAsked(astronomer);
            this._helpWindow.setText(`${astronomer.label}\nCurrent: ${asked ? 'Asked' : 'Not Asked'}    ${summaryLine()}`);
        } else {
            this._helpWindow.setText('Visitor Plan\nNo astronomer selected.');
        }
        this.addWindow(this._helpWindow);
    };

    Scene_CabbyCodesVisitorPlanValue.prototype.createValueWindow = function() {
        const layout = pickerLayoutFor(this, 2);
        const rect = new Rectangle(
            layout.x,
            layout.baseY + layout.helpHeight + PICKER_SPACING,
            layout.width,
            layout.listHeight
        );
        this._valueWindow = new Window_CabbyCodesVisitorPlanValueList(rect);
        this._valueWindow.setHandler('ok', this.onValueOk.bind(this));
        this._valueWindow.setHandler('cancel', this.onValueCancel.bind(this));
        this.addWindow(this._valueWindow);
        const astronomer = this.activeAstronomer();
        // Pre-select the row matching the current state so a stray Enter
        // is a no-op apply rather than a state flip.
        this._valueWindow.select(astronomer && isAsked(astronomer) ? 1 : 0);
        this._valueWindow.activate();
    };

    Scene_CabbyCodesVisitorPlanValue.prototype.onValueOk = function() {
        const astronomer = this.activeAstronomer();
        const wantAsked = this._valueWindow.currentAskedFlag();
        if (astronomer && typeof wantAsked === 'boolean') {
            applyAsked(astronomer, wantAsked);
        }
        SceneManager.pop();
    };

    Scene_CabbyCodesVisitorPlanValue.prototype.onValueCancel = function() {
        SceneManager.pop();
    };

    window.Scene_CabbyCodesVisitorPlanValue = Scene_CabbyCodesVisitorPlanValue;

    //----------------------------------------------------------------------
    // Window_CabbyCodesVisitorPlanValueList - "Not Asked" / "Asked"
    //----------------------------------------------------------------------

    function Window_CabbyCodesVisitorPlanValueList() {
        this.initialize(...arguments);
    }

    Window_CabbyCodesVisitorPlanValueList.prototype = Object.create(Window_Command.prototype);
    Window_CabbyCodesVisitorPlanValueList.prototype.constructor = Window_CabbyCodesVisitorPlanValueList;

    Window_CabbyCodesVisitorPlanValueList.prototype.makeCommandList = function() {
        this.addCommand('Not Asked', 'value_off', true, 0);
        this.addCommand('Asked',     'value_on',  true, 1);
    };

    Window_CabbyCodesVisitorPlanValueList.prototype.numVisibleRows = function() {
        return 2;
    };

    Window_CabbyCodesVisitorPlanValueList.prototype.currentAskedFlag = function() {
        const ext = this.currentExt();
        if (ext === 1) return true;
        if (ext === 0) return false;
        return null;
    };

    window.Window_CabbyCodesVisitorPlanValueList = Window_CabbyCodesVisitorPlanValueList;

    CabbyCodes.log('[CabbyCodes] Visitor Plan module loaded');
})();
