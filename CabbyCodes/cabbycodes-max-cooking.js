//=============================================================================
// CabbyCodes Max Cooking Skill
//=============================================================================
/*:
 * @target MZ
 * @plugindesc CabbyCodes Max Cooking Skill - Instantly caps Cooking skill with confirmation.
 * @author CabbyCodes
 * @help
 * Adds a CabbyCodes Options entry that permanently sets the Cooking secondary
 * skill to the game's effective cap (Level 8 / "Amateur Chef") after the
 * player confirms the irreversible action.
 */

(() => {
    'use strict';

    if (typeof window.CabbyCodes === 'undefined') {
        console.warn('[CabbyCodes] Max Cooking Skill requires CabbyCodes core.');
        return;
    }

    const COOKING_RANK_TITLES = Object.freeze([
        'Pan-Wielder',
        'Cooking Dabbler',
        'Kitchen Novice',
        'Marmiton',
        'Home Cook',
        'Self-Taught Cook',
        'Food Nerd',
        'Amateur Chef'
    ]);
    const MAX_COOKING_LEVEL = COOKING_RANK_TITLES.length;
    const FINAL_RANK_TITLE =
        COOKING_RANK_TITLES[MAX_COOKING_LEVEL - 1] || 'Chef';
    const BASE_EXP_REQUIREMENT = 50;
    const EXP_REQUIREMENT_INCREMENT = 25;
    const COOKING_EXP_NEED_VARIABLE_ID = 418;
    const COOKING_LEVEL_VARIABLE_ID = 419;
    const COOKING_EXP_VARIABLE_ID = 420;
    const SETTING_KEY = 'maxCookingSkill';
    const SETTINGS_SYMBOL = `cabbycodes_${SETTING_KEY}`;

    const CONFIRMATION_TEXT =
        `WARNING:\n` +
        `This permanently sets your Cooking Skill to Level ${MAX_COOKING_LEVEL} ` +
        `(${FINAL_RANK_TITLE}) and cannot be undone.\nProceed?`;

    CabbyCodes.registerSetting(SETTING_KEY, 'Max Cooking Skill', {
        defaultValue: false,
        order: 105,
        formatValue: () => 'Press'
    });

    /**
     * Calculates the next XP requirement value that the base game stores in
     * variable 418 after reaching a given level.
     * @param {number} level
     * @returns {number}
     */
    function expRequirementForLevel(level) {
        const normalized = Math.max(1, Number(level) || 1);
        return (
            BASE_EXP_REQUIREMENT +
            (normalized - 1) * EXP_REQUIREMENT_INCREMENT
        );
    }

    /**
     * Applies the max cooking skill effect to the current save data.
     * @returns {{success: boolean, message: string}}
     */
    function applyMaxCookingSkill() {
        if (typeof $gameVariables === 'undefined' || !$gameVariables) {
            const message =
                'CabbyCodes: Game variables are not ready yet. Load a save before using this option.';
            CabbyCodes.warn(`[CabbyCodes] ${message}`);
            return { success: false, message };
        }

        const previousLevel = Number(
            $gameVariables.value(COOKING_LEVEL_VARIABLE_ID) || 0
        );
        const alreadyMaxed = previousLevel >= MAX_COOKING_LEVEL;

        $gameVariables.setValue(
            COOKING_LEVEL_VARIABLE_ID,
            MAX_COOKING_LEVEL
        );
        $gameVariables.setValue(
            COOKING_EXP_VARIABLE_ID,
            0
        );
        $gameVariables.setValue(
            COOKING_EXP_NEED_VARIABLE_ID,
            expRequirementForLevel(MAX_COOKING_LEVEL)
        );

        // Persist the change for in-progress scenes.
        if ($gameVariables.onChange) {
            $gameVariables.onChange();
        }

        const summary = `Level ${MAX_COOKING_LEVEL} (${FINAL_RANK_TITLE})`;
        const message = alreadyMaxed
            ? `Cooking skill is already at ${summary}.`
            : `Cooking skill set to ${summary}.`;
        CabbyCodes.log(`[CabbyCodes] ${message}`);
        return { success: true, message };
    }

    /**
     * Opens the confirmation scene from the options window.
     */
    function openConfirmationScene() {
        if (
            typeof SceneManager === 'undefined' ||
            typeof SceneManager.push !== 'function'
        ) {
            CabbyCodes.warn(
                '[CabbyCodes] SceneManager is not available; cannot open Max Cooking confirmation.'
            );
            return;
        }
        if (typeof Scene_CabbyCodesCookingConfirm === 'undefined') {
            CabbyCodes.warn(
                '[CabbyCodes] Confirmation scene is unavailable; cannot max Cooking skill.'
            );
            return;
        }
        SceneManager.push(Scene_CabbyCodesCookingConfirm);
    }

    /**
     * Installs a hook on Window_Options to intercept our press-style setting.
     * @returns {boolean}
     */
    function setupProcessOkHook() {
        if (typeof Window_Options === 'undefined') {
            return false;
        }
        if (Window_Options.prototype._cabbycodesMaxCookingHookInstalled) {
            return true;
        }
        const previousProcessOk = Window_Options.prototype.processOk;
        if (typeof previousProcessOk !== 'function') {
            return false;
        }

        Window_Options.prototype.processOk = function() {
            const symbol = this.commandSymbol(this.index());
            if (symbol === SETTINGS_SYMBOL) {
                openConfirmationScene();
                return;
            }
            previousProcessOk.call(this);
        };
        Window_Options.prototype._cabbycodesMaxCookingHookInstalled = true;
        return true;
    }

    if (!setupProcessOkHook()) {
        const hookInterval = setInterval(() => {
            if (setupProcessOkHook()) {
                clearInterval(hookInterval);
            }
        }, 10);
        setTimeout(() => {
            clearInterval(hookInterval);
            if (!Window_Options.prototype._cabbycodesMaxCookingHookInstalled) {
                CabbyCodes.warn(
                    '[CabbyCodes] Failed to hook Window_Options for Max Cooking Skill within 5 seconds.'
                );
            }
        }, 5000);
    }

    //--------------------------------------------------------------------------
    // Confirmation Scene
    //--------------------------------------------------------------------------

    function Scene_CabbyCodesCookingConfirm() {
        this.initialize(...arguments);
    }

    window.Scene_CabbyCodesCookingConfirm =
        Scene_CabbyCodesCookingConfirm;

    Scene_CabbyCodesCookingConfirm.prototype = Object.create(
        Scene_MenuBase.prototype
    );
    Scene_CabbyCodesCookingConfirm.prototype.constructor =
        Scene_CabbyCodesCookingConfirm;

    Scene_CabbyCodesCookingConfirm.prototype.helpAreaHeight = function() {
        return 0;
    };

    Scene_CabbyCodesCookingConfirm.prototype.create = function() {
        Scene_MenuBase.prototype.create.call(this);
        this.createInfoWindow();
        this.createCommandWindow();
    };

    Scene_CabbyCodesCookingConfirm.prototype.createInfoWindow = function() {
        const rect = this.infoWindowRect();
        const uiApi = CabbyCodes.ui || {};
        const factory = typeof uiApi.createInfoBox === 'function'
            ? uiApi.createInfoBox
            : (rectParam, textParam) => {
                  const win = new Window_CabbyCodesInfoBox(rectParam);
                  if (win.setText) {
                      win.setText(textParam);
                  }
                  return win;
              };
        this._infoWindow = factory(rect, CONFIRMATION_TEXT);
        if (this._infoWindow && typeof this._infoWindow.setText === 'function') {
            this._infoWindow.setText(CONFIRMATION_TEXT);
        }
        this.addWindow(this._infoWindow);
    };

    Scene_CabbyCodesCookingConfirm.prototype.infoWindowRect = function() {
        const ww = Math.min(Graphics.boxWidth - 96, 640);
        const wx = (Graphics.boxWidth - ww) / 2;
        const wy = this.buttonAreaBottom() + 12;
        const wh = this.calcWindowHeight(3, false);
        return new Rectangle(wx, wy, ww, wh);
    };

    Scene_CabbyCodesCookingConfirm.prototype.createCommandWindow = function() {
        const rect = this.commandWindowRect();
        this._commandWindow = new Window_CabbyCodesCookingConfirm(rect);
        this._commandWindow.setHandler(
            'confirm',
            this.onConfirm.bind(this)
        );
        this._commandWindow.setHandler(
            'cancel',
            this.onCancel.bind(this)
        );
        this.addWindow(this._commandWindow);
    };

    Scene_CabbyCodesCookingConfirm.prototype.commandWindowRect = function() {
        const ww = 360;
        const wh = this.calcWindowHeight(2, true);
        const wx = (Graphics.boxWidth - ww) / 2;
        const spacing = 18;
        const baseY = this._infoWindow
            ? this._infoWindow.y + this._infoWindow.height + spacing
            : this.buttonAreaBottom() + spacing;
        const maxY = Graphics.boxHeight - wh - spacing;
        const wy = Math.min(baseY, maxY);
        return new Rectangle(wx, wy, ww, wh);
    };

    Scene_CabbyCodesCookingConfirm.prototype.onConfirm = function() {
        const result = applyMaxCookingSkill();
        if (typeof $gameMessage !== 'undefined' && $gameMessage.add) {
            $gameMessage.add(result.message);
        }
        SceneManager.pop();
    };

    Scene_CabbyCodesCookingConfirm.prototype.onCancel = function() {
        SceneManager.pop();
    };

    //--------------------------------------------------------------------------
    // Confirmation Window
    //--------------------------------------------------------------------------

    function Window_CabbyCodesCookingConfirm() {
        this.initialize(...arguments);
    }

    Window_CabbyCodesCookingConfirm.prototype = Object.create(
        Window_Command.prototype
    );
    Window_CabbyCodesCookingConfirm.prototype.constructor =
        Window_CabbyCodesCookingConfirm;

    Window_CabbyCodesCookingConfirm.prototype.makeCommandList = function() {
        this.addCommand('Yes, max it', 'confirm');
        this.addCommand('No, go back', 'cancel');
    };

    //--------------------------------------------------------------------------
    // Window_CabbyCodesInfoBox
    //--------------------------------------------------------------------------

    function Window_CabbyCodesInfoBox() {
        this.initialize(...arguments);
    }

    window.Window_CabbyCodesInfoBox = Window_CabbyCodesInfoBox;
    CabbyCodes.WindowInfoBox = Window_CabbyCodesInfoBox;

    Window_CabbyCodesInfoBox.prototype = Object.create(Window_Base.prototype);
    Window_CabbyCodesInfoBox.prototype.constructor =
        Window_CabbyCodesInfoBox;

    Window_CabbyCodesInfoBox.prototype.initialize = function(rect) {
        Window_Base.prototype.initialize.call(this, rect);
        this._text = '';
        this._minLines = 1;
        this._wrappedLines = [];
    };

    Window_CabbyCodesInfoBox.prototype.setMinLines = function(value) {
        const normalized = Math.max(1, Number(value) || 1);
        if (this._minLines !== normalized) {
            this._minLines = normalized;
            this.refresh();
        }
    };

    Window_CabbyCodesInfoBox.prototype.setText = function(text) {
        const normalized = String(text || '');

        if (this._text === normalized) {
            return;
        }
        this._text = normalized;
        this.refresh();
    };

    Window_CabbyCodesInfoBox.prototype.refresh = function() {
        if (!this.contents) {
            this.createContents();
        }
        this.resetFontSettings();
        const innerWidth = Math.max(
            0,
            typeof this.innerWidth === 'function'
                ? this.innerWidth()
                : Number(this.innerWidth) || 0
        );
        this._wrappedLines = this.wrapTextToWidth(this._text, innerWidth);
        const desiredLines = Math.max(
            this._minLines,
            this._wrappedLines.length || 1
        );
        const desiredHeight = this.fittingHeight(desiredLines);
        if (this.height !== desiredHeight) {
            this.height = desiredHeight;
            this._refreshAllParts();
            this.createContents();
        } else {
            this.createContents();
        }
        this.contents.clear();
        this._wrappedLines.forEach((line, index) => {
            this.drawText(line, 0, index * this.lineHeight(), innerWidth);
        });
    };

    Window_CabbyCodesInfoBox.prototype.wrapTextToWidth = function(
        text,
        width
    ) {
        if (!this.contents) {
            this.createContents();
        }
        const safeWidth = Math.max(0, width || 0);
        const paragraphs = String(text || '').split(/\r?\n/);
        const lines = [];
        paragraphs.forEach(paragraph => {
            const words = paragraph.split(/\s+/).filter(Boolean);
            if (words.length === 0) {
                lines.push('');
                return;
            }
            let currentLine = '';
            words.forEach(word => {
                const candidate = currentLine
                    ? `${currentLine} ${word}`
                    : word;
                const candidateWidth = safeWidth
                    ? this.textWidth(candidate)
                    : 0;
                if (!safeWidth || !currentLine || candidateWidth <= safeWidth) {
                    currentLine = candidate;
                    return;
                }
                lines.push(currentLine);
                currentLine = this.handleOverflowWord(word, safeWidth, lines);
            });
            if (currentLine) {
                lines.push(currentLine);
            }
        });
        if (lines.length === 0) {
            lines.push('');
        }
        return lines;
    };

    Window_CabbyCodesInfoBox.prototype.handleOverflowWord = function(
        word,
        maxWidth,
        lines
    ) {
        if (!maxWidth || this.textWidth(word) <= maxWidth) {
            return word;
        }
        const segments = this.forceSplitWord(word, maxWidth);
        if (segments.length === 0) {
            return '';
        }
        const trailingSegment = segments.pop();
        segments.forEach(segment => lines.push(segment));
        return trailingSegment || '';
    };

    Window_CabbyCodesInfoBox.prototype.forceSplitWord = function(
        word,
        maxWidth
    ) {
        if (!maxWidth) {
            return [word];
        }
        const segments = [];
        let current = '';
        for (const char of word) {
            const candidate = current + char;
            if (!current || this.textWidth(candidate) <= maxWidth) {
                current = candidate;
            } else {
                segments.push(current);
                current = char;
            }
        }
        if (current) {
            segments.push(current);
        }
        return segments;
    };

    const cabbyUiApi = (CabbyCodes.ui = CabbyCodes.ui || {});
    cabbyUiApi.createInfoBox = function(rect, text = '', options = {}) {
        const windowInstance = new Window_CabbyCodesInfoBox(rect);
        if (options && typeof options.minLines === 'number') {
            windowInstance.setMinLines(options.minLines);
        }
        if (typeof text !== 'undefined') {
            windowInstance.setText(text);
        }
        return windowInstance;
    };
})();


