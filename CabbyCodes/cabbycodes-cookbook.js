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
    let dishMetadataCache = null;

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
    const ROW_CONTENT_LEFT = Math.max(
        0,
        (bookUi?.defaults?.rowContentLeft ?? 16) - 8
    );
    const ROW_CONTENT_RIGHT = bookUi?.defaults?.rowContentRight ?? 8;
    const ROW_VERTICAL_ADJUST = Number.isFinite(bookUiDefaults.rowVerticalAdjust)
        ? bookUiDefaults.rowVerticalAdjust
        : 0;
    const ROW_CHECKBOX_OFFSET = Number.isFinite(bookUiDefaults.rowCheckboxOffset)
        ? bookUiDefaults.rowCheckboxOffset
        : ROW_VERTICAL_ADJUST;
    const ROW_TEXT_OFFSET = Number.isFinite(bookUiDefaults.rowTextOffset)
        ? bookUiDefaults.rowTextOffset
        : ROW_VERTICAL_ADJUST;
    const COLUMN_GAP = 12;
    const COLUMN_HEADER_RECIPE_TEXT = 'Recipe';
    const COLUMN_HEADER_INGREDIENTS_TEXT = 'Ingredients';
    const COLUMN_HEADER_LINE_HEIGHT = ROW_HEIGHT;

    function columnHeaderPadding() {
        return resolveWindowBasePadding();
    }

    // Checkbox colors
    const CHECKBOX_CHECKED_COLOR = '#68ffd1';
    const CHECKBOX_UNCHECKED_COLOR = 'rgba(255, 255, 255, 0.3)';
    const CHECKBOX_BORDER_COLOR = '#ffffff';

    function resolveWindowBaseLineHeight() {
        if (
            typeof Window_Base !== 'undefined' &&
            typeof Window_Base.prototype.lineHeight === 'function'
        ) {
            try {
                return Window_Base.prototype.lineHeight.call(Window_Base.prototype);
            } catch (error) {
                // Ignore and fall through to fallback.
            }
        }
        return 36;
    }

    function resolveWindowBasePadding() {
        if (
            typeof Window_Base !== 'undefined' &&
            typeof Window_Base.prototype.standardPadding === 'function'
        ) {
            try {
                return Window_Base.prototype.standardPadding.call(Window_Base.prototype);
            } catch (error) {
                // Ignore and fall through to fallback.
            }
        }
        return 12;
    }

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
            const primaryName = safeItemName(primaryItem, entry.primaryId);
            const secondaryName = secondaryItem
                ? safeItemName(secondaryItem, entry.secondaryId)
                : 'Solo';
            const variantNames = entry.variants.map(v => cleanCookbookText(v.dishName, 'Unknown Dish'));
            const discovered =
                hasAutoDiscovery(entry) ||
                (cookArray ? dishIds.some(id => !!cookArray[id]) : false);
            return {
                combinationKey: `${entry.primaryId}-${entry.secondaryId || 'solo'}`,
                primaryId: entry.primaryId,
                primaryName,
                secondaryId: entry.secondaryId,
                secondaryName,
                dishIds,
                variantNames,
                resultName,
                discovered
            };
        });

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
        const fallback = id ? `Item ${id}` : 'Unknown';
        if (item && item.name) {
            return cleanCookbookText(item.name, fallback);
        }
        return fallback;
    }

    function resolveDishResultName(dishId) {
        const fallback = `Dish ${dishId}`;
        const metadata = getDishMetadata().get(dishId) || null;
        if (metadata?.itemId) {
            const itemName = resolveItemNameFromDatabase(metadata.itemId);
            if (itemName) {
                return itemName;
            }
        }
        if (metadata?.label) {
            return metadata.label;
        }
        if (metadata?.description) {
            return cleanCookbookText(metadata.description, fallback);
        }
        return fallback;
    }

    function resolveItemNameFromDatabase(itemId) {
        if (typeof $dataItems === 'undefined' || !$dataItems) {
            return null;
        }
        const item = $dataItems[itemId];
        if (!item || !item.name) {
            return null;
        }
        return cleanCookbookText(item.name, '');
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
        const complexityStack = [];

        for (const command of event.list) {
            trimConstraintStack(constraintStack, command.indent);
            trimComplexityStack(complexityStack, command.indent);

            if (command.code === 111) {
                const condition = parseVariableEqualityCondition(command);
                if (condition) {
                    constraintStack.push(condition);
                }
            } else if (command.code === 122 && isSettingComplexityValue(command)) {
                const complexityValue = Number(command.parameters?.[4]);
                if (Number.isFinite(complexityValue)) {
                    complexityStack.push({
                        indent: command.indent,
                        value: complexityValue
                    });
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
                        dishName,
                        complexity: getCurrentComplexity(complexityStack)
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

    function trimComplexityStack(stack, indent) {
        while (stack.length && stack[stack.length - 1].indent > indent) {
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

    function isSettingComplexityValue(command) {
        const params = command.parameters;
        return (
            Array.isArray(params) &&
            params[0] === 647 &&
            params[1] === 647
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

    function getCurrentComplexity(stack) {
        if (!stack.length) {
            return null;
        }
        const entry = stack[stack.length - 1];
        return Number.isFinite(entry?.value) ? entry.value : null;
    }

    function getDishMetadata() {
        if (dishMetadataCache) {
            return dishMetadataCache;
        }
        dishMetadataCache = buildDishMetadata();
        return dishMetadataCache;
    }

    function buildDishMetadata() {
        const metadata = new Map();
        const event = findCommonEventByName(COOKED_MEAL_EVENT_NAME);
        if (!event || !Array.isArray(event.list)) {
            return metadata;
        }

        const dishConditionStack = [];

        for (const command of event.list) {
            trimConstraintStack(dishConditionStack, command.indent);

            if (command.code === 118 && command.parameters && command.parameters[0]) {
                const parsed = parseDishLabel(command.parameters[0]);
                if (parsed) {
                    const entry = ensureDishMetadata(metadata, parsed.dishId);
                    entry.label = parsed.label || entry.label;
                }
                continue;
            }

            if (command.code === 111) {
                const condition = parseVariableEqualityCondition(command);
                if (condition && condition.varId === COOKED_RESULT_VAR_ID) {
                    dishConditionStack.push(condition);
                    ensureDishMetadata(metadata, condition.value);
                }
                continue;
            }

            if (!dishConditionStack.length) {
                continue;
            }

            const activeDish = dishConditionStack[dishConditionStack.length - 1];
            const entry = ensureDishMetadata(metadata, activeDish.value);

            if (command.code === 122 && isSettingCookDescription(command)) {
                const description = extractCookDescription(command.parameters[4]);
                if (description) {
                    entry.description = entry.description || description;
                }
            } else if (command.code === 126 && isAddingResultItem(command.parameters)) {
                const itemId = command.parameters[0];
                if (itemId) {
                    entry.itemId = entry.itemId || itemId;
                }
            }
        }

        return metadata;
    }

    function ensureDishMetadata(map, dishId) {
        if (!map.has(dishId)) {
            map.set(dishId, { label: null, description: null, itemId: null });
        }
        return map.get(dishId);
    }

    const DISH_LABEL_OVERRIDES = {
        frozenveggies: 'Frozen Veggies',
        frozenfish: 'Frozen Fish',
        tomatosoup: 'Tomato Soup',
        cookedham: 'Cooked Ham'
    };

    function parseDishLabel(label) {
        const match = /^(\d+)\s*[-:]\s*(.+)$/i.exec(label);
        if (!match) {
            return null;
        }
        const dishId = Number(match[1]);
        if (!dishId) {
            return null;
        }
        const labelText = formatDishLabel(typeof match[2] === 'string' ? match[2].trim() : '');
        if (!labelText) {
            return null;
        }
        return { dishId, label: labelText };
    }

    function isSettingCookDescription(command) {
        const params = command.parameters;
        return (
            Array.isArray(params) &&
            params[0] === 8 &&
            params[1] === 8 &&
            params[3] === 4 &&
            typeof params[4] === 'string'
        );
    }

    function isAddingResultItem(params) {
        if (!Array.isArray(params)) {
            return false;
        }
        const [itemId, operation, operandType] = params;
        return itemId > 0 && operation === 0 && operandType === 0;
    }

    function extractCookDescription(script) {
        const text = parseCookbookScriptString(script);
        if (!text) {
            return '';
        }
        return cleanCookbookText(text, '');
    }

    function parseCookbookScriptString(script) {
        if (typeof script !== 'string') {
            return '';
        }
        try {
            return JSON.parse(script);
        } catch (error) {
            const trimmed = script.trim();
            if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
                return trimmed.slice(1, -1);
            }
            return trimmed;
        }
    }

    function formatDishLabel(rawLabel) {
        if (!rawLabel) {
            return '';
        }
        const trimmed = rawLabel.trim();
        if (!trimmed) {
            return '';
        }
        if (Object.prototype.hasOwnProperty.call(DISH_LABEL_OVERRIDES, trimmed)) {
            return DISH_LABEL_OVERRIDES[trimmed];
        }
        const expanded = trimmed
            .replace(/[_\-]+/g, ' ')
            .replace(/([a-z])([A-Z])/g, '$1 $2');
        const cleaned = cleanCookbookText(expanded, '');
        if (!cleaned) {
            return '';
        }
        return cleaned
            .split(' ')
            .map(capitalizeDishWord)
            .join(' ')
            .trim();
    }

    function capitalizeDishWord(word) {
        if (!word) {
            return '';
        }
        if (word.length <= 2) {
            return word.toUpperCase();
        }
        return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    }

    function cleanCookbookText(text, fallback = '') {
        if (text === null || text === undefined) {
            return fallback;
        }
        const withoutParens = String(text).replace(/\s*\([^)]*\)/g, ' ');
        const collapsed = withoutParens.replace(/\s+/g, ' ').trim();
        return collapsed || fallback;
    }

    function formatVariantName(variants) {
        if (!Array.isArray(variants) || variants.length === 0) {
            return 'Unknown Dish';
        }
        const cleanedNames = variants
            .map(v => cleanCookbookText(v.dishName || '', ''))
            .filter(Boolean);
        if (cleanedNames.length === 0) {
            return 'Unknown Dish';
        }
        const uniqueNames = [...new Set(cleanedNames)];
        if (uniqueNames.length === 1) {
            return uniqueNames[0];
        }
        const combined = uniqueNames.join(' / ');
        return cleanCookbookText(combined, 'Unknown Dish');
    }

    function findCommonEventByName(name) {
        if (typeof $dataCommonEvents === 'undefined' || !Array.isArray($dataCommonEvents)) {
            return null;
        }
        return $dataCommonEvents.find(evt => evt && evt.name === name) || null;
    }

    function hasAutoDiscovery(comboEntry) {
        if (!comboEntry) {
            return false;
        }
        // Single-ingredient (solo) recipes never require discovery marks in-game
        return !comboEntry.secondaryId;
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

    function calculateCookbookColumnLayout(availableWidth) {
        const usableWidth = Math.max(
            0,
            availableWidth - ROW_CONTENT_LEFT - ROW_CONTENT_RIGHT
        );
        const recipeX = ROW_CONTENT_LEFT + CHECKBOX_SIZE + CHECKBOX_PADDING * 2;
        const textWidth = Math.max(0, usableWidth - CHECKBOX_SIZE - CHECKBOX_PADDING * 2);
        const recipeWidth = Math.max(0, Math.floor(textWidth * 0.5));
        const ingredientsX = recipeX + recipeWidth + COLUMN_GAP;
        const ingredientsWidth = Math.max(0, textWidth - recipeWidth - COLUMN_GAP);
        return {
            recipeX,
            recipeWidth,
            ingredientsX,
            ingredientsWidth
        };
    }

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
        const checkboxY =
            y + Math.floor((rowHeight - CHECKBOX_SIZE) / 2) + ROW_CHECKBOX_OFFSET;
        const layout = this.columnLayout();
        const recipeX = x + layout.recipeX;
        const recipeWidth = layout.recipeWidth;
        const ingredientsX = x + layout.ingredientsX;
        const ingredientsWidth = layout.ingredientsWidth;
        const textY =
            y + Math.floor((rowHeight - this.lineHeight()) / 2) + ROW_TEXT_OFFSET;

        this.drawCheckbox(checkboxX, checkboxY, combination.discovered);

        const resultText = combination.resultName;
        const ingredientsText = combination.secondaryId
            ? `${combination.primaryName} + ${combination.secondaryName}`
            : combination.primaryName;

        const resultColor = combination.discovered
            ? ColorManager.systemColor()
            : ColorManager.textColor(6);
        const ingredientsColor = combination.discovered
            ? ColorManager.normalColor()
            : ColorManager.textColor(6);

        if (recipeWidth > 0) {
            this.changeTextColor(resultColor);
            this.drawText(resultText, recipeX, textY, recipeWidth, 'left');
        }

        if (ingredientsWidth > 0) {
            this.changeTextColor(ingredientsColor);
            this.drawText(ingredientsText, ingredientsX, textY, ingredientsWidth, 'left');
        }
    };

    Window_CabbyCodesCookbook.prototype.columnLayout = function() {
        return calculateCookbookColumnLayout(this.contentsWidth());
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
        this.createCookbookColumnHeaderWindow();
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
                contentPadding: CONTENT_PADDING,
                resolveTitleX() {
                    return cookbookHeaderTitleX(this.padding);
                }
            });
        } else {
            this._cookbookHeaderWindow = new Window_CabbyCodesCookbookHeader(rect);
        }
        this.addWindow(this._cookbookHeaderWindow);
    };

    Scene_CabbyCodesCookbook.prototype.createCookbookColumnHeaderWindow = function() {
        const rect = this.cookbookColumnHeaderWindowRect();
        this._cookbookColumnHeaderWindow = new Window_CabbyCodesCookbookColumns(rect);
        this.addWindow(this._cookbookColumnHeaderWindow);
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

    Scene_CabbyCodesCookbook.prototype.cookbookColumnHeaderWindowRect = function() {
        const layout = this.cookbookLayoutInfo();
        return new Rectangle(layout.wx, layout.columnY, layout.ww, layout.columnHeight);
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
        const headerGap = this.windowGap();
        const columnGap = this.windowGap();
        const columnHeight = this.columnHeaderWindowHeight();
        const occupiedAboveList = headerHeight + headerGap + columnHeight + columnGap;
        const listHeight = this.listWindowHeight(occupiedAboveList);
        const totalHeight = occupiedAboveList + listHeight;
        const wx = Math.max(0, Math.floor((Graphics.boxWidth - ww) / 2));
        const headerY = Math.max(24, (Graphics.boxHeight - totalHeight) / 2);
        const columnY = headerY + headerHeight + headerGap;
        const listY = columnY + columnHeight + columnGap;
        this._cookbookLayout = {
            ww,
            headerHeight,
            columnHeight,
            listHeight,
            headerY,
            columnY,
            listY,
            wx
        };
        return this._cookbookLayout;
    };

    Scene_CabbyCodesCookbook.prototype.windowGap = function() {
        return 0;
    };

    Scene_CabbyCodesCookbook.prototype.columnHeaderWindowHeight = function() {
        const padding = columnHeaderPadding();
        return COLUMN_HEADER_LINE_HEIGHT + padding * 2;
    };

    Scene_CabbyCodesCookbook.prototype.headerWindowHeight = function() {
        const lineHeight = typeof Window_Base !== 'undefined' &&
            typeof Window_Base.prototype.lineHeight === 'function'
            ? Window_Base.prototype.lineHeight.call(Window_Base.prototype)
            : 36;
        return lineHeight + CONTENT_PADDING;
    };

    Scene_CabbyCodesCookbook.prototype.listWindowHeight = function(occupiedHeightAboveList) {
        const padding = this.standardPadding();
        const maxRows = Math.max(6, Math.floor((Graphics.boxHeight - 200) / (ROW_HEIGHT + ROW_SPACING)));
        const listAreaHeight = maxRows * (ROW_HEIGHT + ROW_SPACING) + CONTENT_PADDING * 2;
        const desiredHeight = listAreaHeight + padding * 2;
        const maxAvailable = Graphics.boxHeight - 48 - occupiedHeightAboveList;
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

    function cookbookHeaderTitleX(headerPadding) {
        const columnPadding = columnHeaderPadding();
        const recipeColumnOffset = ROW_CONTENT_LEFT + CHECKBOX_SIZE + CHECKBOX_PADDING * 2;
        const desired = columnPadding + recipeColumnOffset - (headerPadding || 0);
        return Math.max(CONTENT_PADDING, desired);
    }

    const CookbookHeaderBase = bookUi && bookUi.BookHeaderWindow ? bookUi.BookHeaderWindow : null;

    let Window_CabbyCodesCookbookHeader;

    if (CookbookHeaderBase) {
        Window_CabbyCodesCookbookHeader = function(rect) {
            CookbookHeaderBase.call(this, rect, {
                title: HEADER_TEXT,
                contentPadding: CONTENT_PADDING,
                resolveTitleX() {
                    return cookbookHeaderTitleX(this.padding);
                }
            });
        };
        Window_CabbyCodesCookbookHeader.prototype = Object.create(CookbookHeaderBase.prototype);
        Window_CabbyCodesCookbookHeader.prototype.constructor = Window_CabbyCodesCookbookHeader;
    } else {
        Window_CabbyCodesCookbookHeader = function() {
            this.initialize(...arguments);
        };

        const FALLBACK_HEADER_GREEN = '#2edf87';

        function cookbookIncompleteHeaderColor() {
            if (bookUi && typeof bookUi.getIncompleteHeaderColor === 'function') {
                return bookUi.getIncompleteHeaderColor();
            }
            if (typeof ColorManager !== 'undefined') {
                if (typeof ColorManager.powerUpColor === 'function') {
                    return ColorManager.powerUpColor();
                }
                if (typeof ColorManager.textColor === 'function') {
                    try {
                        return ColorManager.textColor(3);
                    } catch (error) {
                        // Ignore and fall through to the default color.
                    }
                }
            }
            return FALLBACK_HEADER_GREEN;
        }

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
            const discovered = Number(info?.discovered ?? 0);
            const total = Number(info?.total ?? 0);
            const isIncomplete = total > 0 && discovered < total;
            const accentColor = isIncomplete
                ? cookbookIncompleteHeaderColor()
                : ColorManager?.systemColor?.() || '#FFFFFF';
            const countColor = isIncomplete
                ? accentColor
                : ColorManager?.normalColor?.() || '#FFFFFF';
            const usableWidth = this.contentsWidth() - CONTENT_PADDING * 2;
            const top = Math.max(0, Math.floor((this.contentsHeight() - this.lineHeight()) / 2));
            const titleX = cookbookHeaderTitleX(this.padding);
            const titleWidth = Math.max(0, this.contentsWidth() - titleX - CONTENT_PADDING);
            this.changeTextColor(accentColor);
            this.drawText(HEADER_TEXT, titleX, top, titleWidth, 'left');
            this.changeTextColor(countColor);
            const countText = `${info.discovered || 0} / ${info.total || 0}`;
            this.drawText(countText, CONTENT_PADDING, top, usableWidth, 'right');
        };

        Window_CabbyCodesCookbookHeader.prototype.standardPadding = function() {
            return 8;
        };

        Window_CabbyCodesCookbookHeader.prototype.updatePadding = function() {
            this.padding = this.standardPadding();
        };
    }

    window.Window_CabbyCodesCookbookHeader = Window_CabbyCodesCookbookHeader;

    function Window_CabbyCodesCookbookColumns() {
        this.initialize(...arguments);
    }

    window.Window_CabbyCodesCookbookColumns = Window_CabbyCodesCookbookColumns;

    Window_CabbyCodesCookbookColumns.prototype = Object.create(Window_Base.prototype);
    Window_CabbyCodesCookbookColumns.prototype.constructor = Window_CabbyCodesCookbookColumns;

    Window_CabbyCodesCookbookColumns.prototype.initialize = function(rect) {
        Window_Base.prototype.initialize.call(this, rect);
        this.opacity = 255;
        this.padding = this.standardPadding();
        this.refreshBackground();
        this.refresh();
    };

    Window_CabbyCodesCookbookColumns.prototype.standardPadding = function() {
        return columnHeaderPadding();
    };

    Window_CabbyCodesCookbookColumns.prototype.lineHeight = function() {
        return COLUMN_HEADER_LINE_HEIGHT;
    };

    Window_CabbyCodesCookbookColumns.prototype.refreshBackground = function() {
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

    Window_CabbyCodesCookbookColumns.prototype.refresh = function() {
        if (!this.contents) {
            this.createContents();
        }
        this.resetFontSettings();
        this.contents.clear();
        this.refreshBackground();

        const layout = calculateCookbookColumnLayout(this.contentsWidth());
        const baselineY = Math.max(
            0,
            Math.floor((this.contentsHeight() - this.lineHeight()) / 2)
        );
        const recipeColor = ColorManager?.systemColor?.() || '#FFFFFF';
        const ingredientsColor = ColorManager?.normalColor?.() || '#FFFFFF';

        this.changeTextColor(recipeColor);
        this.drawText(
            COLUMN_HEADER_RECIPE_TEXT,
            layout.recipeX,
            baselineY,
            layout.recipeWidth,
            'left'
        );

        this.changeTextColor(ingredientsColor);
        this.drawText(
            COLUMN_HEADER_INGREDIENTS_TEXT,
            layout.ingredientsX,
            baselineY,
            layout.ingredientsWidth,
            'left'
        );
    };

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


