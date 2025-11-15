//=============================================================================
// CabbyCodes Version Display
//=============================================================================
/*:
 * @target MZ
 * @plugindesc CabbyCodes UI - Shows the CabbyCodes version on the Options screen
 * @author CabbyCodes
 * @help
 * Displays the currently running CabbyCodes version at the bottom of the
 * Options menu so players can quickly confirm which build is installed.
 */

(() => {
    'use strict';

    if (typeof window.CabbyCodes === 'undefined') {
        return;
    }

    const VERSION_UNKNOWN = '?.?.?';
    const OPTIONS_SIDE_PADDING = 24;
    const OPTIONS_TOP_PADDING = 24;
    const OPTIONS_BOTTOM_PADDING = 24;
    const VERSION_GAP = 12;
    const OPTIONS_MAX_WIDTH = 520;
    const VERSION_WINDOW_LINES = 1;
    const CABBYCODES_LABEL = 'CabbyCodes';
    const CABBYCODES_LABEL_COLOR = '#3f82ff';

    function desiredOptionsWidth() {
        const available = Math.max(0, Graphics.boxWidth - OPTIONS_SIDE_PADDING * 2);
        return Math.min(OPTIONS_MAX_WIDTH, available);
    }

    function versionWindowHeight(scene) {
        return scene.calcWindowHeight(VERSION_WINDOW_LINES, false);
    }

    function availableOptionsHeight(scene) {
        const totalAvailable = Math.max(
            0,
            Graphics.boxHeight - OPTIONS_TOP_PADDING - OPTIONS_BOTTOM_PADDING - versionWindowHeight(scene) - VERSION_GAP
        );
        const commandLines = Math.max(1, scene.maxCommands());
        const commandHeight = scene.calcWindowHeight(commandLines, true);
        const limitedHeight = Math.min(totalAvailable, commandHeight);
        if (limitedHeight > 0) {
            return limitedHeight;
        }
        return Math.min(commandHeight, scene.calcWindowHeight(6, true));
    }

    function applyOverride(methodName, implementation) {
        if (typeof CabbyCodes.override === 'function') {
            CabbyCodes.override(Scene_Options.prototype, methodName, implementation);
        } else {
            Scene_Options.prototype[methodName] = implementation;
        }
    }

    /**
     * Small informative window that renders the CabbyCodes version text.
     */
    function Window_CabbyCodesVersionInfo() {
        this.initialize(...arguments);
    }

    window.Window_CabbyCodesVersionInfo = Window_CabbyCodesVersionInfo;

    Window_CabbyCodesVersionInfo.prototype = Object.create(Window_Base.prototype);
    Window_CabbyCodesVersionInfo.prototype.constructor = Window_CabbyCodesVersionInfo;

    Window_CabbyCodesVersionInfo.prototype.initialize = function(rect) {
        Window_Base.prototype.initialize.call(this, rect);
        this.refresh();
    };

    Window_CabbyCodesVersionInfo.prototype.versionText = function() {
        const version = CabbyCodes.version || VERSION_UNKNOWN;
        return ` v${version}`;
    };

    Window_CabbyCodesVersionInfo.prototype.refresh = function() {
        this.contents.clear();
        this.resetFontSettings();
        const label = CABBYCODES_LABEL;
        const versionText = this.versionText();
        const labelWidth = this.textWidth(label + ' ');
        const versionWidth = this.textWidth(versionText);
        const totalWidth = labelWidth + versionWidth;
        const x = Math.max(0, Math.floor((this.contents.width - totalWidth) / 2));
        const y = Math.floor((this.contents.height - this.lineHeight()) / 2);
        this.changeTextColor(CABBYCODES_LABEL_COLOR);
        this.drawText(label, x, y, labelWidth, 'left');
        this.changeTextColor(ColorManager.normalColor());
        this.drawText(versionText, x + labelWidth, y, versionWidth, 'left');
    };

    /**
     * Expand the options list to reflect the real CabbyCodes setting count.
     */
    const _Scene_Options_maxCommands = Scene_Options.prototype.maxCommands;
    applyOverride('maxCommands', function() {
        const base = typeof _Scene_Options_maxCommands === 'function'
            ? _Scene_Options_maxCommands.call(this)
            : 7;
        const extra = Array.isArray(CabbyCodes.settingsRegistry) ? CabbyCodes.settingsRegistry.length : 0;
        return base + extra;
    });

    const _Scene_Options_maxVisibleCommands = Scene_Options.prototype.maxVisibleCommands;
    applyOverride('maxVisibleCommands', function() {
        const base = typeof _Scene_Options_maxVisibleCommands === 'function'
            ? _Scene_Options_maxVisibleCommands.call(this)
            : 12;
        return Math.max(base, this.maxCommands());
    });

    applyOverride('optionsWindowRect', function() {
        const ww = desiredOptionsWidth();
        const wh = availableOptionsHeight(this);
        const wx = (Graphics.boxWidth - ww) / 2;
        const wy = OPTIONS_TOP_PADDING;
        return new Rectangle(wx, wy, ww, wh);
    });

    /**
     * Calculates and creates the version window for Scene_Options.
     */
    Scene_Options.prototype.createCabbyCodesVersionWindow = function() {
        if (this._cabbyCodesVersionWindow) {
            return;
        }
        const rect = this.cabbyCodesVersionWindowRect();
        this._cabbyCodesVersionWindow = new Window_CabbyCodesVersionInfo(rect);
        this.addWindow(this._cabbyCodesVersionWindow);
    };

    Scene_Options.prototype.cabbyCodesVersionWindowRect = function() {
        const ww = this._optionsWindow ? this._optionsWindow.width : desiredOptionsWidth();
        const wh = versionWindowHeight(this);
        const wx = this._optionsWindow ? this._optionsWindow.x : (Graphics.boxWidth - ww) / 2;
        const preferredWy = this._optionsWindow
            ? this._optionsWindow.y + this._optionsWindow.height + VERSION_GAP
            : Graphics.boxHeight - OPTIONS_BOTTOM_PADDING - wh;
        const maxWy = Graphics.boxHeight - OPTIONS_BOTTOM_PADDING - wh;
        const wy = Math.min(preferredWy, maxWy);
        return new Rectangle(wx, wy, ww, wh);
    };

    const attachVersionWindow = function() {
        if (typeof this.createCabbyCodesVersionWindow === 'function') {
            this.createCabbyCodesVersionWindow();
        }
    };

    if (typeof CabbyCodes.after === 'function') {
        CabbyCodes.after(Scene_Options.prototype, 'create', function() {
            attachVersionWindow.call(this);
        });
    } else {
        const _Scene_Options_create = Scene_Options.prototype.create;
        Scene_Options.prototype.create = function() {
            _Scene_Options_create.call(this);
            attachVersionWindow.call(this);
        };
    }

    CabbyCodes.log('[CabbyCodes] Version display initialized');
})();


