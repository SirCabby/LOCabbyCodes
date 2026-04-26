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
 * values are written.
 *
 * Forward jumps feed the delta into the pending-minutes accumulator
 * (var 19) and run the TimePasses common event — the same pattern used
 * by in-game activities like crosswords. HourPassed (stat decay, quest
 * timers, door spawns) fires per hour and newDay (daily resets, shop
 * refreshes, plant health) fires on each 4 AM crossing. With Freeze
 * Time off the cascade is reserved on the common-event queue; with
 * Freeze Time on the cascade runs synchronously inside a freeze-time
 * advance-mode token (see cabbycodes-freeze-time.js::beginAdvance) so
 * the var-19 drain, HourPassed/newDay block, and restore loop stand
 * aside only for this explicit call. Normal time-burning activities
 * (crossword, cooking, laptop) stay suppressed under freeze.
 *
 * Backward/zero-delta jumps still fall back to a direct variable
 * write with no cascade, holding an exempt-from-restore token across
 * the write so the frozen clock re-freezes at the chosen moment.
 */

(() => {
    'use strict';

    if (typeof window.CabbyCodes === 'undefined') {
        console.warn('[CabbyCodes] Set Time requires CabbyCodes core.');
        return;
    }

    const SETTING_KEY = 'setGameTime';
    const FREEZE_SETTING_KEY = 'freezeTimeOfDay';
    const LOG_PREFIX = '[CabbyCodes][SetTime]';
    const DISPLAYED_TIME_VAR = 12;
    const CALENDAR_DAY_VAR = 14;
    const CURRENT_DAY_VAR = 15;
    const CURRENT_HOUR_VAR = 16;
    const CURRENT_MINUTE_VAR = 17;
    const MINUTES_PASS_VAR = 19;
    const TIME_PASSES_COMMON_EVENT = 4;
    const NEW_DAY_COMMON_EVENT = 6;
    const MINUTES_PER_DAY = 24 * 60;
    const FOUR_AM_MINUTES = 4 * 60;
    const MINUTE_STEP = 15;
    const DAY_MIN = 0;
    const DAY_MIN_CEILING = 20;
    const DAY_LOOKAHEAD = 5;

    const HOUR_OPTIONS = buildHourOptions();
    const MINUTE_OPTIONS = buildMinuteOptions();

    CabbyCodes.registerSetting(SETTING_KEY, 'Set Game Time', {
        defaultValue: 0,
        order: 20,
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

    function canReserveTimePasses() {
        return (
            typeof $gameTemp !== 'undefined' &&
            $gameTemp &&
            typeof $gameTemp.reserveCommonEvent === 'function' &&
            Array.isArray(window.$dataCommonEvents) &&
            window.$dataCommonEvents[TIME_PASSES_COMMON_EVENT]
        );
    }

    function canRunCommonEventSync(commonEventId) {
        return (
            typeof Game_Interpreter !== 'undefined' &&
            Array.isArray(window.$dataCommonEvents) &&
            window.$dataCommonEvents[commonEventId] &&
            Array.isArray(window.$dataCommonEvents[commonEventId].list)
        );
    }

    // Drives a Game_Interpreter to completion in the current call stack so the
    // caller knows exactly when the cascade finishes. Safe for TimePasses /
    // HourPassed / newDay because they contain no waits, messages, or scene
    // transfers — only variable/switch ops, conditional branches, loops,
    // scripts, SE playback, and CALL Common Event. Used by the freeze-on
    // forward-jump path so advance-mode tokens can be released immediately
    // after the cascade instead of needing an async idle detector.
    function runCommonEventSynchronously(commonEventId) {
        if (!canRunCommonEventSync(commonEventId)) {
            return false;
        }
        const ce = window.$dataCommonEvents[commonEventId];
        const interpreter = new Game_Interpreter();
        interpreter.setup(ce.list, 0);
        // Disable the per-frame 100k-command freeze guard; our loop runs the
        // interpreter across what the game would consider many frames at once.
        interpreter.checkFreeze = () => false;
        const MAX_UPDATES = 1000;
        let updates = 0;
        while (interpreter.isRunning() && updates < MAX_UPDATES) {
            interpreter.update();
            updates += 1;
        }
        if (interpreter.isRunning()) {
            CabbyCodes.warn(
                `${LOG_PREFIX} Common Event ${commonEventId} exceeded the sync `
                    + `update budget (${MAX_UPDATES}); aborting cascade.`
            );
            return false;
        }
        return true;
    }

    // TimePasses' drain loop only fires newDay once per call (gated by switch
    // 40, which resets at the start of every TimePasses). For a multi-day
    // jump, count how many 4 AM boundaries fall inside (oldMin, newMin] and
    // queue one extra newDay for each boundary past the first.
    function countFourAmCrossings(oldTotalMin, newTotalMin) {
        if (newTotalMin <= oldTotalMin) {
            return 0;
        }
        const dayOfOld = Math.floor(oldTotalMin / MINUTES_PER_DAY);
        let nextFourAm = dayOfOld * MINUTES_PER_DAY + FOUR_AM_MINUTES;
        if (nextFourAm <= oldTotalMin) {
            nextFourAm += MINUTES_PER_DAY;
        }
        if (nextFourAm > newTotalMin) {
            return 0;
        }
        return Math.floor((newTotalMin - nextFourAm) / MINUTES_PER_DAY) + 1;
    }

    function applyTime(newHour, newMinute, newDay) {
        if (!isSessionReady()) {
            return false;
        }
        const api = CabbyCodes.freezeTime;
        const freezeActive = CabbyCodes.getSetting(FREEZE_SETTING_KEY, false);
        const current = readCurrentTime();
        const oldTotalMin =
            current.day * MINUTES_PER_DAY + current.hour * 60 + current.minute;
        const newTotalMin = newDay * MINUTES_PER_DAY + newHour * 60 + newMinute;
        const deltaMin = newTotalMin - oldTotalMin;

        // Forward-in-time jump with Freeze Time off: mirror what in-game
        // activities (cooking, crosswords, laptop) do — feed the delta into
        // the minutes-pass accumulator and reserve TimePasses. The drain
        // loop inside TimePasses advances the clock one hour at a time,
        // firing HourPassed each iteration (stat decay, quest timers, door
        // spawns) and newDay at the 4 AM rollover. Extra newDay events are
        // queued for jumps that span multiple 4 AM boundaries.
        if (deltaMin > 0 && !freezeActive && canReserveTimePasses()) {
            try {
                const pendingBefore =
                    Number($gameVariables.value(MINUTES_PASS_VAR)) || 0;
                $gameVariables.setValue(MINUTES_PASS_VAR, pendingBefore + deltaMin);
                $gameTemp.reserveCommonEvent(TIME_PASSES_COMMON_EVENT);
                const extraNewDays = Math.max(
                    0,
                    countFourAmCrossings(oldTotalMin, newTotalMin) - 1
                );
                for (let i = 0; i < extraNewDays; i += 1) {
                    $gameTemp.reserveCommonEvent(NEW_DAY_COMMON_EVENT);
                }
                CabbyCodes.log(
                    `${LOG_PREFIX} Queued TimePasses to ${formatDayTime(newDay, newHour, newMinute)}: `
                        + `+${deltaMin}min, extraNewDays=${extraNewDays}`
                );
                return true;
            } catch (error) {
                CabbyCodes.error(
                    `${LOG_PREFIX} Queue failed, falling back to direct write: `
                        + `${error?.message || error}`
                );
                // Fall through to the direct-write path below.
            }
        }

        // Forward-in-time jump with Freeze Time on: fire the same cascade as
        // above, but synchronously inside a freeze-time advance-mode token so
        // the var-19 drain, HourPassed/newDay block, restore loop, and safety
        // net all step aside for the duration of the cascade. After the
        // cascade, releasing the token re-snapshots freeze-time at the new
        // moment — the frozen clock resumes at the chosen time instead of
        // rubber-banding back. Background activities (cooking, crosswords,
        // parallel TickTock) stay suppressed because the advance flag is only
        // held across this explicit call.
        if (
            deltaMin > 0 &&
            freezeActive &&
            api &&
            typeof api.beginAdvance === 'function' &&
            canRunCommonEventSync(TIME_PASSES_COMMON_EVENT)
        ) {
            const advanceToken = api.beginAdvance();
            let cascadeOk = false;
            try {
                const pendingBefore =
                    Number($gameVariables.value(MINUTES_PASS_VAR)) || 0;
                $gameVariables.setValue(MINUTES_PASS_VAR, pendingBefore + deltaMin);
                cascadeOk = runCommonEventSynchronously(TIME_PASSES_COMMON_EVENT);
                if (cascadeOk) {
                    const extraNewDays = Math.max(
                        0,
                        countFourAmCrossings(oldTotalMin, newTotalMin) - 1
                    );
                    for (let i = 0; i < extraNewDays; i += 1) {
                        if (!runCommonEventSynchronously(NEW_DAY_COMMON_EVENT)) {
                            cascadeOk = false;
                            break;
                        }
                    }
                }
                if (cascadeOk) {
                    if (
                        CabbyCodes.clockDisplay &&
                        typeof CabbyCodes.clockDisplay.refreshActiveWindow === 'function'
                    ) {
                        CabbyCodes.clockDisplay.refreshActiveWindow();
                    }
                    CabbyCodes.log(
                        `${LOG_PREFIX} Advanced (frozen) to `
                            + `${formatDayTime(newDay, newHour, newMinute)}: +${deltaMin}min`
                    );
                    return true;
                }
                CabbyCodes.warn(
                    `${LOG_PREFIX} Frozen advance cascade failed; falling back to direct write.`
                );
            } catch (error) {
                CabbyCodes.error(
                    `${LOG_PREFIX} Frozen advance threw, falling back to direct write: `
                        + `${error?.message || error}`
                );
            } finally {
                advanceToken.release();
            }
            // Fall through to the direct-write path on cascade failure.
        }

        // Direct-write path: backward/zero delta, or both forward paths above
        // declined (missing $dataCommonEvents, $gameTemp, beginAdvance, or
        // cascade failure). No HourPassed/newDay fires — backward jumps by
        // design, other cases because the game lacks the plumbing.
        //
        // Exempt vars 12 (displayedTime string) and 14 (calendarDay) alongside
        // the primary hour/minute/day/accumulator. If Freeze Time is on, its
        // snapshot was captured before we changed anything, so leaving 12/14
        // restricted would let the restore loop overwrite the HUD time string
        // and day prefix back to their pre-change values.
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
            // Refresh var 12 using the same formula as CE4 TimePasses idx 368:
            //   sVr(12, gVr(16) + ":" + gVr(17).toString().padStart(2, "0"))
            // Writing '' trips Game_Variables.value's `|| 0` fallback, so any
            // `\V[12]` event (e.g. Map002 AlarmClock "It is \V[12].") renders
            // "It is 0." until TimePasses runs again — which it doesn't under
            // Freeze Time.
            $gameVariables.setValue(
                DISPLAYED_TIME_VAR,
                $gameVariables.value(CURRENT_HOUR_VAR)
                    + ':'
                    + $gameVariables.value(CURRENT_MINUTE_VAR).toString().padStart(2, '0')
            );
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
    const BACKWARD_WARNING_LINES = [
        'Backward jumps skip HourPassed / newDay cascades.',
        'Per-day switches (daily quests, news) will NOT reset.'
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
        const oldTotalMin =
            start.day * MINUTES_PER_DAY + start.hour * 60 + start.minute;
        const newTotalMin =
            sel.day * MINUTES_PER_DAY + sel.hour * 60 + sel.minute;
        const goingBackward = newTotalMin < oldTotalMin;
        const lines = [
            CONFIRMATION_HEADER,
            `Current: ${formatDayTime(start.day, start.hour, start.minute)}`,
            `New:     ${formatDayTime(sel.day, sel.hour, sel.minute)}`
        ];
        if (dayChanged && goingBackward) {
            lines.push('');
            BACKWARD_WARNING_LINES.forEach(line => lines.push(line));
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
