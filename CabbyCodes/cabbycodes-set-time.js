//=============================================================================
// CabbyCodes Set Game Time
//=============================================================================
/*:
 * @target MZ
 * @plugindesc CabbyCodes Set Game Time - Manually pick hour, minute, and day.
 * @author CabbyCodes
 * @help
 * Adds a "Set Game Time" press option that opens a picker with three
 * dropdowns (hour 0-23, minute in 15-minute steps matching the in-game
 * clock, and absolute day). A confirmation prompt appears before the new
 * values are written. Cooperates with Freeze Time by acquiring an
 * exempt-from-restore token across the writes, so picking a time while
 * frozen re-freezes at the chosen moment instead of snapping back.
 *
 * Note: writing the day counter directly does NOT reset per-day switches
 * (daily quests, news posts, etc.) because the game's newDay common
 * event only fires on hour 24 -> 0 rollover. Use the bedroom to get
 * normal sleep semantics.
 */

(() => {
    'use strict';

    if (typeof window.CabbyCodes === 'undefined') {
        console.warn('[CabbyCodes] Set Time requires CabbyCodes core.');
        return;
    }

    const SETTING_KEY = 'setGameTime';
    const LOG_PREFIX = '[CabbyCodes][SetTime]';
    const DISPLAYED_TIME_VAR = 12;
    const CALENDAR_DAY_VAR = 14;
    const CURRENT_DAY_VAR = 15;
    const CURRENT_HOUR_VAR = 16;
    const CURRENT_MINUTE_VAR = 17;
    const MINUTES_PASS_VAR = 19;
    const MINUTE_STEP = 15;
    const DAY_MIN = 0;
    const DAY_MIN_CEILING = 20;
    const DAY_LOOKAHEAD = 5;

    const HOUR_OPTIONS = buildHourOptions();
    const MINUTE_OPTIONS = buildMinuteOptions();

    CabbyCodes.registerSetting(SETTING_KEY, 'Set Game Time', {
        defaultValue: 0,
        order: 56,
        formatValue: () => 'Press',
        onActivate: () => {
            openPickerScene();
            return true;
        }
    });

    function buildHourOptions() {
        const list = [];
        for (let h = 0; h < 24; h += 1) {
            list.push({ key: String(h), name: formatHourLabel(h), value: h });
        }
        return list;
    }

    function buildMinuteOptions() {
        const list = [];
        for (let m = 0; m < 60; m += MINUTE_STEP) {
            list.push({ key: String(m), name: formatMinuteLabel(m), value: m });
        }
        return list;
    }

    function buildDayOptions(currentDay) {
        const ceiling = Math.max(DAY_MIN_CEILING, Number(currentDay) + DAY_LOOKAHEAD);
        const list = [];
        for (let d = DAY_MIN; d <= ceiling; d += 1) {
            list.push({ key: String(d), name: `Day ${d}`, value: d });
        }
        return list;
    }

    function formatHourLabel(h) {
        return h < 10 ? `0${h}` : String(h);
    }

    function formatMinuteLabel(m) {
        return m < 10 ? `:0${m}` : `:${m}`;
    }

    function formatTime(hour, minute) {
        return `${formatHourLabel(hour)}:${formatMinuteLabel(minute).slice(1)}`;
    }

    function formatDayTime(day, hour, minute) {
        return `D${day} ${formatTime(hour, minute)}`;
    }

    function snapMinute(value) {
        const normalized = ((Math.floor(Number(value) || 0) % 60) + 60) % 60;
        return Math.floor(normalized / MINUTE_STEP) * MINUTE_STEP;
    }

    function isSessionReady() {
        if (typeof $gameVariables === 'undefined' || !$gameVariables) {
            return false;
        }
        if (typeof CabbyCodes.isGameSessionActive === 'function' && !CabbyCodes.isGameSessionActive()) {
            return false;
        }
        return true;
    }

    function readCurrentTime() {
        const rawHour = Number($gameVariables.value(CURRENT_HOUR_VAR));
        const rawMinute = Number($gameVariables.value(CURRENT_MINUTE_VAR));
        const rawDay = Number($gameVariables.value(CURRENT_DAY_VAR));
        const hour = Number.isFinite(rawHour) ? ((Math.floor(rawHour) % 24) + 24) % 24 : 0;
        const minute = snapMinute(rawMinute);
        const day = Number.isFinite(rawDay) ? Math.max(DAY_MIN, Math.floor(rawDay)) : DAY_MIN;
        return { hour, minute, day };
    }

    function openPickerScene() {
        if (!isSessionReady()) {
            CabbyCodes.warn(`${LOG_PREFIX} Picker blocked: no active session.`);
            return;
        }
        if (typeof SceneManager === 'undefined' || typeof Scene_CabbyCodesSetTime === 'undefined') {
            CabbyCodes.warn(`${LOG_PREFIX} SceneManager or picker scene unavailable.`);
            return;
        }
        if (
            typeof window.Window_CabbyCodesDropdownButton === 'undefined' ||
            typeof window.Window_CabbyCodesDropdownList === 'undefined'
        ) {
            CabbyCodes.warn(`${LOG_PREFIX} Dropdown widgets unavailable (item-giver module missing?).`);
            return;
        }
        SceneManager.push(Scene_CabbyCodesSetTime);
    }

    function applyTime(newHour, newMinute, newDay) {
        if (!isSessionReady()) {
            return false;
        }
        const api = CabbyCodes.freezeTime;
        // Exempt vars 12 (displayedTime string) and 14 (calendarDay) alongside the
        // primary hour/minute/day/accumulator. If Freeze Time is on, its snapshot
        // was captured before we changed anything, so leaving 12/14 restricted
        // would let the restore loop overwrite the HUD time string and day prefix
        // back to their pre-change values.
        const token = (api && typeof api.exemptFromRestore === 'function')
            ? api.exemptFromRestore({
                variables: [
                    DISPLAYED_TIME_VAR,
                    CALENDAR_DAY_VAR,
                    CURRENT_DAY_VAR,
                    CURRENT_HOUR_VAR,
                    CURRENT_MINUTE_VAR,
                    MINUTES_PASS_VAR
                ]
            })
            : { release: () => {} };
        try {
            $gameVariables.setValue(CURRENT_HOUR_VAR, newHour);
            $gameVariables.setValue(CURRENT_MINUTE_VAR, newMinute);
            // Drain the minutes-pass accumulator so the next TickTock does not
            // carry stale pending minutes into our just-written values.
            $gameVariables.setValue(MINUTES_PASS_VAR, 0);
            $gameVariables.setValue(CURRENT_DAY_VAR, newDay);
            $gameVariables.setValue(CALENDAR_DAY_VAR, newDay);
            // Clear the HUD's cached time string so the clock display falls back
            // to rendering from the freshly-written hour/minute.
            $gameVariables.setValue(DISPLAYED_TIME_VAR, '');
            if (CabbyCodes.clockDisplay && typeof CabbyCodes.clockDisplay.refreshActiveWindow === 'function') {
                CabbyCodes.clockDisplay.refreshActiveWindow();
            }
            CabbyCodes.log(`${LOG_PREFIX} Time set to ${formatDayTime(newDay, newHour, newMinute)}`);
            return true;
        } catch (error) {
            CabbyCodes.error(`${LOG_PREFIX} Apply failed: ${error?.message || error}`);
            return false;
        } finally {
            token.release();
        }
    }

    //----------------------------------------------------------------------
    // Scene_CabbyCodesSetTime
    //----------------------------------------------------------------------

    const FIELDS = ['hour', 'minute', 'day'];
    const DROPDOWN_SPACING = 12;
    const DROPDOWN_LIST_VISIBLE_ROWS = 6;

    // Matches cabbycodes-item-giver dropdown sizing (lineHeight 36 + 8).
    const DROPDOWN_BUTTON_HEIGHT = 44;

    function Scene_CabbyCodesSetTime() {
        this.initialize(...arguments);
    }

    Scene_CabbyCodesSetTime.prototype = Object.create(Scene_MenuBase.prototype);
    Scene_CabbyCodesSetTime.prototype.constructor = Scene_CabbyCodesSetTime;

    Scene_CabbyCodesSetTime.prototype.create = function() {
        Scene_MenuBase.prototype.create.call(this);
        this._startState = readCurrentTime();
        this._selection = { ...this._startState };
        this._dayOptions = buildDayOptions(this._startState.day);
        this._activeDropdownField = null;
        this._lastDropdownField = FIELDS[0];
        this.createHelpWindow();
        this.createDropdownButtons();
        this.createApplyWindow();
        this.createDropdownListWindow();
        this.refreshHelp();
        this.setFocus('apply');
    };

    Scene_CabbyCodesSetTime.prototype.createBackground = function() {
        Scene_MenuBase.prototype.createBackground.call(this);
        if (this._backgroundSprite) {
            this._backgroundSprite.opacity = 192;
        }
    };

    Scene_CabbyCodesSetTime.prototype.helpAreaHeight = function() {
        return this.calcWindowHeight(2, false);
    };

    Scene_CabbyCodesSetTime.prototype.layoutMetrics = function() {
        const sidePadding = 32;
        const availableWidth = Math.max(360, Graphics.boxWidth - sidePadding * 2);
        const maxPanelWidth = Math.min(720, availableWidth);
        const panelWidth = maxPanelWidth;
        const panelX = Math.floor((Graphics.boxWidth - panelWidth) / 2);
        const dropdownWidth = Math.floor((panelWidth - DROPDOWN_SPACING * 2) / FIELDS.length);
        const helpHeight = this.helpAreaHeight();
        const applyHeight = this.calcWindowHeight(1, true);
        const totalHeight = helpHeight + DROPDOWN_SPACING + DROPDOWN_BUTTON_HEIGHT + DROPDOWN_SPACING + applyHeight;
        const topY = Math.max(16, Math.floor((Graphics.boxHeight - totalHeight) / 2));
        return { panelX, panelWidth, dropdownWidth, helpHeight, applyHeight, topY };
    };

    Scene_CabbyCodesSetTime.prototype.createHelpWindow = function() {
        const m = this.layoutMetrics();
        const rect = new Rectangle(m.panelX, m.topY, m.panelWidth, m.helpHeight);
        this._helpWindow = new Window_Help(rect);
        this.addWindow(this._helpWindow);
    };

    Scene_CabbyCodesSetTime.prototype.createDropdownButtons = function() {
        const m = this.layoutMetrics();
        const rowY = m.topY + m.helpHeight + DROPDOWN_SPACING;
        this._dropdownButtons = {};
        FIELDS.forEach((field, index) => {
            const x = m.panelX + index * (m.dropdownWidth + DROPDOWN_SPACING);
            const rect = new Rectangle(x, rowY, m.dropdownWidth, DROPDOWN_BUTTON_HEIGHT);
            const label = this.labelForField(field);
            const placeholder = `Select ${label.toLowerCase()}`;
            const button = new Window_CabbyCodesDropdownButton(rect, label, placeholder);
            // The shared DropdownButton defaults to lineHeight for itemHeight, which
            // leaves the cursor rect floating above the vertically-centered label
            // when the window is taller. Fill the full inner height instead.
            button.itemHeight = function() { return this.innerHeight; };
            button.setHandler('ok', this.onDropdownOk.bind(this, field));
            button.setHandler('cancel', this.popScene.bind(this));
            this.decorateButtonNavigation(button, field);
            this.addWindow(button);
            this._dropdownButtons[field] = button;
        });
        this.refreshDropdownValues();
    };

    Scene_CabbyCodesSetTime.prototype.createApplyWindow = function() {
        const m = this.layoutMetrics();
        const ww = Math.min(320, m.panelWidth);
        const wh = m.applyHeight;
        const wx = Math.floor((Graphics.boxWidth - ww) / 2);
        const wy = m.topY + m.helpHeight + DROPDOWN_SPACING + DROPDOWN_BUTTON_HEIGHT + DROPDOWN_SPACING;
        this._applyWindow = new Window_CabbyCodesSetTimeApply(new Rectangle(wx, wy, ww, wh));
        this._applyWindow.setHandler('apply', this.onApplyOk.bind(this));
        this._applyWindow.setHandler('cancel', this.popScene.bind(this));
        const scene = this;
        this._applyWindow.cursorUp = function() {
            scene.setFocus(scene._lastDropdownField || FIELDS[FIELDS.length - 1]);
        };
        this.addWindow(this._applyWindow);
    };

    Scene_CabbyCodesSetTime.prototype.createDropdownListWindow = function() {
        const rect = new Rectangle(0, 0, 320, this.calcWindowHeight(DROPDOWN_LIST_VISIBLE_ROWS, true));
        this._dropdownListWindow = new Window_CabbyCodesDropdownList(rect);
        this._dropdownListWindow.setHandler('ok', this.onDropdownListOk.bind(this));
        this._dropdownListWindow.setHandler('cancel', this.onDropdownListCancel.bind(this));
        this.addWindow(this._dropdownListWindow);
    };

    Scene_CabbyCodesSetTime.prototype.labelForField = function(field) {
        if (field === 'hour') return 'Hour';
        if (field === 'minute') return 'Minute';
        return 'Day';
    };

    Scene_CabbyCodesSetTime.prototype.optionsForField = function(field) {
        if (field === 'hour') return HOUR_OPTIONS;
        if (field === 'minute') return MINUTE_OPTIONS;
        return this._dayOptions;
    };

    Scene_CabbyCodesSetTime.prototype.displayLabelForField = function(field) {
        if (field === 'hour') return formatHourLabel(this._selection.hour);
        if (field === 'minute') return formatMinuteLabel(this._selection.minute);
        return `Day ${this._selection.day}`;
    };

    Scene_CabbyCodesSetTime.prototype.refreshDropdownValues = function() {
        FIELDS.forEach(field => {
            const button = this._dropdownButtons[field];
            if (!button) return;
            button.setValue(this.displayLabelForField(field));
            button.setKey(String(this._selection[field]));
        });
    };

    Scene_CabbyCodesSetTime.prototype.refreshHelp = function() {
        if (!this._helpWindow) return;
        const start = this._startState;
        const sel = this._selection;
        const current = formatDayTime(start.day, start.hour, start.minute);
        const next = formatDayTime(sel.day, sel.hour, sel.minute);
        this._helpWindow.setText(`Set Game Time\nCurrent: ${current}  \u2192  New: ${next}`);
    };

    Scene_CabbyCodesSetTime.prototype.decorateButtonNavigation = function(button, field) {
        const scene = this;
        const fieldIndex = FIELDS.indexOf(field);
        button.cursorRight = function() {
            const next = FIELDS[Math.min(FIELDS.length - 1, fieldIndex + 1)];
            if (next !== field) {
                scene.setFocus(next);
            } else {
                SoundManager.playCursor();
            }
        };
        button.cursorLeft = function() {
            const prev = FIELDS[Math.max(0, fieldIndex - 1)];
            if (prev !== field) {
                scene.setFocus(prev);
            } else {
                SoundManager.playCursor();
            }
        };
        button.cursorDown = function() {
            scene.setFocus('apply');
        };
        button.cursorUp = function() {
            SoundManager.playCursor();
        };
    };

    Scene_CabbyCodesSetTime.prototype.setFocus = function(target) {
        FIELDS.forEach(field => {
            const button = this._dropdownButtons && this._dropdownButtons[field];
            if (!button) return;
            button.deactivate();
            button.deselect();
        });
        if (this._applyWindow) {
            this._applyWindow.deactivate();
            this._applyWindow.deselect();
        }
        if (target === 'apply') {
            if (this._applyWindow) {
                this._applyWindow.activate();
                this._applyWindow.select(0);
            }
            return;
        }
        const button = this._dropdownButtons && this._dropdownButtons[target];
        if (button) {
            button.activate();
            button.select(0);
        }
    };

    Scene_CabbyCodesSetTime.prototype.onDropdownOk = function(field) {
        this.openDropdownList(field);
    };

    Scene_CabbyCodesSetTime.prototype.openDropdownList = function(field) {
        if (!this._dropdownListWindow) return;
        const button = this._dropdownButtons[field];
        if (!button) return;
        const options = this.optionsForField(field);
        if (!options || options.length === 0) {
            SoundManager.playBuzzer();
            return;
        }
        this._activeDropdownField = field;
        FIELDS.forEach(f => {
            const b = this._dropdownButtons[f];
            if (b) {
                b.deactivate();
                b.deselect();
            }
        });
        if (this._applyWindow) {
            this._applyWindow.deactivate();
            this._applyWindow.deselect();
        }
        const currentKey = String(this._selection[field]);
        this._dropdownListWindow.setOptions(options, currentKey);
        const rect = this.dropdownListRectForButton(button, this._dropdownListWindow.height);
        this._dropdownListWindow.move(rect.x, rect.y, rect.width, this._dropdownListWindow.height);
        this.raiseDropdownList();
        this._dropdownListWindow.show();
        this._dropdownListWindow.open();
        this._dropdownListWindow.activate();
    };

    Scene_CabbyCodesSetTime.prototype.dropdownListRectForButton = function(button, listHeight) {
        const width = button.width;
        const buttonX = button.x;
        const buttonY = button.y;
        let y = buttonY + button.height;
        if (y + listHeight > Graphics.boxHeight) {
            y = Math.max(0, buttonY - listHeight);
        }
        return new Rectangle(buttonX, y, width, listHeight);
    };

    Scene_CabbyCodesSetTime.prototype.raiseDropdownList = function() {
        if (!this._dropdownListWindow) return;
        const topZ = Math.max(
            this._helpWindow ? this._helpWindow.z || 0 : 0,
            this._applyWindow ? this._applyWindow.z || 0 : 0,
            ...FIELDS.map(f => {
                const b = this._dropdownButtons[f];
                return b ? b.z || 0 : 0;
            })
        );
        this._dropdownListWindow.z = topZ + 50;
    };

    Scene_CabbyCodesSetTime.prototype.closeDropdownList = function() {
        if (!this._dropdownListWindow) return;
        this._dropdownListWindow.hide();
        this._dropdownListWindow.deactivate();
        this._dropdownListWindow.close();
    };

    Scene_CabbyCodesSetTime.prototype.onDropdownListOk = function() {
        const field = this._activeDropdownField;
        if (!field) {
            this.closeDropdownList();
            this.setFocus('apply');
            return;
        }
        const key = this._dropdownListWindow.currentKey();
        const options = this.optionsForField(field);
        const option = options.find(opt => opt.key === key);
        if (option) {
            this._selection[field] = option.value;
            this.refreshDropdownValues();
            this.refreshHelp();
        }
        this.closeDropdownList();
        this._activeDropdownField = null;
        this._lastDropdownField = field;
        // Route focus to Apply (not back to the dropdown) for two reasons:
        // 1. Apply is the likely next action; pressing Enter again confirms.
        // 2. Window_Selectable.processTouch only fires on the active window,
        //    so Apply needs to be active for mouse clicks on it to register.
        this.setFocus('apply');
    };

    Scene_CabbyCodesSetTime.prototype.onDropdownListCancel = function() {
        const field = this._activeDropdownField;
        this.closeDropdownList();
        this._activeDropdownField = null;
        this.setFocus(field || 'apply');
    };

    Scene_CabbyCodesSetTime.prototype.onApplyOk = function() {
        const start = this._startState;
        const sel = this._selection;
        if (start.hour === sel.hour && start.minute === sel.minute && start.day === sel.day) {
            SoundManager.playBuzzer();
            this.setFocus('apply');
            return;
        }
        this.openConfirmation();
    };

    Scene_CabbyCodesSetTime.prototype.openConfirmation = function() {
        const start = this._startState;
        const selection = { ...this._selection };
        SceneManager.push(Scene_CabbyCodesSetTimeConfirm);
        if (typeof SceneManager.prepareNextScene === 'function') {
            SceneManager.prepareNextScene({
                start,
                selection,
                onConfirm: () => {
                    applyTime(selection.hour, selection.minute, selection.day);
                    SceneManager.pop();
                    this.popScene();
                },
                onCancel: () => {
                    SceneManager.pop();
                    this.setFocus('apply');
                }
            });
        }
    };

    window.Scene_CabbyCodesSetTime = Scene_CabbyCodesSetTime;

    //----------------------------------------------------------------------
    // Window_CabbyCodesSetTimeApply
    //----------------------------------------------------------------------

    function Window_CabbyCodesSetTimeApply() {
        this.initialize(...arguments);
    }

    Window_CabbyCodesSetTimeApply.prototype = Object.create(Window_Command.prototype);
    Window_CabbyCodesSetTimeApply.prototype.constructor = Window_CabbyCodesSetTimeApply;

    Window_CabbyCodesSetTimeApply.prototype.makeCommandList = function() {
        this.addCommand('Apply', 'apply');
    };

    Window_CabbyCodesSetTimeApply.prototype.itemTextAlign = function() {
        return 'center';
    };

    window.Window_CabbyCodesSetTimeApply = Window_CabbyCodesSetTimeApply;

    //----------------------------------------------------------------------
    // Scene_CabbyCodesSetTimeConfirm
    //----------------------------------------------------------------------

    const CONFIRMATION_HEADER = 'Apply new game time?';
    const DAY_CHANGE_WARNING_LINES = [
        'Changing the day does NOT reset per-day switches',
        '(daily quests, news). Use the bed for normal sleep.'
    ];

    function Scene_CabbyCodesSetTimeConfirm() {
        this.initialize(...arguments);
    }

    Scene_CabbyCodesSetTimeConfirm.prototype = Object.create(Scene_MenuBase.prototype);
    Scene_CabbyCodesSetTimeConfirm.prototype.constructor = Scene_CabbyCodesSetTimeConfirm;

    Scene_CabbyCodesSetTimeConfirm.prototype.prepare = function(params = {}) {
        this._start = params.start;
        this._selection = params.selection;
        this._onConfirm = params.onConfirm;
        this._onCancel = params.onCancel;
    };

    Scene_CabbyCodesSetTimeConfirm.prototype.helpAreaHeight = function() {
        return 0;
    };

    Scene_CabbyCodesSetTimeConfirm.prototype.create = function() {
        Scene_MenuBase.prototype.create.call(this);
        this.createInfoWindow();
        this.createCommandWindow();
    };

    Scene_CabbyCodesSetTimeConfirm.prototype.infoLines = function() {
        const start = this._start;
        const sel = this._selection;
        const dayChanged = start.day !== sel.day;
        const lines = [
            CONFIRMATION_HEADER,
            `Current: ${formatDayTime(start.day, start.hour, start.minute)}`,
            `New:     ${formatDayTime(sel.day, sel.hour, sel.minute)}`
        ];
        if (dayChanged) {
            lines.push('');
            DAY_CHANGE_WARNING_LINES.forEach(line => lines.push(line));
        }
        return lines;
    };

    Scene_CabbyCodesSetTimeConfirm.prototype.createInfoWindow = function() {
        const lines = this.infoLines();
        const ww = Math.min(Graphics.boxWidth - 96, 640);
        const wh = this.calcWindowHeight(lines.length, false);
        const commandHeight = this.commandWindowHeight();
        const spacing = 16;
        const totalHeight = wh + spacing + commandHeight;
        const wx = Math.floor((Graphics.boxWidth - ww) / 2);
        const wy = Math.max(40, Math.floor((Graphics.boxHeight - totalHeight) / 2));
        this._infoWindow = new Window_CabbyCodesSetTimeInfo(new Rectangle(wx, wy, ww, wh), lines);
        this.addWindow(this._infoWindow);
    };

    Scene_CabbyCodesSetTimeConfirm.prototype.commandWindowHeight = function() {
        return this.calcWindowHeight(2, true);
    };

    Scene_CabbyCodesSetTimeConfirm.prototype.createCommandWindow = function() {
        const ww = 400;
        const wh = this.commandWindowHeight();
        const wx = Math.floor((Graphics.boxWidth - ww) / 2);
        const wy = this._infoWindow.y + this._infoWindow.height + 16;
        this._commandWindow = new Window_CabbyCodesSetTimeConfirm(new Rectangle(wx, wy, ww, wh));
        this._commandWindow.setHandler('confirm', this.onConfirm.bind(this));
        this._commandWindow.setHandler('cancel', this.onCancel.bind(this));
        this.addWindow(this._commandWindow);
    };

    Scene_CabbyCodesSetTimeConfirm.prototype.onConfirm = function() {
        if (typeof this._onConfirm === 'function') {
            this._onConfirm();
            return;
        }
        SceneManager.pop();
    };

    Scene_CabbyCodesSetTimeConfirm.prototype.onCancel = function() {
        if (typeof this._onCancel === 'function') {
            this._onCancel();
            return;
        }
        SceneManager.pop();
    };

    window.Scene_CabbyCodesSetTimeConfirm = Scene_CabbyCodesSetTimeConfirm;

    //----------------------------------------------------------------------
    // Window_CabbyCodesSetTimeConfirm
    //----------------------------------------------------------------------

    function Window_CabbyCodesSetTimeConfirm() {
        this.initialize(...arguments);
    }

    Window_CabbyCodesSetTimeConfirm.prototype = Object.create(Window_Command.prototype);
    Window_CabbyCodesSetTimeConfirm.prototype.constructor = Window_CabbyCodesSetTimeConfirm;

    Window_CabbyCodesSetTimeConfirm.prototype.makeCommandList = function() {
        this.addCommand('Yes, set this time', 'confirm');
        this.addCommand('No, go back', 'cancel');
    };

    //----------------------------------------------------------------------
    // Window_CabbyCodesSetTimeInfo
    //----------------------------------------------------------------------

    function Window_CabbyCodesSetTimeInfo() {
        this.initialize(...arguments);
    }

    Window_CabbyCodesSetTimeInfo.prototype = Object.create(Window_Base.prototype);
    Window_CabbyCodesSetTimeInfo.prototype.constructor = Window_CabbyCodesSetTimeInfo;

    Window_CabbyCodesSetTimeInfo.prototype.initialize = function(rect, lines) {
        Window_Base.prototype.initialize.call(this, rect);
        this._lines = Array.isArray(lines) ? lines.slice() : [];
        this.refresh();
    };

    Window_CabbyCodesSetTimeInfo.prototype.refresh = function() {
        if (!this.contents) {
            this.createContents();
        }
        this.contents.clear();
        this.resetFontSettings();
        const width = this.contentsWidth();
        let y = 0;
        this._lines.forEach(line => {
            this.drawText(String(line), 0, y, width);
            y += this.lineHeight();
        });
    };

    CabbyCodes.log('[CabbyCodes] Set Time module loaded');
})();
