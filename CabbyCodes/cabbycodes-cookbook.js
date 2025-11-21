//=============================================================================
// CabbyCodes Cookbook
//=============================================================================
/*:
 * @target MZ
 * @plugindesc CabbyCodes Cookbook - Press-to-open cookbook showing all cooking combinations
 * @author CabbyCodes
 * @help
 * Adds a "Press" option to the CabbyCodes section of the Options menu that
 * instantly opens a cookbook showing all discovered cooking combinations with checkboxes.
 * Shows count of discovered combinations over total combinations.
 * Press OK/Cancel to exit the window and return to the game.
 */

(() => {
    'use strict';

    if (typeof window.CabbyCodes === 'undefined') {
        console.warn('[CabbyCodes] Cookbook requires the core module.');
        return;
    }

    const moduleApi = (CabbyCodes.cookbook = CabbyCodes.cookbook || {});
    const bookUi = CabbyCodes.bookUi || null;
    const bookUiDefaults = (bookUi && bookUi.defaults) || {};
    const settingKey = 'cookbook';
    const COOKING_COMMON_EVENT_NAME = 'Cooking';
    const COOKED_MEAL_EVENT_NAME = 'eatCookedMeal';
    const COOKED_ARRAY_VARIABLE_ID = 649; // Array tracking discovered meals (see Cooking common event)
    const PRIMARY_VAR_ID = 74;
    const SECONDARY_VAR_ID = 75;
    const COOKED_RESULT_VAR_ID = 137;

    let ovenCombinationCache = null;
    let dishNameMapCache = null;

    // Window constants
    const WINDOW_WIDTH = Number.isFinite(bookUiDefaults.windowWidth)
        ? bookUiDefaults.windowWidth
        : null;
    const MIN_WINDOW_WIDTH = Number.isFinite(bookUiDefaults.minWindowWidth)
        ? bookUiDefaults.minWindowWidth
        : 320;
    const WINDOW_HORIZONTAL_PADDING = Number.isFinite(bookUiDefaults.windowHorizontalPadding)
        ? bookUiDefaults.windowHorizontalPadding
        : 0;
    const STRETCH_TO_FULL_WIDTH = bookUiDefaults.stretchToFullWidth !== false;
    const ROW_HEIGHT = bookUi?.defaults?.rowHeight ?? 24;  // Tight vertical spacing
    const ROW_SPACING = bookUi?.defaults?.rowSpacing ?? 2;
    const REFRESH_INTERVAL_FRAMES = 30;
    const HEADER_TEXT = 'Cook Book';
    const CHECKBOX_SIZE = bookUi?.defaults?.checkboxSize ?? 16;
    const CHECKBOX_PADDING = 4;
    const RECIPE_NAME_OFFSET = CHECKBOX_SIZE + CHECKBOX_PADDING * 2;
    const CONTENT_PADDING = bookUi?.defaults?.contentPadding ?? 12;
    const FOOTER_TEXT = '';
    const RESET_DELAY_MS = 30;
    const ROW_CONTENT_LEFT = bookUi?.defaults?.rowContentLeft ?? 16;
    const ROW_CONTENT_RIGHT = bookUi?.defaults?.rowContentRight ?? 8;

    // Checkbox colors
    const CHECKBOX_CHECKED_COLOR = '#68ffd1';
    const CHECKBOX_UNCHECKED_COLOR = 'rgba(255, 255, 255, 0.3)';
    const CHECKBOX_BORDER_COLOR = '#ffffff';

    CabbyCodes.registerSetting(settingKey, 'Cook Book', {
        defaultValue: false,
        order: 25,
        formatValue: () => 'Press',
        onChange: newValue => {
            if (!newValue) {
                return;
            }
            openCookbookScene();
            scheduleReset();
        }
    });

    moduleApi.settingKey = settingKey;
    moduleApi.openViewer = () => {
        openCookbookScene();
    };

    function scheduleReset() {
        if (typeof setTimeout !== 'function') {
            CabbyCodes.setSetting(settingKey, false);
            return;
        }
        setTimeout(() => {
            CabbyCodes.setSetting(settingKey, false);
        }, RESET_DELAY_MS);
    }

    function openCookbookScene() {
        if (typeof SceneManager === 'undefined' || typeof SceneManager.push !== 'function') {
            CabbyCodes.warn('[CabbyCodes] Cookbook could not open (SceneManager missing)');
            return;
        }
        if (typeof Scene_CabbyCodesCookbook === 'undefined') {
            CabbyCodes.warn('[CabbyCodes] Cookbook scene is unavailable.');
            return;
        }
        SceneManager.push(Scene_CabbyCodesCookbook);
    }

    /**
     * Get all cooking combinations derived from the oven common event.
     * @returns {Array}
     */
    function getAllCookingCombinations() {
        if (typeof $dataItems === 'undefined' || !$dataItems) {
            CabbyCodes.warn('[CabbyCodes] Cookbook: $dataItems not available');
            return [];
        }

        const ovenData = getOvenCombinationData();
        if (ovenData.length === 0) {
            CabbyCodes.warn('[CabbyCodes] Cookbook: No oven combinations detected.');
            return [];
        }
        const cookArray = getCookArray();
        const combinations = ovenData.map(entry => {
            const primaryItem = $dataItems[entry.primaryId];
            const secondaryItem = entry.secondaryId ? $dataItems[entry.secondaryId] : null;
            const dishIds = entry.variants.map(variant => variant.dishId);
            const resultName = formatVariantName(entry.variants);
            const discovered = cookArray
                ? dishIds.some(id => !!cookArray[id])
                : false;
            return {
                combinationKey: `${entry.primaryId}-${entry.secondaryId || 'solo'}`,
                primaryId: entry.primaryId,
                primaryName: safeItemName(primaryItem, entry.primaryId),
                secondaryId: entry.secondaryId,
                secondaryName: secondaryItem ? safeItemName(secondaryItem, entry.secondaryId) : '(Solo)',
                dishIds,
                variantNames: entry.variants.map(v => v.dishName),
                resultName,
                discovered
            };
        });

        debugLogCookbookSnapshot(combinations, cookArray);

        const localeOptions = { sensitivity: 'base' };
        combinations.sort((a, b) => {
            const resultCompare = a.resultName.localeCompare(
                b.resultName,
                undefined,
                localeOptions
            );
            if (resultCompare !== 0) {
                return resultCompare;
            }
            const primaryCompare = a.primaryName.localeCompare(
                b.primaryName,
                undefined,
                localeOptions
            );
            if (primaryCompare !== 0) {
                return primaryCompare;
            }
            return a.secondaryName.localeCompare(b.secondaryName, undefined, localeOptions);
        });

        return combinations;
    }

    function getCookArray() {
        if (typeof $gameVariables === 'undefined') {
            return null;
        }
        const value = $gameVariables.value(COOKED_ARRAY_VARIABLE_ID);
        return Array.isArray(value) ? value : null;
    }

    function safeItemName(item, id) {
        if (item && item.name) {
            return item.name;
        }
        return id ? `Item ${id}` : 'Unknown';
    }

    function resolveDishResultName(dishId) {
        const dishMap = getDishNameMap();
        return dishMap.get(dishId) || `Dish ${dishId}`;
    }

    function getOvenCombinationData() {
        if (ovenCombinationCache) {
            return ovenCombinationCache;
        }
        if (typeof $dataCommonEvents === 'undefined') {
            return [];
        }
        ovenCombinationCache = buildOvenCombinationData();
        return ovenCombinationCache;
    }

    function buildOvenCombinationData() {
        const event = findCommonEventByName(COOKING_COMMON_EVENT_NAME);
        if (!event || !Array.isArray(event.list)) {
            CabbyCodes.warn('[CabbyCodes] Cookbook: Cooking common event not found; cannot build oven combinations.');
            return [];
        }

        const combosByKey = new Map();
        const constraintStack = [];

        for (const command of event.list) {
            trimConstraintStack(constraintStack, command.indent);

            if (command.code === 111) {
                const condition = parseVariableEqualityCondition(command);
                if (condition) {
                    constraintStack.push(condition);
                }
            } else if (command.code === 122 && isSettingCookedResult(command)) {
                const dishId = command.parameters[4];
                const primaryId = getConstraintValue(constraintStack, PRIMARY_VAR_ID);
                const secondaryId = getConstraintValue(constraintStack, SECONDARY_VAR_ID);
                if (primaryId) {
                    const dishName = resolveDishResultName(dishId);
                    const key = `${primaryId}-${secondaryId || 'solo'}`;
                    let combo = combosByKey.get(key);
                    if (!combo) {
                        combo = {
                            primaryId,
                            secondaryId: secondaryId || null,
                            variants: []
                        };
                        combosByKey.set(key, combo);
                    }
                    combo.variants.push({
                        dishId,
                        dishName
                    });
                }
            }
        }

        return Array.from(combosByKey.values());
    }

    function trimConstraintStack(stack, indent) {
        while (stack.length && stack[stack.length - 1].indent >= indent) {
            stack.pop();
        }
    }

    function parseVariableEqualityCondition(command) {
        const params = command.parameters;
        if (!params || params[0] !== 1) {
            return null;
        }
        const variableId = params[1];
        const operator = params[2];
        const comparisonType = params[4];
        if (operator !== 0 || comparisonType !== 0) {
            return null;
        }
        const comparisonValue = params[3];
        return {
            indent: command.indent,
            varId: variableId,
            value: comparisonValue
        };
    }

    function isSettingCookedResult(command) {
        const params = command.parameters;
        return (
            Array.isArray(params) &&
            params[0] === COOKED_RESULT_VAR_ID &&
            params[1] === COOKED_RESULT_VAR_ID
        );
    }

    function getConstraintValue(stack, varId) {
        for (let i = stack.length - 1; i >= 0; i--) {
            if (stack[i].varId === varId) {
                return stack[i].value;
            }
        }
        return null;
    }

    function getDishNameMap() {
        if (dishNameMapCache) {
            return dishNameMapCache;
        }
        dishNameMapCache = buildDishNameMap();
        return dishNameMapCache;
    }

    function buildDishNameMap() {
        const map = new Map();
        const event = findCommonEventByName(COOKED_MEAL_EVENT_NAME);
        if (!event || !Array.isArray(event.list)) {
            return map;
        }
        for (const command of event.list) {
            if (command.code === 118 && command.parameters && command.parameters[0]) {
                const label = command.parameters[0];
                const match = /^(\d+)\s*[-:]\s*(.+)$/i.exec(label);
                if (match) {
                    const dishId = Number(match[1]);
                    const rawName = match[2].trim();
                    if (dishId > 0 && rawName) {
                        map.set(dishId, prettifyDishName(rawName));
                    }
                }
            }
        }
        return map;
    }

    function prettifyDishName(text) {
        return text
            .replace(/[_\-]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function formatVariantName(variants) {
        if (!Array.isArray(variants) || variants.length === 0) {
            return 'Unknown Dish';
        }
        const uniqueNames = [...new Set(variants.map(v => (v.dishName || '').trim()).filter(Boolean))];
        if (uniqueNames.length === 0) {
            return 'Unknown Dish';
        }
        if (uniqueNames.length === 1) {
            return uniqueNames[0];
        }
        return uniqueNames.join(' / ');
    }

    function debugLogCookbookSnapshot(combos, cookArray) {
        if (!CabbyCodes || typeof CabbyCodes.log !== 'function') {
            return;
        }
        const discovered = combos.filter(c => c.discovered).length;
        const variantCount = combos.reduce((sum, combo) => sum + (combo.dishIds ? combo.dishIds.length : 0), 0);
        const cookArrayTrue = cookArray
            ? cookArray.reduce((sum, value) => sum + (value ? 1 : 0), 0)
            : 'n/a';
        const summaryKey = `${combos.length}|${discovered}|${variantCount}|${cookArrayTrue}`;
        if (debugLogCookbookSnapshot._lastSummary === summaryKey) {
            return;
        }
        debugLogCookbookSnapshot._lastSummary = summaryKey;
        CabbyCodes.log(
            `[CabbyCodes] Cookbook snapshot: combos=${combos.length}, variants=${variantCount}, ` +
            `discovered=${discovered}. cookArray entries=${cookArray ? cookArray.length : 'n/a'}, true=${cookArrayTrue}`
        );
        if (!cookArray) {
            CabbyCodes.warn('[CabbyCodes] Cookbook: cookArray variable 649 is not initialised; recipes will all appear undiscovered.');
        } else {
            logCookbookMismatches(combos, cookArray);
        }
    }

    function findCommonEventByName(name) {
        if (typeof $dataCommonEvents === 'undefined' || !Array.isArray($dataCommonEvents)) {
            return null;
        }
        return $dataCommonEvents.find(evt => evt && evt.name === name) || null;
    }

    function logCookbookMismatches(combos, cookArray) {
        if (logCookbookMismatches._logged || !cookArray || typeof CabbyCodes.warn !== 'function') {
            return;
        }
        const mismatches = combos.filter(
            combo => combo.dishIds && combo.dishIds.some(id => !!cookArray[id]) && !combo.discovered
        );
        if (mismatches.length === 0) {
            return;
        }
        logCookbookMismatches._logged = true;
        const sample = mismatches.slice(0, 8);
        CabbyCodes.warn(
            `[CabbyCodes] Cookbook mismatch: ${mismatches.length} combos have cooked variants but still show unchecked. Showing first ${sample.length}.`
        );
        for (const combo of sample) {
            const dishStatuses = combo.dishIds
                .map(id => `${id}:${cookArray[id] ? '✔' : '✘'}`)
                .join(', ');
            CabbyCodes.warn(
                `  Combo ${combo.primaryName}` +
                (combo.secondaryId ? ` + ${combo.secondaryName}` : '') +
                ` -> ${combo.resultName}; variants=${dishStatuses}`
            );
        }
    }

    /**
     * Get discovered cooking combination count
     * @returns {number}
     */
    function getDiscoveredCount() {
        const combinations = getAllCookingCombinations();
        return combinations.filter(c => c.discovered).length;
    }

    // -- Window implementation -------------------------------------------------

    function Window_CabbyCodesCookbook() {
        this.initialize(...arguments);
    }

    window.Window_CabbyCodesCookbook = Window_CabbyCodesCookbook;

    Window_CabbyCodesCookbook.prototype = Object.create(Window_Selectable.prototype);
    Window_CabbyCodesCookbook.prototype.constructor = Window_CabbyCodesCookbook;

    Window_CabbyCodesCookbook.prototype.initialize = function(rect) {
        Window_Selectable.prototype.initialize.call(this, rect);
        this.opacity = 255;
        this._combinations = [];
        this._discoveredCount = 0;
        this._refreshTimer = 0;
        this._headerWindow = null;
        this.deactivate();
        this.refreshPanelBackground();
        this.requestImmediateRefresh();
    };

    Window_CabbyCodesCookbook.prototype.refreshPanelBackground = function() {
        if (bookUi && typeof bookUi.applyPanelBackground === 'function') {
            bookUi.applyPanelBackground(this);
            return;
        }
        if (!this.contentsBack) {
            return;
        }
        this.contentsBack.clear();
        this.contentsBack.gradientFillRect(
            0,
            0,
            this.contentsBack.width,
            this.contentsBack.height,
            'rgba(12, 20, 32, 0.98)',
            'rgba(8, 16, 28, 0.95)',
            true
        );
    };

    Window_CabbyCodesCookbook.prototype.setHeaderWindow = function(headerWindow) {
        this._headerWindow = headerWindow || null;
        if (this._headerWindow && typeof this._headerWindow.setListWindow === 'function') {
            this._headerWindow.setListWindow(this);
        }
    };

    Window_CabbyCodesCookbook.prototype.headerInfo = function() {
        return {
            discovered: this._discoveredCount || 0,
            total: this._combinations && Array.isArray(this._combinations)
                ? this._combinations.length
                : 0
        };
    };

    Window_CabbyCodesCookbook.prototype.maxItems = function() {
        if (!this._combinations || !Array.isArray(this._combinations)) {
            return 0;
        }
        return this._combinations.length;
    };

    Window_CabbyCodesCookbook.prototype.itemWidth = function() {
        return this.innerWidth - CONTENT_PADDING * 2;
    };

    Window_CabbyCodesCookbook.prototype.itemHeight = function() {
        return ROW_HEIGHT;
    };

    Window_CabbyCodesCookbook.prototype.itemRect = function(index) {
        const rect = Window_Selectable.prototype.itemRect.call(this, index);
        rect.x = 0;
        rect.width = this.contentsWidth();
        return rect;
    };

    Window_CabbyCodesCookbook.prototype.maxCols = function() {
        return 1;
    };

    Window_CabbyCodesCookbook.prototype.colSpacing = function() {
        return 0;
    };

    Window_CabbyCodesCookbook.prototype.rowSpacing = function() {
        return ROW_SPACING;
    };

    Window_CabbyCodesCookbook.prototype.update = function() {
        Window_Selectable.prototype.update.call(this);
        
        if (this.active) {
            this.ensureCursorVisible(true);
        }
        
        if (this._refreshTimer > 0) {
            this._refreshTimer -= 1;
        }
        if (this._refreshTimer <= 0) {
            this._refreshTimer = REFRESH_INTERVAL_FRAMES;
            this.refreshIfNeeded();
        }
    };

    Window_CabbyCodesCookbook.prototype.refreshIfNeeded = function(force) {
        const combinations = getAllCookingCombinations();
        const discoveredCount = combinations.filter(c => c.discovered).length;
        
        if (
            !force &&
            this._discoveredCount === discoveredCount &&
            combinationsEqual(this._combinations, combinations)
        ) {
            return;
        }
        
        this._combinations = combinations;
        this._discoveredCount = discoveredCount;
        this.paint();
        if (this._headerWindow) {
            this._headerWindow.refresh();
        }
    };

    Window_CabbyCodesCookbook.prototype.requestImmediateRefresh = function() {
        this._refreshTimer = 0;
        this._combinations = [];
        this._discoveredCount = -1;
        this.refreshIfNeeded(true);
    };

    function combinationsEqual(a, b) {
        if (!a || !b || a.length !== b.length) {
            return false;
        }
        for (let i = 0; i < a.length; i++) {
            if (
                a[i].combinationKey !== b[i].combinationKey ||
                a[i].discovered !== b[i].discovered
            ) {
                return false;
            }
        }
        return true;
    }

    Window_CabbyCodesCookbook.prototype.paint = function() {
        if (this.contents) {
            this.resetFontSettings();
            this.contents.clear();
            this.contentsBack.clear();
            this.refreshPanelBackground();
            this.drawAllItems();
        }
    };

    Window_CabbyCodesCookbook.prototype.drawAllItems = function() {
        const topIndex = this.topIndex();
        const maxVisible = this.maxVisibleItems();
        for (let i = 0; i < maxVisible; i++) {
            const index = topIndex + i;
            if (index >= 0 && index < this.maxItems()) {
                this.drawItemBackground(index);
                this.drawItem(index);
            }
        }
    };

    Window_CabbyCodesCookbook.prototype.drawItemBackground = function(index) {
        const rect = this.itemRect(index);
        this.drawBackgroundRect(rect);
    };

    Window_CabbyCodesCookbook.prototype.drawBackgroundRect = function(rect) {
        const c1 = ColorManager.itemBackColor1();
        const c2 = ColorManager.itemBackColor2();
        const x = rect.x;
        const y = rect.y;
        const w = rect.width;
        const h = rect.height;
        this.contentsBack.gradientFillRect(x, y, w, h, c1, c2, true);
        this.contentsBack.fillRect(x, y + h - 1, w, 1, 'rgba(255, 255, 255, 0.1)');
    };

    Window_CabbyCodesCookbook.prototype.drawItem = function(index) {
        if (!this._combinations || !Array.isArray(this._combinations)) {
            return;
        }
        if (index < 0 || index >= this._combinations.length) {
            return;
        }
        const combination = this._combinations[index];
        const rect = this.itemRect(index);
        this.drawCombinationRow(combination, rect.x, rect.y, rect.width);
    };

    Window_CabbyCodesCookbook.prototype.drawCombinationRow = function(combination, x, y, width) {
        const checkboxX = x + ROW_CONTENT_LEFT;
        const rowHeight = this.itemHeight();
        const checkboxY = y + Math.floor((rowHeight - CHECKBOX_SIZE) / 2);
        const contentWidth = width - ROW_CONTENT_LEFT - ROW_CONTENT_RIGHT;
        const textX = checkboxX + CHECKBOX_SIZE + CHECKBOX_PADDING * 2;
        const textWidth = Math.max(0, contentWidth - CHECKBOX_SIZE - CHECKBOX_PADDING * 2);
        const columnGap = 12;
        const resultWidth = Math.max(0, Math.floor(textWidth * 0.5));
        const ingredientsX = textX + resultWidth + columnGap;
        const ingredientsWidth = Math.max(0, textWidth - resultWidth - columnGap);
        const textY = y + Math.floor((rowHeight - this.lineHeight()) / 2);

        this.drawCheckbox(checkboxX, checkboxY, combination.discovered);

        const resultText = combination.resultName;
        const ingredientsText = combination.secondaryId
            ? `${combination.primaryName} + ${combination.secondaryName}`
            : `${combination.primaryName} (solo)`;

        const resultColor = combination.discovered
            ? ColorManager.systemColor()
            : ColorManager.textColor(6);
        const ingredientsColor = combination.discovered
            ? ColorManager.normalColor()
            : ColorManager.textColor(6);

        if (resultWidth > 0) {
            this.changeTextColor(resultColor);
            this.drawText(resultText, textX, textY, resultWidth, 'left');
        }

        if (ingredientsWidth > 0) {
            this.changeTextColor(ingredientsColor);
            this.drawText(ingredientsText, ingredientsX, textY, ingredientsWidth, 'left');
        }
    };

    Window_CabbyCodesCookbook.prototype.drawCheckbox = function(x, y, checked) {
        if (bookUi && typeof bookUi.drawCheckbox === 'function') {
            bookUi.drawCheckbox(this, x, y, checked, { size: CHECKBOX_SIZE });
            return;
        }
        const size = CHECKBOX_SIZE;
        const borderWidth = 2;
        this.contents.fillRect(
            x, 
            y, 
            size, 
            size, 
            checked ? CHECKBOX_CHECKED_COLOR : CHECKBOX_UNCHECKED_COLOR
        );
        this.contents.fillRect(x, y, size, borderWidth, CHECKBOX_BORDER_COLOR);
        this.contents.fillRect(x, y, borderWidth, size, CHECKBOX_BORDER_COLOR);
        this.contents.fillRect(x + size - borderWidth, y, borderWidth, size, CHECKBOX_BORDER_COLOR);
        this.contents.fillRect(x, y + size - borderWidth, size, borderWidth, CHECKBOX_BORDER_COLOR);
        if (checked) {
            this.drawCheckmark(x, y, size);
        }
    };

    Window_CabbyCodesCookbook.prototype.drawCheckmark = function(x, y, size) {
        if (bookUi && typeof bookUi.drawCheckmark === 'function') {
            bookUi.drawCheckmark(this, x, y, size, { padding: 4 });
            return;
        }
        const checkColor = '#000000';
        const lineWidth = 2.5;
        const padding = 4;
        const startX = x + padding;
        const startY = y + size - padding;
        const midX = x + size / 2;
        const midY = y + size / 2 + 1;
        const endX = x + size - padding;
        const endY = y + padding;
        this.drawThickLine(startX, startY, midX, midY, lineWidth, checkColor);
        this.drawThickLine(midX, midY, endX, endY, lineWidth, checkColor);
    };
    
    Window_CabbyCodesCookbook.prototype.drawThickLine = function(x1, y1, x2, y2, thickness, color) {
        if (bookUi && typeof bookUi.drawThickLine === 'function') {
            bookUi.drawThickLine(this, x1, y1, x2, y2, thickness, color);
            return;
        }
        const dx = x2 - x1;
        const dy = y2 - y1;
        const length = Math.sqrt(dx * dx + dy * dy);
        if (length === 0) return;
        
        const step = 1 / Math.max(Math.abs(dx), Math.abs(dy));
        const halfThick = Math.ceil(thickness / 2);
        
        for (let t = 0; t <= 1; t += step) {
            const px = Math.round(x1 + dx * t);
            const py = Math.round(y1 + dy * t);
            this.contents.fillRect(px - halfThick, py - halfThick, thickness, thickness, color);
        }
    };

    // -- Scene implementation --------------------------------------------------

    function Scene_CabbyCodesCookbook() {
        this.initialize(...arguments);
    }

    window.Scene_CabbyCodesCookbook = Scene_CabbyCodesCookbook;

    Scene_CabbyCodesCookbook.prototype = Object.create(Scene_MenuBase.prototype);
    Scene_CabbyCodesCookbook.prototype.constructor = Scene_CabbyCodesCookbook;

    Scene_CabbyCodesCookbook.prototype.initialize = function() {
        Scene_MenuBase.prototype.initialize.call(this);
    };

    Scene_CabbyCodesCookbook.prototype.create = function() {
        Scene_MenuBase.prototype.create.call(this);
        this.createCookbookHeaderWindow();
        this.createCookbookListWindow();
    };

    Scene_CabbyCodesCookbook.prototype.update = function() {
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

    Scene_CabbyCodesCookbook.prototype.createCookbookHeaderWindow = function() {
        const rect = this.cookbookHeaderWindowRect();
        if (bookUi && bookUi.BookHeaderWindow) {
            this._cookbookHeaderWindow = new bookUi.BookHeaderWindow(rect, {
                title: HEADER_TEXT,
                contentPadding: CONTENT_PADDING
            });
        } else {
            this._cookbookHeaderWindow = new Window_CabbyCodesCookbookHeader(rect);
        }
        this.addWindow(this._cookbookHeaderWindow);
    };

    Scene_CabbyCodesCookbook.prototype.createCookbookListWindow = function() {
        const rect = this.cookbookListWindowRect();
        this._cookbookWindow = new Window_CabbyCodesCookbook(rect);
        this._cookbookWindow.setHeaderWindow(this._cookbookHeaderWindow);
        this.addWindow(this._cookbookWindow);
    };

    Scene_CabbyCodesCookbook.prototype.cookbookHeaderWindowRect = function() {
        const layout = this.cookbookLayoutInfo();
        return new Rectangle(layout.wx, layout.headerY, layout.ww, layout.headerHeight);
    };

    Scene_CabbyCodesCookbook.prototype.cookbookListWindowRect = function() {
        const layout = this.cookbookLayoutInfo();
        return new Rectangle(layout.wx, layout.listY, layout.ww, layout.listHeight);
    };

    Scene_CabbyCodesCookbook.prototype.cookbookLayoutInfo = function() {
        if (this._cookbookLayout) {
            return this._cookbookLayout;
        }
        const ww = calculateWindowWidth();
        const headerHeight = this.headerWindowHeight();
        const gap = this.windowGap();
        const listHeight = this.listWindowHeight(headerHeight, gap);
        const totalHeight = headerHeight + gap + listHeight;
        const wx = Math.max(0, Math.floor((Graphics.boxWidth - ww) / 2));
        const headerY = Math.max(24, (Graphics.boxHeight - totalHeight) / 2);
        const listY = headerY + headerHeight + gap;
        this._cookbookLayout = { ww, headerHeight, listHeight, headerY, listY, wx };
        return this._cookbookLayout;
    };

    Scene_CabbyCodesCookbook.prototype.windowGap = function() {
        return 6;
    };

    Scene_CabbyCodesCookbook.prototype.headerWindowHeight = function() {
        const lineHeight = typeof Window_Base !== 'undefined' &&
            typeof Window_Base.prototype.lineHeight === 'function'
            ? Window_Base.prototype.lineHeight.call(Window_Base.prototype)
            : 36;
        return lineHeight + CONTENT_PADDING;
    };

    Scene_CabbyCodesCookbook.prototype.listWindowHeight = function(headerHeight, gap) {
        const padding = this.standardPadding();
        const maxRows = Math.max(6, Math.floor((Graphics.boxHeight - 200) / (ROW_HEIGHT + ROW_SPACING)));
        const listAreaHeight = maxRows * (ROW_HEIGHT + ROW_SPACING) + CONTENT_PADDING * 2;
        const desiredHeight = listAreaHeight + padding * 2;
        const maxAvailable = Graphics.boxHeight - 48 - headerHeight - gap;
        return Math.max(padding * 2 + ROW_HEIGHT * 2, Math.min(desiredHeight, maxAvailable));
    };

    Scene_CabbyCodesCookbook.prototype.standardPadding = function() {
        return typeof Window_Base !== 'undefined' &&
            typeof Window_Base.prototype.standardPadding === 'function'
            ? Window_Base.prototype.standardPadding.call(Window_Base.prototype)
            : 12;
    };

    function calculateWindowWidth() {
        const availableWidth = Math.max(
            MIN_WINDOW_WIDTH,
            Graphics.boxWidth - WINDOW_HORIZONTAL_PADDING * 2
        );
        if (STRETCH_TO_FULL_WIDTH || !Number.isFinite(WINDOW_WIDTH) || WINDOW_WIDTH >= availableWidth) {
            return availableWidth;
        }
        return Math.max(MIN_WINDOW_WIDTH, Math.min(WINDOW_WIDTH, availableWidth));
    }

    const CookbookHeaderBase = bookUi && bookUi.BookHeaderWindow ? bookUi.BookHeaderWindow : null;

    let Window_CabbyCodesCookbookHeader;

    if (CookbookHeaderBase) {
        Window_CabbyCodesCookbookHeader = function(rect) {
            CookbookHeaderBase.call(this, rect, {
                title: HEADER_TEXT,
                contentPadding: CONTENT_PADDING
            });
        };
        Window_CabbyCodesCookbookHeader.prototype = Object.create(CookbookHeaderBase.prototype);
        Window_CabbyCodesCookbookHeader.prototype.constructor = Window_CabbyCodesCookbookHeader;
    } else {
        Window_CabbyCodesCookbookHeader = function() {
            this.initialize(...arguments);
        };

        Window_CabbyCodesCookbookHeader.prototype = Object.create(Window_Base.prototype);
        Window_CabbyCodesCookbookHeader.prototype.constructor = Window_CabbyCodesCookbookHeader;

        Window_CabbyCodesCookbookHeader.prototype.initialize = function(rect) {
            Window_Base.prototype.initialize.call(this, rect);
            this.opacity = 255;
            this._listWindow = null;
            this.padding = this.standardPadding();
            this.refreshBackground();
            this.refresh();
        };

        Window_CabbyCodesCookbookHeader.prototype.setListWindow = function(listWindow) {
            this._listWindow = listWindow;
            this.refresh();
        };

        Window_CabbyCodesCookbookHeader.prototype.refreshBackground = function() {
            if (bookUi && typeof bookUi.applyPanelBackground === 'function') {
                bookUi.applyPanelBackground(this);
                return;
            }
            if (this.contentsBack) {
                this.contentsBack.clear();
                this.contentsBack.gradientFillRect(
                    0,
                    0,
                    this.contentsBack.width,
                    this.contentsBack.height,
                    'rgba(12, 20, 32, 0.98)',
                    'rgba(8, 16, 28, 0.95)',
                    true
                );
            }
        };

        Window_CabbyCodesCookbookHeader.prototype.refresh = function() {
            if (!this.contents) {
                this.createContents();
            }
            this.resetFontSettings();
            this.contents.clear();
            this.refreshBackground();
            const info = this._listWindow ? this._listWindow.headerInfo() : { discovered: 0, total: 0 };
            const usableWidth = this.contentsWidth() - CONTENT_PADDING * 2;
            const top = Math.max(0, Math.floor((this.contentsHeight() - this.lineHeight()) / 2));

            this.changeTextColor(ColorManager.systemColor());
            this.drawText(HEADER_TEXT, CONTENT_PADDING, top, usableWidth / 2, 'left');

            this.changeTextColor(ColorManager.normalColor());
            const countText = `${info.discovered || 0} / ${info.total || 0}`;
            this.drawText(countText, CONTENT_PADDING + usableWidth / 2, top, usableWidth / 2, 'right');
        };

        Window_CabbyCodesCookbookHeader.prototype.standardPadding = function() {
            return 8;
        };

        Window_CabbyCodesCookbookHeader.prototype.updatePadding = function() {
            this.padding = this.standardPadding();
        };
    }

    window.Window_CabbyCodesCookbookHeader = Window_CabbyCodesCookbookHeader;

    CabbyCodes.log('[CabbyCodes] Cookbook initialized');

    // ========================================================================
    // Cooking Combination Checkbox Display for Oven/Cooking Interface
    // ========================================================================

    // Checkbox display constants for item windows
    const ITEM_CHECKBOX_SIZE = 14;
    const ITEM_CHECKBOX_OFFSET = 4;
    const ITEM_CHECKBOX_INNER_SIZE = 10;

    /**
     * Find all possible secondary ingredients for a primary ingredient
     * Uses the same system as recipes - checks item metadata for cooking combinations
     * @param {number} primaryIngredientId
     * @returns {Array<{id: number, discovered: boolean}>}
     */
    function findSecondaryIngredientsForPrimary(primaryIngredientId) {
        const allCombinations = getAllCookingCombinations().filter(
            c => c.primaryId === primaryIngredientId && c.secondaryId !== null
        );
        const seen = new Set();
        const secondaries = [];
        for (const combo of allCombinations) {
            if (!seen.has(combo.secondaryId)) {
                seen.add(combo.secondaryId);
                secondaries.push({
                    id: combo.secondaryId,
                    discovered: combo.discovered
                });
            }
        }
        return secondaries;
    }

    /**
     * Check if all available secondary ingredients have been tried with a primary
     * @param {number} primaryIngredientId
     * @returns {boolean}
     */
    function allSecondaryIngredientsTried(primaryIngredientId) {
        const combos = getAllCookingCombinations().filter(c => c.primaryId === primaryIngredientId);
        if (combos.length === 0) {
            return false;
        }
        const withSecondaries = combos.filter(c => c.secondaryId !== null);
        const soloCombos = combos.filter(c => c.secondaryId === null);
        if (withSecondaries.length === 0) {
            return soloCombos.length > 0 && soloCombos.every(c => c.discovered);
        }
        return withSecondaries.every(c => c.discovered);
    }

    /**
     * Check if a specific primary+secondary combination has been tried
     * @param {number} primaryIngredientId
     * @param {number} secondaryIngredientId
     * @returns {boolean}
     */
    function combinationTried(primaryIngredientId, secondaryIngredientId) {
        const combos = getAllCookingCombinations();
        const match = combos.find(
            combo =>
                combo.primaryId === primaryIngredientId &&
                combo.secondaryId === secondaryIngredientId
        );
        return match ? match.discovered : false;
    }

    /**
     * Get the currently selected primary ingredient (if in cooking context)
     * Checks variable 1 which often stores the primary ingredient ID during cooking
     * @returns {number|null}
     */
    function getSelectedPrimaryIngredient() {
        // Try to detect primary ingredient from common variables used in cooking
        // Variable 1-4 are often used for recipe data (ing1, ing2, res, amnt)
        if (typeof $gameVariables !== 'undefined' && $gameVariables) {
            const v1 = $gameVariables.value(1);
            if (v1 && typeof v1 === 'number' && v1 > 0 && v1 < 999) {
                // Check if this item exists and could be used for cooking
                if (typeof $dataItems !== 'undefined' && $dataItems[v1]) {
                    // Check if this item can be used as primary for cooking
                    const secondaries = findSecondaryIngredientsForPrimary(v1);
                    if (secondaries.length > 0) {
                        return v1;
                    }
                }
            }
        }
        return null;
    }

    /**
     * Check if an item could be used as a primary ingredient for cooking
     * @param {object} item
     * @returns {boolean}
     */
    function isPotentialPrimaryIngredient(item) {
        if (!item || !item.id) return false;
        const combos = getAllCookingCombinations();
        return combos.some(c => c.primaryId === item.id);
    }

    /**
     * Check if an item could be used as a secondary ingredient for the selected primary
     * @param {object} item
     * @param {number} primaryIngredientId
     * @returns {boolean}
     */
    function isPotentialSecondaryIngredient(item, primaryIngredientId) {
        if (!item || !item.id) return false;
        const combos = getAllCookingCombinations();
        return combos.some(c => c.primaryId === primaryIngredientId && c.secondaryId === item.id);
    }

    /**
     * Draw a small checkbox in an item window
     * @param {object} window - The window object
     * @param {number} x - X position
     * @param {number} y - Y position
     * @param {boolean} checked - Whether checkbox is checked
     */
    function drawItemWindowCheckbox(window, x, y, checked) {
        const size = ITEM_CHECKBOX_SIZE;
        const borderWidth = 1.5;
        
        if (!window || !window.contents) return;
        
        // Draw checkbox background
        window.contents.fillRect(
            x, 
            y, 
            size, 
            size, 
            checked ? CHECKBOX_CHECKED_COLOR : CHECKBOX_UNCHECKED_COLOR
        );
        
        // Draw border
        window.contents.fillRect(x, y, size, borderWidth, CHECKBOX_BORDER_COLOR);
        window.contents.fillRect(x, y, borderWidth, size, CHECKBOX_BORDER_COLOR);
        window.contents.fillRect(x + size - borderWidth, y, borderWidth, size, CHECKBOX_BORDER_COLOR);
        window.contents.fillRect(x, y + size - borderWidth, size, borderWidth, CHECKBOX_BORDER_COLOR);
        
        // Draw checkmark if checked
        if (checked) {
            drawItemWindowCheckmark(window, x, y, size);
        }
    }

    /**
     * Draw checkmark in checkbox
     * @param {object} window
     * @param {number} x
     * @param {number} y
     * @param {number} size
     */
    function drawItemWindowCheckmark(window, x, y, size) {
        const checkColor = '#000000';
        const lineWidth = 2;
        const padding = 3;
        
        const startX = x + padding;
        const startY = y + size - padding;
        const midX = x + size / 2;
        const midY = y + size / 2 + 1;
        const endX = x + size - padding;
        const endY = y + padding;
        
        drawItemWindowThickLine(window, startX, startY, midX, midY, lineWidth, checkColor);
        drawItemWindowThickLine(window, midX, midY, endX, endY, lineWidth, checkColor);
    }
    
    function drawItemWindowThickLine(window, x1, y1, x2, y2, thickness, color) {
        const dx = x2 - x1;
        const dy = y2 - y1;
        const length = Math.sqrt(dx * dx + dy * dy);
        if (length === 0) return;
        
        const step = 1 / Math.max(Math.abs(dx), Math.abs(dy));
        const halfThick = Math.ceil(thickness / 2);
        
        for (let t = 0; t <= 1; t += step) {
            const px = Math.round(x1 + dx * t);
            const py = Math.round(y1 + dy * t);
            window.contents.fillRect(px - halfThick, py - halfThick, thickness, thickness, color);
        }
    }

        // Patch Window_ItemList to add checkboxes for cooking combination discovery
        if (typeof Window_ItemList !== 'undefined' && typeof CabbyCodes !== 'undefined' && typeof CabbyCodes.after === 'function') {
            CabbyCodes.after(
                Window_ItemList.prototype,
                'drawItem',
                function(index) {
                    const item = this.itemAt(index);
                    if (!item) return;
                    
                    const rect = this.itemLineRect(index);
                    // Position checkbox before the number area, accounting for number width
                    const numberWidth = this.numberWidth ? this.numberWidth() : this.textWidth("000");
                    const checkboxX = rect.x + rect.width - numberWidth - ITEM_CHECKBOX_SIZE - ITEM_CHECKBOX_OFFSET - 8;
                    // Better vertical alignment - center with text
                    const lineHeight = this.lineHeight ? this.lineHeight() : 36;
                    const checkboxY = rect.y + Math.floor((rect.height - ITEM_CHECKBOX_SIZE) / 2);
                    
                    let shouldShowCheckbox = false;
                    let isChecked = false;
                    
                    // Check if this is a primary ingredient selection for cooking
                    if (isPotentialPrimaryIngredient(item)) {
                        shouldShowCheckbox = true;
                        isChecked = allSecondaryIngredientsTried(item.id);
                    } else {
                        // Check if we're selecting secondary ingredients for cooking
                        const primaryIngredientId = getSelectedPrimaryIngredient();
                        if (primaryIngredientId && isPotentialSecondaryIngredient(item, primaryIngredientId)) {
                            shouldShowCheckbox = true;
                            isChecked = combinationTried(primaryIngredientId, item.id);
                        }
                    }
                    
                    if (shouldShowCheckbox) {
                        drawItemWindowCheckbox(this, checkboxX, checkboxY, isChecked);
                    }
                },
                null // No setting key - always active
            );
            
            CabbyCodes.log('[CabbyCodes] Cookbook: Added cooking combination checkboxes to item windows');
        }
})();

