//=============================================================================
// CabbyCodes Sewer Kids
//=============================================================================
/*:
 * @target MZ
 * @plugindesc CabbyCodes Sewer Kids - Backs the "Sewer Kids" submenu of Story Flags. Per-kid Saved / Not Saved toggle for David's sewer-rescue quest, plus overall quest progress.
 * @author CabbyCodes
 * @help
 * Surfaces a "Sewer Kids" sub-section inside the Story Flags categories
 * picker. Story Flags reaches in via CabbyCodes.openSewerKidsScene().
 *
 *   - Top action row: "Set all kids to..." opens a Save All / Reset All
 *     bulk picker.
 *   - One row per kid (10 total) showing Saved / Not Saved.
 *
 * Each kid has an individual `savedKid*` switch (770..779). Six paired
 * troop encounters share an "encountered" variable (725..731) that the
 * cheat keeps in sync: setting any kid in a paired group to Saved bumps
 * the shared var to 1; setting both kids in the pair to Not Saved drops
 * it back to 0. `sewerKidsTotal` (var 724) is recomputed from the
 * counting troop groups (1..6 — Roxie's Service Dog group does not
 * increment in the natural game), and `sewerKidsReported` (var 723) is
 * kept equal to var 724 so David's "any news?" reward gate sees the
 * current saved count as already reported. The natural game's
 * `Misc_SewerKids` achievement is granted via a `setAchievement(...)`
 * script call inside David's all-back dialog, NOT via a switch flip,
 * so the cheat doesn't try to award it from here — visiting David
 * after using the cheat produces a no-op (var 723 catches up var 724
 * mid-cheat-write so the natural reward branch doesn't fire either).
 * Players who want the achievement should save at least one of the
 * six counting troop groups by playing through the natural rescue
 * dialog: that path bumps var 724 without touching var 723, reopening
 * the gap David's all-back conditional needs.
 *
 * Cooperates with Freeze Time by acquiring an exempt-from-restore token
 * across writes (these vars/switches aren't in the freeze set today, but
 * mirroring the story-flags pattern keeps us safe if the freeze snapshot
 * ever grows). A WARN-level log line names each change so the diff is
 * easy to verify in CabbyCodes.log.
 */

(() => {
    'use strict';

    if (typeof window.CabbyCodes === 'undefined') {
        console.warn('[CabbyCodes] Sewer Kids requires CabbyCodes core.');
        return;
    }

    const LOG_PREFIX = '[CabbyCodes][SewerKids]';

    // Per-kid descriptors. `switchId` is the canonical "this kid is saved"
    // switch flipped at the end of their natural rescue dialog. `varId` is
    // the SewerKids_* "troop encountered" variable — paired troops share a
    // single var (Thomas+Coralie share 726, Florence+Victor share 727,
    // Tristan+Charlie share 729). `troopGroup` collapses paired kids into
    // one bucket so var 724 (`sewerKidsTotal`) — which the natural game
    // increments once per troop completion regardless of how many kids
    // are in that troop — recomputes to the right number.
    //
    // Kid name <-> switch verified by reading each troop's accept-branch
    // dialog in Troops.json: the speaker's portrait line matches the kid
    // claiming the in-game name David rattles off (Oliver/Victor/Florence/
    // Coralie/Thomas/Zachary/Roxie/Alice/Tristan/Charlie).
    //
    // troopGroup 7 (Roxie / Service Dog) does not increment var 724 in
    // the natural game — Roxie's troop only sets switch 778 — so it's
    // excluded from COUNTING_TROOP_GROUPS. The natural game also gates
    // Zachary's accept-branch on switch 778 ON (Roxie must be saved
    // first), but the cheat applies switches directly and intentionally
    // doesn't enforce that prerequisite — toggling Zachary alone is
    // allowed and just produces a state the natural game can't reach.
    const SEWER_KIDS = [
        { id: 'alice',    label: 'Alice (Fly Kid)',         switchId: 770, varId: 725, troopGroup: 1 },
        { id: 'thomas',   label: 'Thomas (Eyestalk Kid)',   switchId: 771, varId: 726, troopGroup: 2 },
        { id: 'coralie',  label: 'Coralie (Cosmo Kid)',     switchId: 775, varId: 726, troopGroup: 2 },
        { id: 'florence', label: 'Florence (Eyeball Kid)',  switchId: 773, varId: 727, troopGroup: 3 },
        { id: 'victor',   label: 'Victor (Game Kid)',       switchId: 774, varId: 727, troopGroup: 3 },
        { id: 'oliver',   label: 'Oliver (Spooky Kid)',     switchId: 772, varId: 728, troopGroup: 4 },
        { id: 'tristan',  label: 'Tristan (Tentacles Kid)', switchId: 776, varId: 729, troopGroup: 5 },
        { id: 'charlie',  label: 'Charlie (Croco Kid)',     switchId: 779, varId: 729, troopGroup: 5 },
        { id: 'zachary',  label: 'Zachary (Centipede Kid)', switchId: 777, varId: 730, troopGroup: 6 },
        { id: 'roxie',    label: 'Roxie (Service Dog)',     switchId: 778, varId: 731, troopGroup: 7 },
    ];

    // Troop groups 1..6 each increment var 724 on completion in the natural
    // game; group 7 (Roxie) does not. Drives the "X / 6 reported" math.
    const COUNTING_TROOP_GROUPS = [1, 2, 3, 4, 5, 6];
    const TOTAL_COUNTING_GROUPS = COUNTING_TROOP_GROUPS.length;

    // sewerKidsReported: David's "kids I already know about" counter. The
    // natural game catches it up to var 724 at the end of each David
    // conversation, so keeping it equal to var 724 after every cheat write
    // makes David's "any news?" reward branch a no-op (already reported).
    const VAR_REPORTED = 723;
    // sewerKidsTotal: number of distinct troop groups (1..6) the player has
    // brought back. The cheat recomputes this from the per-kid switches so
    // toggling any single kid keeps the global count consistent.
    const VAR_TOTAL = 724;

    const PICKER_WIDTH = 520;
    const PICKER_SPACING = 12;
    const PICKER_MAX_ROWS = 12;

    // Sentinel ext for the bulk-action row at the top of the list. Kid rows
    // store their SEWER_KIDS index in ext, so any non-negative integer is a
    // kid; -1 unambiguously identifies the action.
    const ACTION_EXT_BULK = -1;

    // Bulk modes:
    //   'saveAll'  - flip every kid to Saved + sync the global vars
    //   'resetAll' - flip every kid to Not Saved + clear var 723/724
    const BULK_MODES = {
        saveAll: {
            id: 'saveAll',
            label: 'Save all kids',
            confirmActionLine: 'all 10 kids set to Saved and the David counters synced to 6.',
            wantSaved: true,
        },
        resetAll: {
            id: 'resetAll',
            label: 'Reset all kids',
            confirmActionLine: 'all 10 kids set to Not Saved and the kid counters reset to 0.',
            wantSaved: false,
        },
    };

    let _activeKidId = null;

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

    function isKidSaved(kid) {
        return readSwitch(kid.switchId);
    }

    function findKid(kidId) {
        return SEWER_KIDS.find(k => k.id === kidId) || null;
    }

    // Number of troop groups (1..6) where at least one kid's switch is ON.
    // Mirrors what var 724 would equal if the natural game had walked through
    // each accept-branch — Roxie's group 7 is excluded.
    function computeSavedTroopCount() {
        const groups = new Set();
        SEWER_KIDS.forEach(k => {
            if (COUNTING_TROOP_GROUPS.indexOf(k.troopGroup) >= 0 && isKidSaved(k)) {
                groups.add(k.troopGroup);
            }
        });
        return groups.size;
    }

    function countSavedKids() {
        return SEWER_KIDS.reduce((n, k) => n + (isKidSaved(k) ? 1 : 0), 0);
    }

    // The shared SewerKids_* var for a paired troop reflects "the troop has
    // been encountered". After flipping a per-kid switch we recompute the
    // group var: ON if any kid in the group is saved, OFF if none. This
    // keeps the natural game's intro-skip gate honest — encountering a
    // group whose var is 0 fires the intro dialog before the rescue branch.
    function recomputeGroupVar(groupId) {
        const groupKids = SEWER_KIDS.filter(k => k.troopGroup === groupId);
        if (groupKids.length === 0) {
            return null;
        }
        const anySaved = groupKids.some(k => isKidSaved(k));
        const varId = groupKids[0].varId;
        const newVal = anySaved ? 1 : 0;
        if (readVar(varId) !== newVal) {
            $gameVariables.setValue(varId, newVal);
        }
        return { varId, value: newVal };
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
    // list (so the user is not stranded with no input focus when the push is
    // refused).
    function openSewerKidsScene() {
        if (!isSessionReady()) {
            CabbyCodes.warn(`${LOG_PREFIX} Picker blocked: no active session.`);
            SoundManager.playBuzzer();
            return false;
        }
        if (typeof SceneManager === 'undefined' || typeof Scene_CabbyCodesSewerKids === 'undefined') {
            CabbyCodes.warn(`${LOG_PREFIX} SceneManager or scene unavailable.`);
            return false;
        }
        SceneManager.push(Scene_CabbyCodesSewerKids);
        return true;
    }

    CabbyCodes.openSewerKidsScene = openSewerKidsScene;

    // Compact saved/total summary (e.g. "5/10") for the Quest States row
    // that hosts the Sewer Kids entry — the standard list draws a single
    // right-aligned value cell, so we keep it short. Falls back to "?"
    // when the session isn't loaded so the row never reads as a misleading
    // "0/10" before save data is available.
    CabbyCodes.getSewerKidsSummary = function() {
        if (!isSessionReady()) {
            return '?';
        }
        return `${countSavedKids()}/${SEWER_KIDS.length}`;
    };

    function openValuePickerFor(kid) {
        if (!isSessionReady()) {
            SoundManager.playBuzzer();
            return;
        }
        _activeKidId = kid.id;
        SceneManager.push(Scene_CabbyCodesSewerKidValue);
    }

    //----------------------------------------------------------------------
    // Apply path
    //----------------------------------------------------------------------

    // Set one kid's saved flag, then re-derive the shared troop var, var 724
    // (sewerKidsTotal), and var 723 (sewerKidsReported = total). All writes
    // happen under a single freeze-exemption token so the restore debounce
    // doesn't undo any of them mid-batch.
    function applyKidSaved(kid, wantSaved) {
        if (!isSessionReady()) {
            return false;
        }
        const oldSaved = isKidSaved(kid);
        const allKidVarIds = Array.from(new Set(SEWER_KIDS.map(k => k.varId)));
        const allKidSwitchIds = SEWER_KIDS.map(k => k.switchId);
        return withFreezeExemption(
            [VAR_REPORTED, VAR_TOTAL, ...allKidVarIds],
            allKidSwitchIds,
            () => {
                try {
                    $gameSwitches.setValue(kid.switchId, wantSaved);
                    const groupResult = recomputeGroupVar(kid.troopGroup);
                    const newTotal = computeSavedTroopCount();
                    $gameVariables.setValue(VAR_TOTAL, newTotal);
                    $gameVariables.setValue(VAR_REPORTED, newTotal);
                    const groupNote = groupResult
                        ? ` var ${groupResult.varId}=${groupResult.value}.`
                        : '';
                    CabbyCodes.warn(`${LOG_PREFIX} ${kid.label} sw ${kid.switchId}: ${oldSaved} -> ${wantSaved}.${groupNote} var ${VAR_TOTAL}=${newTotal}, var ${VAR_REPORTED}=${newTotal}.`);
                    return true;
                } catch (error) {
                    CabbyCodes.error(`${LOG_PREFIX} Apply failed for ${kid.label}: ${error?.message || error}`);
                    return false;
                }
            }
        );
    }

    function applyBulk(modeId) {
        if (!isSessionReady()) {
            return 0;
        }
        const mode = BULK_MODES[modeId];
        if (!mode) {
            CabbyCodes.warn(`${LOG_PREFIX} Bulk: unknown mode "${modeId}".`);
            return 0;
        }
        const allKidVarIds = Array.from(new Set(SEWER_KIDS.map(k => k.varId)));
        const allKidSwitchIds = SEWER_KIDS.map(k => k.switchId);
        let updated = 0;
        withFreezeExemption(
            [VAR_REPORTED, VAR_TOTAL, ...allKidVarIds],
            allKidSwitchIds,
            () => {
                SEWER_KIDS.forEach(kid => {
                    const oldSaved = isKidSaved(kid);
                    if (oldSaved !== mode.wantSaved) {
                        try {
                            $gameSwitches.setValue(kid.switchId, mode.wantSaved);
                            updated += 1;
                        } catch (error) {
                            CabbyCodes.error(`${LOG_PREFIX} Bulk (${mode.id}) failed for ${kid.label}: ${error?.message || error}`);
                        }
                    }
                });
                // Recompute every group var once after all switches are set,
                // so paired kids don't trigger redundant intermediate writes.
                const groupIds = Array.from(new Set(SEWER_KIDS.map(k => k.troopGroup)));
                groupIds.forEach(g => recomputeGroupVar(g));
                const newTotal = computeSavedTroopCount();
                $gameVariables.setValue(VAR_TOTAL, newTotal);
                $gameVariables.setValue(VAR_REPORTED, newTotal);
                CabbyCodes.warn(`${LOG_PREFIX} Bulk (${mode.id}): ${updated} switch flip(s). var ${VAR_TOTAL}=${newTotal}, var ${VAR_REPORTED}=${newTotal}.`);
            }
        );
        return updated;
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

    function summaryLine() {
        const saved = countSavedKids();
        const groups = computeSavedTroopCount();
        return `Saved ${saved}/${SEWER_KIDS.length}  -  Reported ${groups}/${TOTAL_COUNTING_GROUPS}`;
    }

    //----------------------------------------------------------------------
    // Scene_CabbyCodesSewerKids - top-level list (action row + per-kid rows)
    //----------------------------------------------------------------------

    function Scene_CabbyCodesSewerKids() {
        this.initialize(...arguments);
    }

    Scene_CabbyCodesSewerKids.prototype = Object.create(Scene_MenuBase.prototype);
    Scene_CabbyCodesSewerKids.prototype.constructor = Scene_CabbyCodesSewerKids;

    Scene_CabbyCodesSewerKids.prototype.create = function() {
        Scene_MenuBase.prototype.create.call(this);
        this.createHelpWindow();
        this.createListWindow();
    };

    Scene_CabbyCodesSewerKids.prototype.createBackground = function() {
        Scene_MenuBase.prototype.createBackground.call(this);
        if (this._backgroundSprite) {
            this._backgroundSprite.opacity = 192;
        }
    };

    Scene_CabbyCodesSewerKids.prototype.createHelpWindow = function() {
        const layout = pickerLayoutFor(this, SEWER_KIDS.length + 1);
        const rect = new Rectangle(layout.x, layout.baseY, layout.width, layout.helpHeight);
        this._helpWindow = new Window_Help(rect);
        this._helpWindow.setText(`Sewer Kids\n${summaryLine()}`);
        this.addWindow(this._helpWindow);
    };

    Scene_CabbyCodesSewerKids.prototype.createListWindow = function() {
        const layout = pickerLayoutFor(this, SEWER_KIDS.length + 1);
        const rect = new Rectangle(
            layout.x,
            layout.baseY + layout.helpHeight + PICKER_SPACING,
            layout.width,
            layout.listHeight
        );
        this._listWindow = new Window_CabbyCodesSewerKidsList(rect);
        this._listWindow.setHandler('ok', this.onListOk.bind(this));
        this._listWindow.setHandler('cancel', this.onListCancel.bind(this));
        this.addWindow(this._listWindow);
        this._listWindow.select(0);
        this._listWindow.activate();
        this._listWindow.setHelpWindow(this._helpWindow);
    };

    Scene_CabbyCodesSewerKids.prototype.onListOk = function() {
        const ext = this._listWindow.currentExt();
        if (ext === ACTION_EXT_BULK) {
            this.openBulkModePicker();
            return;
        }
        const kid = SEWER_KIDS[ext];
        if (!kid) {
            this._listWindow.activate();
            return;
        }
        openValuePickerFor(kid);
    };

    Scene_CabbyCodesSewerKids.prototype.openBulkModePicker = function() {
        if (typeof Scene_CabbyCodesSewerKidsBulkMode === 'undefined') {
            CabbyCodes.warn(`${LOG_PREFIX} Bulk-mode picker unavailable; aborting.`);
            SoundManager.playBuzzer();
            this._listWindow.activate();
            return;
        }
        SceneManager.push(Scene_CabbyCodesSewerKidsBulkMode);
    };

    Scene_CabbyCodesSewerKids.prototype.onListCancel = function() {
        SceneManager.pop();
    };

    window.Scene_CabbyCodesSewerKids = Scene_CabbyCodesSewerKids;

    //----------------------------------------------------------------------
    // Window_CabbyCodesSewerKidsList
    //----------------------------------------------------------------------

    function Window_CabbyCodesSewerKidsList() {
        this.initialize(...arguments);
    }

    Window_CabbyCodesSewerKidsList.prototype = Object.create(Window_Command.prototype);
    Window_CabbyCodesSewerKidsList.prototype.constructor = Window_CabbyCodesSewerKidsList;

    Window_CabbyCodesSewerKidsList.prototype.makeCommandList = function() {
        this.addCommand('Set all kids to...', 'bulk_set', true, ACTION_EXT_BULK);
        SEWER_KIDS.forEach((kid, index) => {
            this.addCommand(kid.label, `kid_${kid.id}`, true, index);
        });
    };

    Window_CabbyCodesSewerKidsList.prototype.numVisibleRows = function() {
        return Math.min(PICKER_MAX_ROWS, this.maxItems() || 1);
    };

    Window_CabbyCodesSewerKidsList.prototype.drawItem = function(index) {
        const rect = this.itemLineRect(index);
        const ext = this._list[index] && this._list[index].ext;
        if (ext === ACTION_EXT_BULK) {
            this.resetTextColor();
            this.changeTextColor(ColorManager.powerUpColor());
            this.drawText(this.commandName(index), rect.x, rect.y, rect.width, 'left');
            this.resetTextColor();
            return;
        }
        const kid = SEWER_KIDS[ext];
        if (!kid) {
            return;
        }
        const saved = isKidSaved(kid);
        const valueText = saved ? 'Saved' : 'Not Saved';
        const valueWidth = this.textWidth('Not Saved');
        const labelWidth = Math.max(0, rect.width - valueWidth - 8);
        this.changeTextColor(ColorManager.systemColor());
        this.drawText(kid.label, rect.x, rect.y, labelWidth, 'left');
        if (saved) {
            this.changeTextColor(ColorManager.powerUpColor());
        } else {
            this.resetTextColor();
        }
        this.drawText(valueText, rect.x + rect.width - valueWidth, rect.y, valueWidth, 'right');
        this.resetTextColor();
    };

    Window_CabbyCodesSewerKidsList.prototype.updateHelp = function() {
        if (!this._helpWindow) {
            return;
        }
        const ext = this.currentExt();
        if (ext === ACTION_EXT_BULK) {
            this._helpWindow.setText(`Sewer Kids\n${summaryLine()}`);
            return;
        }
        const kid = SEWER_KIDS[ext];
        if (!kid) {
            this._helpWindow.setText(`Sewer Kids\n${summaryLine()}`);
            return;
        }
        const saved = isKidSaved(kid);
        this._helpWindow.setText(`${kid.label}  (sw ${kid.switchId}, var ${kid.varId})\nCurrent: ${saved ? 'Saved' : 'Not Saved'}    ${summaryLine()}`);
    };

    window.Window_CabbyCodesSewerKidsList = Window_CabbyCodesSewerKidsList;

    //----------------------------------------------------------------------
    // Scene_CabbyCodesSewerKidValue - per-kid value picker (Saved / Not Saved)
    //----------------------------------------------------------------------

    function Scene_CabbyCodesSewerKidValue() {
        this.initialize(...arguments);
    }

    Scene_CabbyCodesSewerKidValue.prototype = Object.create(Scene_MenuBase.prototype);
    Scene_CabbyCodesSewerKidValue.prototype.constructor = Scene_CabbyCodesSewerKidValue;

    Scene_CabbyCodesSewerKidValue.prototype.activeKid = function() {
        return findKid(_activeKidId);
    };

    Scene_CabbyCodesSewerKidValue.prototype.create = function() {
        Scene_MenuBase.prototype.create.call(this);
        this.createHelpWindow();
        this.createValueWindow();
    };

    Scene_CabbyCodesSewerKidValue.prototype.createBackground = function() {
        Scene_MenuBase.prototype.createBackground.call(this);
        if (this._backgroundSprite) {
            this._backgroundSprite.opacity = 192;
        }
    };

    Scene_CabbyCodesSewerKidValue.prototype.createHelpWindow = function() {
        const layout = pickerLayoutFor(this, 2);
        const rect = new Rectangle(layout.x, layout.baseY, layout.width, layout.helpHeight);
        this._helpWindow = new Window_Help(rect);
        const kid = this.activeKid();
        if (kid) {
            const saved = isKidSaved(kid);
            this._helpWindow.setText(`${kid.label}\nCurrent: ${saved ? 'Saved' : 'Not Saved'}    ${summaryLine()}`);
        } else {
            this._helpWindow.setText('Sewer Kids\nNo kid selected.');
        }
        this.addWindow(this._helpWindow);
    };

    Scene_CabbyCodesSewerKidValue.prototype.createValueWindow = function() {
        const layout = pickerLayoutFor(this, 2);
        const rect = new Rectangle(
            layout.x,
            layout.baseY + layout.helpHeight + PICKER_SPACING,
            layout.width,
            layout.listHeight
        );
        this._valueWindow = new Window_CabbyCodesSewerKidValueList(rect);
        this._valueWindow.setHandler('ok', this.onValueOk.bind(this));
        this._valueWindow.setHandler('cancel', this.onValueCancel.bind(this));
        this.addWindow(this._valueWindow);
        const kid = this.activeKid();
        // Pre-select the row matching the kid's current state so a stray
        // Enter is a no-op apply rather than a state flip.
        this._valueWindow.select(kid && isKidSaved(kid) ? 1 : 0);
        this._valueWindow.activate();
    };

    Scene_CabbyCodesSewerKidValue.prototype.onValueOk = function() {
        const kid = this.activeKid();
        const wantSaved = this._valueWindow.currentSavedFlag();
        if (kid && typeof wantSaved === 'boolean') {
            applyKidSaved(kid, wantSaved);
        }
        SceneManager.pop();
    };

    Scene_CabbyCodesSewerKidValue.prototype.onValueCancel = function() {
        SceneManager.pop();
    };

    window.Scene_CabbyCodesSewerKidValue = Scene_CabbyCodesSewerKidValue;

    //----------------------------------------------------------------------
    // Window_CabbyCodesSewerKidValueList - "Not Saved" / "Saved"
    //----------------------------------------------------------------------

    function Window_CabbyCodesSewerKidValueList() {
        this.initialize(...arguments);
    }

    Window_CabbyCodesSewerKidValueList.prototype = Object.create(Window_Command.prototype);
    Window_CabbyCodesSewerKidValueList.prototype.constructor = Window_CabbyCodesSewerKidValueList;

    Window_CabbyCodesSewerKidValueList.prototype.makeCommandList = function() {
        this.addCommand('Not Saved', 'value_off', true, 0);
        this.addCommand('Saved',     'value_on',  true, 1);
    };

    Window_CabbyCodesSewerKidValueList.prototype.numVisibleRows = function() {
        return 2;
    };

    Window_CabbyCodesSewerKidValueList.prototype.currentSavedFlag = function() {
        const ext = this.currentExt();
        if (ext === 1) return true;
        if (ext === 0) return false;
        return null;
    };

    window.Window_CabbyCodesSewerKidValueList = Window_CabbyCodesSewerKidValueList;

    //----------------------------------------------------------------------
    // Scene_CabbyCodesSewerKidsBulkMode - pick Save All / Reset All
    //----------------------------------------------------------------------

    function Scene_CabbyCodesSewerKidsBulkMode() {
        this.initialize(...arguments);
    }

    Scene_CabbyCodesSewerKidsBulkMode.prototype = Object.create(Scene_MenuBase.prototype);
    Scene_CabbyCodesSewerKidsBulkMode.prototype.constructor = Scene_CabbyCodesSewerKidsBulkMode;

    Scene_CabbyCodesSewerKidsBulkMode.prototype.create = function() {
        Scene_MenuBase.prototype.create.call(this);
        this.createHelpWindow();
        this.createListWindow();
    };

    Scene_CabbyCodesSewerKidsBulkMode.prototype.createBackground = function() {
        Scene_MenuBase.prototype.createBackground.call(this);
        if (this._backgroundSprite) {
            this._backgroundSprite.opacity = 192;
        }
    };

    Scene_CabbyCodesSewerKidsBulkMode.prototype.createHelpWindow = function() {
        const layout = pickerLayoutFor(this, 2);
        const rect = new Rectangle(layout.x, layout.baseY, layout.width, layout.helpHeight);
        this._helpWindow = new Window_Help(rect);
        this._helpWindow.setText(`Set all kids to...\nPick a target state. ${summaryLine()}`);
        this.addWindow(this._helpWindow);
    };

    Scene_CabbyCodesSewerKidsBulkMode.prototype.createListWindow = function() {
        const layout = pickerLayoutFor(this, 2);
        const rect = new Rectangle(
            layout.x,
            layout.baseY + layout.helpHeight + PICKER_SPACING,
            layout.width,
            layout.listHeight
        );
        this._listWindow = new Window_CabbyCodesSewerKidsBulkMode(rect);
        this._listWindow.setHandler('ok', this.onModeOk.bind(this));
        this._listWindow.setHandler('cancel', this.onModeCancel.bind(this));
        this.addWindow(this._listWindow);
        this._listWindow.select(0);
        this._listWindow.activate();
    };

    Scene_CabbyCodesSewerKidsBulkMode.prototype.onModeOk = function() {
        const modeId = this._listWindow.currentSymbol();
        if (!BULK_MODES[modeId] || typeof Scene_CabbyCodesSewerKidsConfirm === 'undefined') {
            this._listWindow.activate();
            return;
        }
        SceneManager.push(Scene_CabbyCodesSewerKidsConfirm);
        if (typeof SceneManager.prepareNextScene === 'function') {
            SceneManager.prepareNextScene({
                modeId,
                onConfirm: () => {
                    const updated = applyBulk(modeId);
                    if (updated > 0) {
                        SoundManager.playUseSkill();
                    } else {
                        SoundManager.playBuzzer();
                    }
                    // Pop both Confirm and BulkMode so the user lands back
                    // on the main sewer kids list with refreshed values.
                    SceneManager.pop();
                    SceneManager.pop();
                },
                onCancel: () => SceneManager.pop()
            });
        }
    };

    Scene_CabbyCodesSewerKidsBulkMode.prototype.onModeCancel = function() {
        SceneManager.pop();
    };

    window.Scene_CabbyCodesSewerKidsBulkMode = Scene_CabbyCodesSewerKidsBulkMode;

    function Window_CabbyCodesSewerKidsBulkMode() {
        this.initialize(...arguments);
    }

    Window_CabbyCodesSewerKidsBulkMode.prototype = Object.create(Window_Command.prototype);
    Window_CabbyCodesSewerKidsBulkMode.prototype.constructor = Window_CabbyCodesSewerKidsBulkMode;

    Window_CabbyCodesSewerKidsBulkMode.prototype.makeCommandList = function() {
        this.addCommand(BULK_MODES.saveAll.label,  'saveAll');
        this.addCommand(BULK_MODES.resetAll.label, 'resetAll');
    };

    Window_CabbyCodesSewerKidsBulkMode.prototype.numVisibleRows = function() {
        return 2;
    };

    window.Window_CabbyCodesSewerKidsBulkMode = Window_CabbyCodesSewerKidsBulkMode;

    //----------------------------------------------------------------------
    // Scene_CabbyCodesSewerKidsConfirm - Yes/No prompt for bulk action
    //----------------------------------------------------------------------

    function Scene_CabbyCodesSewerKidsConfirm() {
        this.initialize(...arguments);
    }

    Scene_CabbyCodesSewerKidsConfirm.prototype = Object.create(Scene_MenuBase.prototype);
    Scene_CabbyCodesSewerKidsConfirm.prototype.constructor = Scene_CabbyCodesSewerKidsConfirm;

    Scene_CabbyCodesSewerKidsConfirm.prototype.prepare = function(params = {}) {
        this._modeId = params.modeId || 'saveAll';
        this._onConfirm = params.onConfirm;
        this._onCancel = params.onCancel;
    };

    Scene_CabbyCodesSewerKidsConfirm.prototype.helpAreaHeight = function() {
        return 0;
    };

    Scene_CabbyCodesSewerKidsConfirm.prototype.create = function() {
        Scene_MenuBase.prototype.create.call(this);
        this.createInfoWindow();
        this.createCommandWindow();
    };

    Scene_CabbyCodesSewerKidsConfirm.prototype.createBackground = function() {
        Scene_MenuBase.prototype.createBackground.call(this);
        if (this._backgroundSprite) {
            this._backgroundSprite.opacity = 192;
        }
    };

    Scene_CabbyCodesSewerKidsConfirm.prototype.infoLines = function() {
        const mode = BULK_MODES[this._modeId] || BULK_MODES.saveAll;
        return [
            mode.label,
            mode.confirmActionLine
        ];
    };

    Scene_CabbyCodesSewerKidsConfirm.prototype.commandWindowHeight = function() {
        return this.calcWindowHeight(2, true);
    };

    Scene_CabbyCodesSewerKidsConfirm.prototype.createInfoWindow = function() {
        const lines = this.infoLines();
        const ww = Math.min(Graphics.boxWidth - 96, 560);
        const wh = this.calcWindowHeight(lines.length, false);
        const totalHeight = wh + 16 + this.commandWindowHeight();
        const wx = Math.floor((Graphics.boxWidth - ww) / 2);
        const wy = Math.max(40, Math.floor((Graphics.boxHeight - totalHeight) / 2));
        const rect = new Rectangle(wx, wy, ww, wh);
        const uiApi = CabbyCodes.ui || {};
        if (typeof uiApi.createInfoBox === 'function') {
            this._infoWindow = uiApi.createInfoBox(rect, lines.join('\n'));
        } else {
            this._infoWindow = new Window_Help(rect);
            this._infoWindow.setText(lines.join('\n'));
        }
        this.addWindow(this._infoWindow);
    };

    Scene_CabbyCodesSewerKidsConfirm.prototype.createCommandWindow = function() {
        const ww = 400;
        const wh = this.commandWindowHeight();
        const wx = Math.floor((Graphics.boxWidth - ww) / 2);
        const wy = this._infoWindow.y + this._infoWindow.height + 16;
        this._commandWindow = new Window_CabbyCodesSewerKidsConfirm(new Rectangle(wx, wy, ww, wh));
        this._commandWindow.setHandler('confirm', this.onConfirm.bind(this));
        this._commandWindow.setHandler('cancel', this.onCancel.bind(this));
        // Default to "No, go back" so a stray Enter does nothing destructive.
        this._commandWindow.select(1);
        this._commandWindow.activate();
        this.addWindow(this._commandWindow);
    };

    Scene_CabbyCodesSewerKidsConfirm.prototype.onConfirm = function() {
        if (typeof this._onConfirm === 'function') {
            this._onConfirm();
            return;
        }
        SceneManager.pop();
    };

    Scene_CabbyCodesSewerKidsConfirm.prototype.onCancel = function() {
        if (typeof this._onCancel === 'function') {
            this._onCancel();
            return;
        }
        SceneManager.pop();
    };

    window.Scene_CabbyCodesSewerKidsConfirm = Scene_CabbyCodesSewerKidsConfirm;

    function Window_CabbyCodesSewerKidsConfirm() {
        this.initialize(...arguments);
    }

    Window_CabbyCodesSewerKidsConfirm.prototype = Object.create(Window_Command.prototype);
    Window_CabbyCodesSewerKidsConfirm.prototype.constructor = Window_CabbyCodesSewerKidsConfirm;

    Window_CabbyCodesSewerKidsConfirm.prototype.makeCommandList = function() {
        this.addCommand('Yes, apply',  'confirm');
        this.addCommand('No, go back', 'cancel');
    };

    window.Window_CabbyCodesSewerKidsConfirm = Window_CabbyCodesSewerKidsConfirm;

    CabbyCodes.log('[CabbyCodes] Sewer Kids module loaded');
})();
