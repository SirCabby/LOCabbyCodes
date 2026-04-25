//=============================================================================
// CabbyCodes Video Games
//=============================================================================
/*:
 * @target MZ
 * @plugindesc CabbyCodes Video Games - Backs the "Video Games" submenu of Story Flags. Tracks per-cartridge play counts and how many plays remain before each console game's skill is awarded; mass-sets unfinished games to 1 play from earning the skill.
 * @author CabbyCodes
 * @help
 * Surfaces a "Video Games" sub-section inside the Story Flags categories
 * picker. Story Flags reaches in via CabbyCodes.openVideoGamesScene().
 *
 *   - Top action row: "Set Unfinished -> 1 Left" sets every cartridge whose
 *     skill the protagonist has not learned yet so that one more play through
 *     that cartridge will award the skill.
 *   - One row per cartridge showing how many plays remain until the skill is
 *     earned, or "Earned" when actor 1 already knows the skill.
 *
 * The cartridge variable IDs (vars 81-99) and the per-cartridge skill grant
 * thresholds were extracted from CommonEvents.json CE 21..39 (game:<Title>).
 * Each game's CE checks "var <id> {==|>=} <threshold>" before granting its
 * skill, then increments the variable by 1 at the end of the play, so the
 * skill is awarded on the play that *enters* with the variable already at
 * the threshold. Setting the variable to (threshold + 1 - K) means K more
 * plays will see the threshold and earn the skill.
 *
 * "Earned" sets the variable past the threshold *and* calls
 * Game_Actor.learnSkill on actor 1 directly, since the == comparator games
 * would otherwise never re-award the skill if the variable was bumped past.
 *
 * Cooperates with Freeze Time by acquiring an exempt-from-restore token
 * across writes (these vars aren't in the freeze set today, but mirroring
 * the story-flags pattern keeps us safe if the freeze snapshot ever grows).
 * A WARN-level log line names each change so the diff is easy to verify in
 * CabbyCodes.log.
 */

(() => {
    'use strict';

    if (typeof window.CabbyCodes === 'undefined') {
        console.warn('[CabbyCodes] Video Games requires CabbyCodes core.');
        return;
    }

    const LOG_PREFIX = '[CabbyCodes][VideoGames]';

    // Per-cartridge descriptors. triggerVar = the value of the variable that,
    // at start-of-play, causes the CE's skill-grant branch to fire. After that
    // play the CE increments the variable by 1, so a freshly-earned cartridge
    // sits at triggerVar + 1.
    const VIDEO_GAMES = [
        { id: 'wakeBloodKnight', label: 'Wake The Blood Knight',     varId: 81, skillId: 413, triggerVar: 3  },
        { id: 'wizardshell',     label: "Wizard's Hell: Arcane Tears", varId: 82, skillId: 410, triggerVar: 4  },
        { id: 'superJumplad',    label: 'Super Jumplad',              varId: 83, skillId: 401, triggerVar: 1  },
        { id: 'superJumplad3',   label: 'Super Jumplad 3',            varId: 84, skillId: 405, triggerVar: 4  },
        { id: 'catafalque',      label: 'Catafalque',                 varId: 85, skillId: 418, triggerVar: 3  },
        { id: 'honkos',          label: "Honko's Grand Journey",      varId: 86, skillId: 412, triggerVar: 3  },
        { id: 'madwheels',       label: 'Madwheels 97',               varId: 87, skillId: 402, triggerVar: 4  },
        { id: 'wraithscourge',   label: 'Wraithscourge',              varId: 88, skillId: 416, triggerVar: 3  },
        { id: 'massacre',        label: 'Massacre Princess',          varId: 89, skillId: 409, triggerVar: 11 },
        { id: 'killToShoot',     label: 'Kill To Shoot',              varId: 90, skillId: 411, triggerVar: 3  },
        { id: 'myrmidon',        label: 'Myrmidon',                   varId: 91, skillId: 403, triggerVar: 3  },
        { id: 'myrmidonXII',     label: 'Myrmidon XII',               varId: 92, skillId: 417, triggerVar: 5  },
        { id: 'screamatorium',   label: 'Screamatorium',              varId: 93, skillId: 404, triggerVar: 3  },
        { id: 'frogit',          label: 'Frogit About It',            varId: 94, skillId: 406, triggerVar: 4  },
        { id: 'bloodGhoul',      label: 'Blood Ghoul Orgy 3',         varId: 95, skillId: 407, triggerVar: 3  },
        { id: 'octocook',        label: 'Octocook',                   varId: 96, skillId: 408, triggerVar: 3  },
        { id: 'spaceTruckerz',   label: 'Space Truckerz',             varId: 97, skillId: 414, triggerVar: 3  },
        { id: 'reptileFootball', label: 'Reptile Football',           varId: 98, skillId: 415, triggerVar: 3  },
        { id: 'crossword',       label: "Auntie Wilma's Crossword",   varId: 99, skillId: 419, triggerVar: 4  },
    ];

    const PICKER_WIDTH = 520;
    const PICKER_SPACING = 12;
    const PICKER_MAX_ROWS = 12;

    // Sentinel ext for the bulk-action row at the top of the list. Game rows
    // store their VIDEO_GAMES index in ext, so any non-negative integer is a
    // game; -1 unambiguously identifies the action.
    const ACTION_EXT_BULK = -1;

    let _activeGameId = null;

    function isSessionReady() {
        if (typeof $gameVariables === 'undefined' || !$gameVariables) {
            return false;
        }
        if (typeof $gameActors === 'undefined' || !$gameActors) {
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

    function actorHasSkill(skillId) {
        if (typeof $gameActors === 'undefined' || !$gameActors) {
            return false;
        }
        const sam = $gameActors.actor(1);
        if (!sam) {
            return false;
        }
        if (typeof sam.isLearnedSkill === 'function') {
            return Boolean(sam.isLearnedSkill(skillId));
        }
        if (Array.isArray(sam._skills)) {
            return sam._skills.indexOf(skillId) >= 0;
        }
        return false;
    }

    function findGame(gameId) {
        return VIDEO_GAMES.find(g => g.id === gameId) || null;
    }

    // Iterations left until skill is earned. 0 if Sam already knows the skill.
    // Otherwise: triggerVar + 1 - currentVar, clamped to >= 0. If the user has
    // somehow pumped the variable past the trigger but still doesn't have the
    // skill (== comparator games), we report 0 too so the row reads "Past
    // trigger" rather than a misleading negative number.
    function iterationsLeft(game) {
        if (actorHasSkill(game.skillId)) {
            return 0;
        }
        const cur = readVar(game.varId);
        const left = game.triggerVar + 1 - cur;
        return left > 0 ? left : 0;
    }

    function rowValueText(game) {
        if (actorHasSkill(game.skillId)) {
            return 'Earned';
        }
        const cur = readVar(game.varId);
        if (cur > game.triggerVar) {
            return 'Past Trigger';
        }
        const left = iterationsLeft(game);
        return left === 1 ? '1 Left' : `${left} Left`;
    }

    // Build the per-game value-picker option list. "Earned" maps to var =
    // triggerVar + 1 AND a learnSkill call; numeric "K Left" maps to var =
    // triggerVar + 1 - K. We expose triggerVar + 1 distinct numeric entries so
    // the user can rewind the cartridge all the way to a fresh first play.
    function buildOptionsForGame(game) {
        const options = [{ kind: 'earned', label: 'Earned (skip)' }];
        for (let k = 1; k <= game.triggerVar + 1; k += 1) {
            options.push({
                kind: 'iterations',
                left: k,
                label: k === 1 ? '1 Left (next play earns skill)' : `${k} Left`
            });
        }
        return options;
    }

    // Maps the picker's currently-selected value back to one we can compare to
    // the live game state so the value list opens with the right row pre-
    // selected.
    function currentOptionIndex(game) {
        if (actorHasSkill(game.skillId)) {
            return 0;
        }
        const left = iterationsLeft(game);
        if (left <= 0) {
            return 0;
        }
        // options[0] is 'Earned', options[k] (k >= 1) is "k Left"
        const idx = Math.min(left, game.triggerVar + 1);
        return idx;
    }

    // Returns true if the scene was pushed; false if blocked. Story Flags
    // checks the return value to decide whether to re-activate its category
    // list (so the user is not stranded with no input focus when the push is
    // refused).
    function openVideoGamesScene() {
        if (!isSessionReady()) {
            CabbyCodes.warn(`${LOG_PREFIX} Picker blocked: no active session.`);
            SoundManager.playBuzzer();
            return false;
        }
        if (typeof SceneManager === 'undefined' || typeof Scene_CabbyCodesVideoGames === 'undefined') {
            CabbyCodes.warn(`${LOG_PREFIX} SceneManager or scene unavailable.`);
            return false;
        }
        SceneManager.push(Scene_CabbyCodesVideoGames);
        return true;
    }

    CabbyCodes.openVideoGamesScene = openVideoGamesScene;

    function openValuePickerFor(game) {
        if (!isSessionReady()) {
            SoundManager.playBuzzer();
            return;
        }
        _activeGameId = game.id;
        SceneManager.push(Scene_CabbyCodesVideoGameValue);
    }

    //----------------------------------------------------------------------
    // Apply path
    //----------------------------------------------------------------------

    function applyOption(game, option) {
        if (!isSessionReady()) {
            return false;
        }
        if (option.kind === 'earned') {
            return applyEarned(game);
        }
        return applyIterationsLeft(game, option.left);
    }

    function withFreezeExemption(varIds, fn) {
        const api = CabbyCodes.freezeTime;
        const token = (api && typeof api.exemptFromRestore === 'function')
            ? api.exemptFromRestore({ variables: varIds })
            : { release: () => {} };
        try {
            return fn();
        } finally {
            token.release();
        }
    }

    function applyEarned(game) {
        const oldVar = readVar(game.varId);
        const hadSkill = actorHasSkill(game.skillId);
        const newVar = game.triggerVar + 1;
        return withFreezeExemption([game.varId], () => {
            try {
                $gameVariables.setValue(game.varId, newVar);
                let skillNote = '';
                if (!hadSkill) {
                    const sam = $gameActors.actor(1);
                    if (sam && typeof sam.learnSkill === 'function') {
                        sam.learnSkill(game.skillId);
                        skillNote = ` Learned skill ${game.skillId}.`;
                    } else {
                        skillNote = ` Could not call learnSkill on actor 1.`;
                    }
                    if (sam && typeof sam.refresh === 'function') {
                        sam.refresh();
                    }
                }
                CabbyCodes.warn(`${LOG_PREFIX} ${game.label} -> Earned. var ${game.varId}: ${oldVar} -> ${newVar}.${skillNote}`);
                return true;
            } catch (error) {
                CabbyCodes.error(`${LOG_PREFIX} Apply (Earned) failed for ${game.label}: ${error?.message || error}`);
                return false;
            }
        });
    }

    function applyIterationsLeft(game, left) {
        const oldVar = readVar(game.varId);
        const newVar = Math.max(0, game.triggerVar + 1 - left);
        return withFreezeExemption([game.varId], () => {
            try {
                $gameVariables.setValue(game.varId, newVar);
                CabbyCodes.warn(`${LOG_PREFIX} ${game.label} -> ${left} Left. var ${game.varId}: ${oldVar} -> ${newVar}.`);
                return true;
            } catch (error) {
                CabbyCodes.error(`${LOG_PREFIX} Apply (${left} left) failed for ${game.label}: ${error?.message || error}`);
                return false;
            }
        });
    }

    // Bulk modes:
    //   'oneLeft' - set var = triggerVar so the next play awards the skill
    //   'earned'  - set var = triggerVar + 1 AND learnSkill on actor 1
    const BULK_MODES = {
        oneLeft: {
            id: 'oneLeft',
            label: '1 Left (next play earns skill)',
            confirmActionLine: 'set so that one more play through that cabinet awards the skill.',
        },
        earned: {
            id: 'earned',
            label: 'Earned (mark complete)',
            confirmActionLine: 'marked complete - the play counter advances past the trigger and the skill is learned directly.',
        },
    };

    function applyBulkUnfinished(modeId) {
        if (!isSessionReady()) {
            return 0;
        }
        const mode = BULK_MODES[modeId];
        if (!mode) {
            CabbyCodes.warn(`${LOG_PREFIX} Bulk: unknown mode "${modeId}".`);
            return 0;
        }
        const targets = VIDEO_GAMES.filter(g => !actorHasSkill(g.skillId));
        if (targets.length === 0) {
            CabbyCodes.warn(`${LOG_PREFIX} Bulk (${mode.id}): no unfinished games — nothing to do.`);
            return 0;
        }
        const varIds = targets.map(g => g.varId);
        let updated = 0;
        withFreezeExemption(varIds, () => {
            targets.forEach(game => {
                const oldVar = readVar(game.varId);
                try {
                    if (mode.id === 'earned') {
                        const newVar = game.triggerVar + 1;
                        $gameVariables.setValue(game.varId, newVar);
                        const sam = $gameActors.actor(1);
                        let skillNote = '';
                        if (sam && typeof sam.learnSkill === 'function') {
                            sam.learnSkill(game.skillId);
                            skillNote = ` Learned skill ${game.skillId}.`;
                        } else {
                            skillNote = ` Could not call learnSkill on actor 1.`;
                        }
                        if (sam && typeof sam.refresh === 'function') {
                            sam.refresh();
                        }
                        CabbyCodes.warn(`${LOG_PREFIX} Bulk Earned: ${game.label} var ${game.varId}: ${oldVar} -> ${newVar}.${skillNote}`);
                    } else {
                        const newVar = game.triggerVar;
                        $gameVariables.setValue(game.varId, newVar);
                        CabbyCodes.warn(`${LOG_PREFIX} Bulk 1 Left: ${game.label} var ${game.varId}: ${oldVar} -> ${newVar}.`);
                    }
                    updated += 1;
                } catch (error) {
                    CabbyCodes.error(`${LOG_PREFIX} Bulk (${mode.id}) failed for ${game.label}: ${error?.message || error}`);
                }
            });
        });
        CabbyCodes.warn(`${LOG_PREFIX} Bulk (${mode.id}): updated ${updated}/${targets.length} unfinished games.`);
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

    //----------------------------------------------------------------------
    // Scene_CabbyCodesVideoGames - top-level list (action row + per-game rows)
    //----------------------------------------------------------------------

    function Scene_CabbyCodesVideoGames() {
        this.initialize(...arguments);
    }

    Scene_CabbyCodesVideoGames.prototype = Object.create(Scene_MenuBase.prototype);
    Scene_CabbyCodesVideoGames.prototype.constructor = Scene_CabbyCodesVideoGames;

    Scene_CabbyCodesVideoGames.prototype.create = function() {
        Scene_MenuBase.prototype.create.call(this);
        this.createHelpWindow();
        this.createListWindow();
    };

    Scene_CabbyCodesVideoGames.prototype.createBackground = function() {
        Scene_MenuBase.prototype.createBackground.call(this);
        if (this._backgroundSprite) {
            this._backgroundSprite.opacity = 192;
        }
    };

    Scene_CabbyCodesVideoGames.prototype.createHelpWindow = function() {
        const layout = pickerLayoutFor(this, VIDEO_GAMES.length + 1);
        const rect = new Rectangle(layout.x, layout.baseY, layout.width, layout.helpHeight);
        this._helpWindow = new Window_Help(rect);
        this._helpWindow.setText('Video Games\nPlays remaining before each cartridge awards its skill.');
        this.addWindow(this._helpWindow);
    };

    Scene_CabbyCodesVideoGames.prototype.createListWindow = function() {
        const layout = pickerLayoutFor(this, VIDEO_GAMES.length + 1);
        const rect = new Rectangle(
            layout.x,
            layout.baseY + layout.helpHeight + PICKER_SPACING,
            layout.width,
            layout.listHeight
        );
        this._listWindow = new Window_CabbyCodesVideoGamesList(rect);
        this._listWindow.setHandler('ok', this.onListOk.bind(this));
        this._listWindow.setHandler('cancel', this.onListCancel.bind(this));
        this.addWindow(this._listWindow);
        this._listWindow.select(0);
        this._listWindow.activate();
        this._listWindow.setHelpWindow(this._helpWindow);
    };

    Scene_CabbyCodesVideoGames.prototype.onListOk = function() {
        const ext = this._listWindow.currentExt();
        if (ext === ACTION_EXT_BULK) {
            this.openBulkModePicker();
            return;
        }
        const game = VIDEO_GAMES[ext];
        if (!game) {
            this._listWindow.activate();
            return;
        }
        openValuePickerFor(game);
    };

    // Pre-counts the unfinished cartridges so the downstream prompts can show
    // "X games will be...". When zero, skip the entire flow — there's nothing
    // to do and the buzzer makes the no-op obvious without a multi-screen
    // dance.
    Scene_CabbyCodesVideoGames.prototype.openBulkModePicker = function() {
        const targets = VIDEO_GAMES.filter(g => !actorHasSkill(g.skillId));
        if (targets.length === 0) {
            CabbyCodes.warn(`${LOG_PREFIX} Bulk: no unfinished games — nothing to do.`);
            SoundManager.playBuzzer();
            this._listWindow.activate();
            return;
        }
        if (typeof Scene_CabbyCodesVideoGamesBulkMode === 'undefined') {
            CabbyCodes.warn(`${LOG_PREFIX} Bulk-mode picker unavailable; aborting.`);
            SoundManager.playBuzzer();
            this._listWindow.activate();
            return;
        }
        SceneManager.push(Scene_CabbyCodesVideoGamesBulkMode);
        if (typeof SceneManager.prepareNextScene === 'function') {
            SceneManager.prepareNextScene({ targetCount: targets.length });
        }
    };

    Scene_CabbyCodesVideoGames.prototype.onListCancel = function() {
        SceneManager.pop();
    };

    window.Scene_CabbyCodesVideoGames = Scene_CabbyCodesVideoGames;

    //----------------------------------------------------------------------
    // Window_CabbyCodesVideoGamesList
    //----------------------------------------------------------------------

    function Window_CabbyCodesVideoGamesList() {
        this.initialize(...arguments);
    }

    Window_CabbyCodesVideoGamesList.prototype = Object.create(Window_Command.prototype);
    Window_CabbyCodesVideoGamesList.prototype.constructor = Window_CabbyCodesVideoGamesList;

    Window_CabbyCodesVideoGamesList.prototype.makeCommandList = function() {
        this.addCommand('Set all unfinished to...', 'bulk_set', true, ACTION_EXT_BULK);
        VIDEO_GAMES.forEach((game, index) => {
            this.addCommand(game.label, `game_${game.id}`, true, index);
        });
    };

    Window_CabbyCodesVideoGamesList.prototype.numVisibleRows = function() {
        return Math.min(PICKER_MAX_ROWS, this.maxItems() || 1);
    };

    Window_CabbyCodesVideoGamesList.prototype.drawItem = function(index) {
        const rect = this.itemLineRect(index);
        const ext = this._list[index] && this._list[index].ext;
        if (ext === ACTION_EXT_BULK) {
            this.resetTextColor();
            this.changeTextColor(ColorManager.powerUpColor());
            this.drawText(this.commandName(index), rect.x, rect.y, rect.width, 'left');
            this.resetTextColor();
            return;
        }
        const game = VIDEO_GAMES[ext];
        if (!game) {
            return;
        }
        const valueText = rowValueText(game);
        const valueWidth = this.textWidth('Past Trigger');
        const labelWidth = Math.max(0, rect.width - valueWidth - 8);
        this.changeTextColor(ColorManager.systemColor());
        this.drawText(game.label, rect.x, rect.y, labelWidth, 'left');
        const isEarned = actorHasSkill(game.skillId);
        if (isEarned) {
            this.changeTextColor(ColorManager.powerUpColor());
        } else {
            this.resetTextColor();
        }
        this.drawText(valueText, rect.x + rect.width - valueWidth, rect.y, valueWidth, 'right');
        this.resetTextColor();
    };

    Window_CabbyCodesVideoGamesList.prototype.updateHelp = function() {
        if (!this._helpWindow) {
            return;
        }
        const ext = this.currentExt();
        if (ext === ACTION_EXT_BULK) {
            this._helpWindow.setText('Video Games\nFor every cartridge whose skill is not yet learned, choose 1 Left or Earned, then confirm.');
            return;
        }
        const game = VIDEO_GAMES[ext];
        if (!game) {
            this._helpWindow.setText('Video Games\nPlays remaining before each cartridge awards its skill.');
            return;
        }
        const cur = readVar(game.varId);
        this._helpWindow.setText(`${game.label}  (var ${game.varId}, skill ${game.skillId})\nCurrent plays: ${cur}    Trigger at: ${game.triggerVar}`);
    };

    window.Window_CabbyCodesVideoGamesList = Window_CabbyCodesVideoGamesList;

    //----------------------------------------------------------------------
    // Scene_CabbyCodesVideoGameValue - per-game value picker
    //----------------------------------------------------------------------

    function Scene_CabbyCodesVideoGameValue() {
        this.initialize(...arguments);
    }

    Scene_CabbyCodesVideoGameValue.prototype = Object.create(Scene_MenuBase.prototype);
    Scene_CabbyCodesVideoGameValue.prototype.constructor = Scene_CabbyCodesVideoGameValue;

    Scene_CabbyCodesVideoGameValue.prototype.activeGame = function() {
        return findGame(_activeGameId);
    };

    Scene_CabbyCodesVideoGameValue.prototype.create = function() {
        Scene_MenuBase.prototype.create.call(this);
        this.createHelpWindow();
        this.createValueWindow();
    };

    Scene_CabbyCodesVideoGameValue.prototype.createBackground = function() {
        Scene_MenuBase.prototype.createBackground.call(this);
        if (this._backgroundSprite) {
            this._backgroundSprite.opacity = 192;
        }
    };

    Scene_CabbyCodesVideoGameValue.prototype.createHelpWindow = function() {
        const game = this.activeGame();
        const optCount = game ? buildOptionsForGame(game).length : 1;
        const layout = pickerLayoutFor(this, optCount);
        const rect = new Rectangle(layout.x, layout.baseY, layout.width, layout.helpHeight);
        this._helpWindow = new Window_Help(rect);
        if (game) {
            const cur = readVar(game.varId);
            const status = actorHasSkill(game.skillId) ? 'Earned' : rowValueText(game);
            this._helpWindow.setText(`${game.label}\nPlays so far: ${cur}    Status: ${status}`);
        } else {
            this._helpWindow.setText('Video Games\nNo cartridge selected.');
        }
        this.addWindow(this._helpWindow);
    };

    Scene_CabbyCodesVideoGameValue.prototype.createValueWindow = function() {
        const game = this.activeGame();
        const options = game ? buildOptionsForGame(game) : [];
        const layout = pickerLayoutFor(this, options.length || 1);
        const rect = new Rectangle(
            layout.x,
            layout.baseY + layout.helpHeight + PICKER_SPACING,
            layout.width,
            layout.listHeight
        );
        this._valueWindow = new Window_CabbyCodesVideoGameValueList(rect);
        this._valueWindow.setOptions(options);
        this._valueWindow.setHandler('ok', this.onValueOk.bind(this));
        this._valueWindow.setHandler('cancel', this.onValueCancel.bind(this));
        this.addWindow(this._valueWindow);
        if (game) {
            this._valueWindow.select(currentOptionIndex(game));
        } else {
            this._valueWindow.select(0);
        }
        this._valueWindow.activate();
    };

    Scene_CabbyCodesVideoGameValue.prototype.onValueOk = function() {
        const game = this.activeGame();
        const option = this._valueWindow.currentOption();
        if (game && option) {
            applyOption(game, option);
        }
        SceneManager.pop();
    };

    Scene_CabbyCodesVideoGameValue.prototype.onValueCancel = function() {
        SceneManager.pop();
    };

    window.Scene_CabbyCodesVideoGameValue = Scene_CabbyCodesVideoGameValue;

    //----------------------------------------------------------------------
    // Window_CabbyCodesVideoGameValueList - pick "K Left" or "Earned"
    //----------------------------------------------------------------------

    function Window_CabbyCodesVideoGameValueList() {
        this.initialize(...arguments);
    }

    Window_CabbyCodesVideoGameValueList.prototype = Object.create(Window_Command.prototype);
    Window_CabbyCodesVideoGameValueList.prototype.constructor = Window_CabbyCodesVideoGameValueList;

    Window_CabbyCodesVideoGameValueList.prototype.initialize = function(rect) {
        this._options = [];
        Window_Command.prototype.initialize.call(this, rect);
    };

    Window_CabbyCodesVideoGameValueList.prototype.setOptions = function(options) {
        this._options = Array.isArray(options) ? options : [];
        this.refresh();
    };

    Window_CabbyCodesVideoGameValueList.prototype.makeCommandList = function() {
        (this._options || []).forEach((opt, index) => {
            this.addCommand(opt.label, `vg_value_${index}`, true, index);
        });
    };

    Window_CabbyCodesVideoGameValueList.prototype.numVisibleRows = function() {
        return Math.min(PICKER_MAX_ROWS, this.maxItems() || 1);
    };

    Window_CabbyCodesVideoGameValueList.prototype.currentOption = function() {
        const ext = this.currentExt();
        if (typeof ext !== 'number') {
            return null;
        }
        return this._options[ext] || null;
    };

    window.Window_CabbyCodesVideoGameValueList = Window_CabbyCodesVideoGameValueList;

    //----------------------------------------------------------------------
    // Scene_CabbyCodesVideoGamesConfirm - Yes/No prompt for the bulk action
    //----------------------------------------------------------------------

    function Scene_CabbyCodesVideoGamesConfirm() {
        this.initialize(...arguments);
    }

    Scene_CabbyCodesVideoGamesConfirm.prototype = Object.create(Scene_MenuBase.prototype);
    Scene_CabbyCodesVideoGamesConfirm.prototype.constructor = Scene_CabbyCodesVideoGamesConfirm;

    Scene_CabbyCodesVideoGamesConfirm.prototype.prepare = function(params = {}) {
        this._targetCount = Number(params.targetCount) || 0;
        this._modeId = params.modeId || 'oneLeft';
        this._onConfirm = params.onConfirm;
        this._onCancel = params.onCancel;
    };

    Scene_CabbyCodesVideoGamesConfirm.prototype.helpAreaHeight = function() {
        return 0;
    };

    Scene_CabbyCodesVideoGamesConfirm.prototype.create = function() {
        Scene_MenuBase.prototype.create.call(this);
        this.createInfoWindow();
        this.createCommandWindow();
    };

    Scene_CabbyCodesVideoGamesConfirm.prototype.createBackground = function() {
        Scene_MenuBase.prototype.createBackground.call(this);
        if (this._backgroundSprite) {
            this._backgroundSprite.opacity = 192;
        }
    };

    Scene_CabbyCodesVideoGamesConfirm.prototype.infoLines = function() {
        const n = this._targetCount;
        const noun = n === 1 ? 'cartridge' : 'cartridges';
        const mode = BULK_MODES[this._modeId] || BULK_MODES.oneLeft;
        return [
            `Set all unfinished to ${mode.label}`,
            `${n} unfinished ${noun} will be`,
            mode.confirmActionLine
        ];
    };

    Scene_CabbyCodesVideoGamesConfirm.prototype.commandWindowHeight = function() {
        return this.calcWindowHeight(2, true);
    };

    Scene_CabbyCodesVideoGamesConfirm.prototype.createInfoWindow = function() {
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

    Scene_CabbyCodesVideoGamesConfirm.prototype.createCommandWindow = function() {
        const ww = 400;
        const wh = this.commandWindowHeight();
        const wx = Math.floor((Graphics.boxWidth - ww) / 2);
        const wy = this._infoWindow.y + this._infoWindow.height + 16;
        this._commandWindow = new Window_CabbyCodesVideoGamesConfirm(new Rectangle(wx, wy, ww, wh));
        this._commandWindow.setHandler('confirm', this.onConfirm.bind(this));
        this._commandWindow.setHandler('cancel', this.onCancel.bind(this));
        // Default to "No, go back" so a stray Enter does nothing destructive.
        this._commandWindow.select(1);
        this._commandWindow.activate();
        this.addWindow(this._commandWindow);
    };

    Scene_CabbyCodesVideoGamesConfirm.prototype.onConfirm = function() {
        if (typeof this._onConfirm === 'function') {
            this._onConfirm();
            return;
        }
        SceneManager.pop();
    };

    Scene_CabbyCodesVideoGamesConfirm.prototype.onCancel = function() {
        if (typeof this._onCancel === 'function') {
            this._onCancel();
            return;
        }
        SceneManager.pop();
    };

    window.Scene_CabbyCodesVideoGamesConfirm = Scene_CabbyCodesVideoGamesConfirm;

    function Window_CabbyCodesVideoGamesConfirm() {
        this.initialize(...arguments);
    }

    Window_CabbyCodesVideoGamesConfirm.prototype = Object.create(Window_Command.prototype);
    Window_CabbyCodesVideoGamesConfirm.prototype.constructor = Window_CabbyCodesVideoGamesConfirm;

    Window_CabbyCodesVideoGamesConfirm.prototype.makeCommandList = function() {
        this.addCommand('Yes, apply',  'confirm');
        this.addCommand('No, go back', 'cancel');
    };

    window.Window_CabbyCodesVideoGamesConfirm = Window_CabbyCodesVideoGamesConfirm;

    //----------------------------------------------------------------------
    // Scene_CabbyCodesVideoGamesBulkMode - pick 1 Left or Earned
    //----------------------------------------------------------------------

    function Scene_CabbyCodesVideoGamesBulkMode() {
        this.initialize(...arguments);
    }

    Scene_CabbyCodesVideoGamesBulkMode.prototype = Object.create(Scene_MenuBase.prototype);
    Scene_CabbyCodesVideoGamesBulkMode.prototype.constructor = Scene_CabbyCodesVideoGamesBulkMode;

    Scene_CabbyCodesVideoGamesBulkMode.prototype.prepare = function(params = {}) {
        this._targetCount = Number(params.targetCount) || 0;
    };

    Scene_CabbyCodesVideoGamesBulkMode.prototype.create = function() {
        Scene_MenuBase.prototype.create.call(this);
        this.createHelpWindow();
        this.createListWindow();
    };

    Scene_CabbyCodesVideoGamesBulkMode.prototype.createBackground = function() {
        Scene_MenuBase.prototype.createBackground.call(this);
        if (this._backgroundSprite) {
            this._backgroundSprite.opacity = 192;
        }
    };

    Scene_CabbyCodesVideoGamesBulkMode.prototype.createHelpWindow = function() {
        const layout = pickerLayoutFor(this, 2);
        const rect = new Rectangle(layout.x, layout.baseY, layout.width, layout.helpHeight);
        this._helpWindow = new Window_Help(rect);
        const n = this._targetCount;
        const noun = n === 1 ? 'cartridge' : 'cartridges';
        this._helpWindow.setText(`Set all unfinished to...\n${n} unfinished ${noun}. Pick a target state.`);
        this.addWindow(this._helpWindow);
    };

    Scene_CabbyCodesVideoGamesBulkMode.prototype.createListWindow = function() {
        const layout = pickerLayoutFor(this, 2);
        const rect = new Rectangle(
            layout.x,
            layout.baseY + layout.helpHeight + PICKER_SPACING,
            layout.width,
            layout.listHeight
        );
        this._listWindow = new Window_CabbyCodesVideoGamesBulkMode(rect);
        this._listWindow.setHandler('ok', this.onModeOk.bind(this));
        this._listWindow.setHandler('cancel', this.onModeCancel.bind(this));
        this.addWindow(this._listWindow);
        this._listWindow.select(0);
        this._listWindow.activate();
    };

    Scene_CabbyCodesVideoGamesBulkMode.prototype.onModeOk = function() {
        const modeId = this._listWindow.currentSymbol();
        if (!BULK_MODES[modeId] || typeof Scene_CabbyCodesVideoGamesConfirm === 'undefined') {
            this._listWindow.activate();
            return;
        }
        const targetCount = this._targetCount;
        SceneManager.push(Scene_CabbyCodesVideoGamesConfirm);
        if (typeof SceneManager.prepareNextScene === 'function') {
            SceneManager.prepareNextScene({
                targetCount,
                modeId,
                onConfirm: () => {
                    const updated = applyBulkUnfinished(modeId);
                    if (updated > 0) {
                        SoundManager.playUseSkill();
                    } else {
                        SoundManager.playBuzzer();
                    }
                    // Pop both Confirm and BulkMode in one go so the user
                    // lands back on the main video games list with refreshed
                    // values. SceneManager.pop sets _nextScene each call, and
                    // _stack.pop removes one entry per call, so two pops in
                    // the same tick = goto the scene two levels back.
                    SceneManager.pop();
                    SceneManager.pop();
                },
                onCancel: () => SceneManager.pop()
            });
        }
    };

    Scene_CabbyCodesVideoGamesBulkMode.prototype.onModeCancel = function() {
        SceneManager.pop();
    };

    window.Scene_CabbyCodesVideoGamesBulkMode = Scene_CabbyCodesVideoGamesBulkMode;

    function Window_CabbyCodesVideoGamesBulkMode() {
        this.initialize(...arguments);
    }

    Window_CabbyCodesVideoGamesBulkMode.prototype = Object.create(Window_Command.prototype);
    Window_CabbyCodesVideoGamesBulkMode.prototype.constructor = Window_CabbyCodesVideoGamesBulkMode;

    Window_CabbyCodesVideoGamesBulkMode.prototype.makeCommandList = function() {
        this.addCommand(BULK_MODES.oneLeft.label, 'oneLeft');
        this.addCommand(BULK_MODES.earned.label,  'earned');
    };

    Window_CabbyCodesVideoGamesBulkMode.prototype.numVisibleRows = function() {
        return 2;
    };

    window.Window_CabbyCodesVideoGamesBulkMode = Window_CabbyCodesVideoGamesBulkMode;

    CabbyCodes.log('[CabbyCodes] Video Games module loaded');
})();
