//=============================================================================
// CabbyCodes Hidden Stats HUD
//=============================================================================
/*:
 * @target MZ
 * @plugindesc CabbyCodes Hidden Stats HUD - Press-to-open reader for hidden needs
 * @author CabbyCodes
 * @help
 * Adds a "Press" option to the CabbyCodes section of the Options menu that
 * instantly opens a compact readout of the normally hidden personal-need meters
 * (hunger, tiredness, hygiene, morale, calm, social, and the breath odor timer).
 * Press OK/Cancel to exit the window and return to the game.
 */

(() => {
    'use strict';

    if (typeof window.CabbyCodes === 'undefined') {
        console.warn('[CabbyCodes] Hidden Stats HUD requires the core module.');
        return;
    }

    const moduleApi = (CabbyCodes.hiddenStatsDisplay = CabbyCodes.hiddenStatsDisplay || {});
    const legacyToggleKey = 'showHiddenNeedsHud';
    const settingKey = 'hiddenNeedsHud';

    // Clean up the legacy toggle to avoid leaving invisible overlays enabled.
    if (
        CabbyCodes.settings &&
        Object.prototype.hasOwnProperty.call(CabbyCodes.settings, legacyToggleKey)
    ) {
        delete CabbyCodes.settings[legacyToggleKey];
        if (typeof CabbyCodes.saveSettings === 'function') {
            CabbyCodes.saveSettings();
        }
    }

    /**
     * Variable IDs used by Look Outside for hidden personal needs.
     * These were captured via event inspection and constants inside freeze modules.
     */
    const STAT_DEFINITIONS = [
        {
            key: 'hunger',
            variableId: 24,
            label: 'Hunger',
            minValue: 0,
            maxValue: 100,
            description: 'Higher values mean you are fuller.',
            order: 10
        },
        {
            key: 'vigor',
            variableId: 23,
            label: 'Energy',
            minValue: 0,
            maxValue: 100,
            description: 'Higher values mean you are rested.',
            order: 20
        },
        {
            key: 'hygiene',
            variableId: 25,
            label: 'Hygiene',
            minValue: 0,
            maxValue: 100,
            description: 'Tracks how clean you feel.',
            order: 30
        },
        {
            key: 'morale',
            variableId: 26,
            label: 'Morale',
            minValue: 0,
            maxValue: 100,
            description: 'Impacts mood events.',
            order: 40
        },
        {
            key: 'calm',
            variableId: 22,
            label: 'Calm',
            minValue: 0,
            maxValue: 100,
            description: 'Higher values mean lower stress.',
            order: 50
        },
        {
            key: 'social',
            variableId: 21,
            label: 'Social',
            minValue: 0,
            maxValue: 100,
            description: 'Tracks loneliness related events.',
            order: 60
        },
        {
            key: 'breath',
            variableId: 117,
            label: 'Breath Odor',
            minValue: 0,
            maxValue: 100,
            description: 'Higher values are worse; 0 is fresh, 100 is rancid.',
            highIsGood: false,
            labels: {
                great: 'Fresh',
                good: 'Okay',
                warning: 'Warning',
                danger: 'Halitosis'
            },
            order: 70
        }
    ].sort((a, b) => (a.order || 0) - (b.order || 0));

    const WINDOW_WIDTH = 420;
    const ROW_SPACING = 12;
    const REFRESH_INTERVAL_FRAMES = 10;
    const HEADER_TEXT = 'Hidden Needs';
    const LABEL_WIDTH = 156;
    const SEVERITY_WIDTH = 120;
    const VALUE_WIDTH = 64;
    const COLUMN_GAP = 16;
    const GAUGE_HEIGHT = 8;
    const GAUGE_EXTRA_OFFSET = 4;
    const CONTENT_PADDING = 12;
    const STATUS_COLORS = {
        great: '#68ffd1',
        good: '#c7ff9f',
        warning: '#ffd970',
        danger: '#ff6f7a'
    };
    const GAUGE_BACKGROUND_COLOR = 'rgba(255, 255, 255, 0.18)';
    const FOOTER_TEXT = 'Press any button to return';
    const RESET_DELAY_MS = 30;

    CabbyCodes.registerSetting(settingKey, 'Hidden Needs HUD', {
        defaultValue: false,
        order: 62,
        formatValue: () => 'Press',
        onChange: newValue => {
            if (!newValue) {
                return;
            }
            openHiddenStatsScene();
            scheduleReset();
        }
    });

    moduleApi.settingKey = settingKey;
    moduleApi.openViewer = () => {
        openHiddenStatsScene();
    };
    moduleApi.getStatDefinitions = () => STAT_DEFINITIONS.map(def => Object.assign({}, def));
    moduleApi.createSnapshot = createSnapshot;
    moduleApi.describeStat = describeStat;

    function scheduleReset() {
        if (typeof setTimeout !== 'function') {
            CabbyCodes.setSetting(settingKey, false);
            return;
        }
        setTimeout(() => {
            CabbyCodes.setSetting(settingKey, false);
        }, RESET_DELAY_MS);
    }

    function openHiddenStatsScene() {
        if (typeof SceneManager === 'undefined' || typeof SceneManager.push !== 'function') {
            CabbyCodes.warn('[CabbyCodes] Hidden stats HUD could not open (SceneManager missing)');
            return;
        }
        if (typeof Scene_CabbyCodesHiddenStats === 'undefined') {
            CabbyCodes.warn('[CabbyCodes] Hidden stats scene is unavailable.');
            return;
        }
        SceneManager.push(Scene_CabbyCodesHiddenStats);
    }

    function clamp(value, min, max) {
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) {
            return min;
        }
        return Math.max(min, Math.min(max, numeric));
    }

    function readGameVariable(variableId) {
        if (typeof $gameVariables === 'undefined' || !$gameVariables) {
            return 0;
        }
        const result = Number($gameVariables.value(variableId));
        if (!Number.isFinite(result)) {
            return 0;
        }
        return result;
    }

    function createSnapshot() {
        const snapshot = Object.create(null);
        for (const stat of STAT_DEFINITIONS) {
            snapshot[stat.key] = readGameVariable(stat.variableId);
        }
        return snapshot;
    }

    function snapshotsDiffer(previous, next) {
        if (!previous || !next) {
            return true;
        }
        for (const stat of STAT_DEFINITIONS) {
            if (previous[stat.key] !== next[stat.key]) {
                return true;
            }
        }
        return false;
    }

    function describeStat(stat, rawValue) {
        const min = typeof stat.minValue === 'number' ? stat.minValue : 0;
        const max = typeof stat.maxValue === 'number' ? stat.maxValue : 100;
        const safeMax = Math.max(min + 1, max);
        const clamped = clamp(rawValue, min, safeMax);
        const normalized = (clamped - min) / (safeMax - min);
        const effectiveness = stat.highIsGood === false ? 1 - normalized : normalized;
        let severity;
        if (effectiveness >= 0.8) {
            severity = 'great';
        } else if (effectiveness >= 0.55) {
            severity = 'good';
        } else if (effectiveness >= 0.3) {
            severity = 'warning';
        } else {
            severity = 'danger';
        }
        const labels = stat.labels || {};
        const defaultLabels = {
            great: 'Great',
            good: 'Stable',
            warning: 'Low',
            danger: 'Critical'
        };
        return {
            value: clamped,
            fillRatio: effectiveness,
            severity,
            severityLabel: labels[severity] || defaultLabels[severity],
            color: STATUS_COLORS[severity] || '#ffffff'
        };
    }

    function formatValue(stat, value) {
        const min = typeof stat.minValue === 'number' ? stat.minValue : 0;
        const max = typeof stat.maxValue === 'number' ? stat.maxValue : 100;
        const normalized = clamp(value, min, max);
        return `${Math.round(normalized)}`;
    }

    function Window_CabbyCodesHiddenStats() {
        this.initialize(...arguments);
    }

    window.Window_CabbyCodesHiddenStats = Window_CabbyCodesHiddenStats;

    Window_CabbyCodesHiddenStats.prototype = Object.create(Window_Base.prototype);
    Window_CabbyCodesHiddenStats.prototype.constructor = Window_CabbyCodesHiddenStats;

    Window_CabbyCodesHiddenStats.prototype.initialize = function(rect) {
        Window_Base.prototype.initialize.call(this, rect);
        this.opacity = 255;
        this._lastSnapshot = null;
        this._refreshTimer = 0;
        this._rowSpacing = ROW_SPACING;
        this.refreshPanelBackground();
        this.requestImmediateRefresh();
    };

    Window_CabbyCodesHiddenStats.prototype.refreshPanelBackground = function() {
        if (!this.contentsBack) {
            return;
        }
        this.contentsBack.clear();
        this.contentsBack.gradientFillRect(
            0,
            0,
            this.contentsBack.width,
            this.contentsBack.height,
            'rgba(6, 12, 24, 0.95)',
            'rgba(6, 12, 24, 0.75)',
            true
        );
    };

    Window_CabbyCodesHiddenStats.prototype.update = function() {
        Window_Base.prototype.update.call(this);
        if (this._refreshTimer > 0) {
            this._refreshTimer -= 1;
        }
        if (this._refreshTimer <= 0) {
            this._refreshTimer = REFRESH_INTERVAL_FRAMES;
            this.refreshIfNeeded();
        }
    };

    Window_CabbyCodesHiddenStats.prototype.refreshIfNeeded = function(force) {
        const snapshot = createSnapshot();
        if (!force && !snapshotsDiffer(this._lastSnapshot, snapshot)) {
            return;
        }
        this._lastSnapshot = snapshot;
        this.redraw(snapshot);
    };

    Window_CabbyCodesHiddenStats.prototype.requestImmediateRefresh = function() {
        this._refreshTimer = 0;
        this._lastSnapshot = null;
        this.refreshIfNeeded(true);
    };

    Window_CabbyCodesHiddenStats.prototype.redraw = function(snapshot) {
        this.contents.clear();
        this.resetFontSettings();
        const usableWidth = this.contentsWidth() - CONTENT_PADDING * 2;
        const lineHeight = this.lineHeight();
        let offsetY = CONTENT_PADDING;

        this.changeTextColor(ColorManager.systemColor());
        this.drawText(HEADER_TEXT, CONTENT_PADDING, offsetY, usableWidth, 'left');
        offsetY += lineHeight;

        for (const stat of STAT_DEFINITIONS) {
            const value = snapshot[stat.key] ?? 0;
            this.drawStatLine(stat, value, offsetY, usableWidth);
            offsetY += lineHeight + this._rowSpacing;
        }

        if (FOOTER_TEXT) {
            this.changeTextColor(ColorManager.textColor(6));
            this.drawText(FOOTER_TEXT, CONTENT_PADDING, offsetY + 4, usableWidth, 'center');
        }
    };

    Window_CabbyCodesHiddenStats.prototype.drawStatLine = function(stat, value, top, usableWidth) {
        const lineHeight = this.lineHeight();
        const descriptor = describeStat(stat, value);
        const displayValue = formatValue(stat, descriptor.value);
        const severityX = CONTENT_PADDING + LABEL_WIDTH + COLUMN_GAP;
        const valueX = CONTENT_PADDING + usableWidth - VALUE_WIDTH;
        const severityWidth = Math.max(0, valueX - COLUMN_GAP - severityX);

        this.changeTextColor(ColorManager.systemColor());
        this.drawText(stat.label, CONTENT_PADDING, top, LABEL_WIDTH, 'left');

        this.changeTextColor(descriptor.color);
        this.drawText(descriptor.severityLabel, severityX, top, severityWidth, 'left');

        this.changeTextColor(ColorManager.normalColor());
        this.drawText(displayValue, valueX, top, VALUE_WIDTH, 'right');

        const gaugeY = top + lineHeight - GAUGE_EXTRA_OFFSET;
        this.drawGaugeBar(
            CONTENT_PADDING,
            gaugeY,
            usableWidth,
            descriptor.fillRatio,
            descriptor.color
        );
    };

    Window_CabbyCodesHiddenStats.prototype.drawGaugeBar = function(x, y, width, ratio, color) {
        const height = GAUGE_HEIGHT;
        this.contents.fillRect(x, y, width, height, GAUGE_BACKGROUND_COLOR);
        const filledWidth = Math.floor(width * clamp(ratio, 0, 1));
        if (filledWidth > 0) {
            this.contents.fillRect(x, y, filledWidth, height, color);
        }
    };

    // -- Scene implementation --------------------------------------------------

    function Scene_CabbyCodesHiddenStats() {
        this.initialize(...arguments);
    }

    window.Scene_CabbyCodesHiddenStats = Scene_CabbyCodesHiddenStats;

    Scene_CabbyCodesHiddenStats.prototype = Object.create(Scene_MenuBase.prototype);
    Scene_CabbyCodesHiddenStats.prototype.constructor = Scene_CabbyCodesHiddenStats;

    Scene_CabbyCodesHiddenStats.prototype.initialize = function() {
        Scene_MenuBase.prototype.initialize.call(this);
    };

    Scene_CabbyCodesHiddenStats.prototype.create = function() {
        Scene_MenuBase.prototype.create.call(this);
        this.createHiddenStatsWindow();
    };

    Scene_CabbyCodesHiddenStats.prototype.update = function() {
        Scene_MenuBase.prototype.update.call(this);
        if (
            Input.isTriggered('cancel') ||
            Input.isTriggered('ok') ||
            TouchInput.isCancelled()
        ) {
            SoundManager.playCancel();
            this.popScene();
        }
    };

    Scene_CabbyCodesHiddenStats.prototype.createHiddenStatsWindow = function() {
        const rect = this.hiddenStatsWindowRect();
        this._hiddenStatsWindow = new Window_CabbyCodesHiddenStats(rect);
        this.addWindow(this._hiddenStatsWindow);
    };

    Scene_CabbyCodesHiddenStats.prototype.hiddenStatsWindowRect = function() {
        const ww = Math.min(WINDOW_WIDTH, Graphics.boxWidth - 48);
        const padding = typeof Window_Base !== 'undefined' &&
            typeof Window_Base.prototype.standardPadding === 'function'
            ? Window_Base.prototype.standardPadding.call(Window_Base.prototype)
            : 12;
        const lineHeight = typeof Window_Base !== 'undefined' &&
            typeof Window_Base.prototype.lineHeight === 'function'
            ? Window_Base.prototype.lineHeight.call(Window_Base.prototype)
            : 36;
        const headerLines = 1;
        const statLines = STAT_DEFINITIONS.length;
        const footerLines = FOOTER_TEXT ? 1 : 0;
        const totalLines = headerLines + statLines + footerLines;
        const spacing = statLines * ROW_SPACING;
        const contentHeight = totalLines * lineHeight + spacing + CONTENT_PADDING * 2;
        const wh = Math.min(contentHeight + padding * 2, Graphics.boxHeight - 48);
        const wx = (Graphics.boxWidth - ww) / 2;
        const wy = (Graphics.boxHeight - wh) / 2;
        return new Rectangle(wx, wy, ww, wh);
    };

    CabbyCodes.log('[CabbyCodes] Hidden stats HUD initialized');
})();


