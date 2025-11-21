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
    const WINDOW_WIDTH = 640;
    const ROW_HEIGHT = 24;  // Tight vertical spacing
    const ROW_SPACING = 2;
    const REFRESH_INTERVAL_FRAMES = 30;
    const HEADER_TEXT = 'Cook Book';
    const CHECKBOX_SIZE = 16;
    const CHECKBOX_PADDING = 4;
    const RECIPE_NAME_OFFSET = CHECKBOX_SIZE + CHECKBOX_PADDING * 2;
    const CONTENT_PADDING = 12;
    const FOOTER_TEXT = 'Press any button to return';
    const RESET_DELAY_MS = 30;

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
            const comboKey = `${entry.primaryId}-${entry.secondaryId || 'solo'}-${entry.dishId}`;
            return {
                combinationKey: comboKey,
                primaryId: entry.primaryId,
                primaryName: safeItemName(primaryItem, entry.primaryId),
                secondaryId: entry.secondaryId,
                secondaryName: secondaryItem ? safeItemName(secondaryItem, entry.secondaryId) : '(Solo)',
                resultId: entry.dishId,
                resultName: entry.dishName || `Dish ${entry.dishId}`,
                discovered: cookArray ? !!cookArray[entry.dishId] : false
            };
        });

        combinations.sort((a, b) => {
            if (a.discovered !== b.discovered) {
                return a.discovered ? -1 : 1;
            }
            if (a.primaryName !== b.primaryName) {
                return a.primaryName.localeCompare(b.primaryName);
            }
            if (a.secondaryName !== b.secondaryName) {
                return a.secondaryName.localeCompare(b.secondaryName);
            }
            return a.resultName.localeCompare(b.resultName);
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

        const dishNameMap = getDishNameMap();
        const combos = [];
        const constraintStack = [];
        let pendingDishName = null;

        for (const command of event.list) {
            trimConstraintStack(constraintStack, command.indent);

            if (command.code === 111) {
                const condition = parseVariableEqualityCondition(command);
                if (condition) {
                    constraintStack.push(condition);
                }
                pendingDishName = null;
            } else if (command.code === 108) {
                pendingDishName = command.parameters[0] || '';
            } else if (command.code === 408 && pendingDishName) {
                pendingDishName += `\n${command.parameters[0] || ''}`;
            } else if (command.code === 122 && isSettingCookedResult(command)) {
                const dishId = command.parameters[4];
                const primaryId = getConstraintValue(constraintStack, PRIMARY_VAR_ID);
                const secondaryId = getConstraintValue(constraintStack, SECONDARY_VAR_ID);
                if (primaryId) {
                    const dishName =
                        dishNameMap.get(dishId) ||
                        extractDishNameFromComment(pendingDishName) ||
                        `Dish ${dishId}`;
                    combos.push({
                        primaryId,
                        secondaryId: secondaryId || null,
                        dishId,
                        dishName
                    });
                }
                pendingDishName = null;
            } else if (!IGNORED_COMMAND_CODES.has(command.code)) {
                pendingDishName = null;
            }
        }

        return deduplicateCombos(combos);
    }

    function deduplicateCombos(combos) {
        const map = new Map();
        for (const combo of combos) {
            const key = `${combo.primaryId}-${combo.secondaryId || 'solo'}-${combo.dishId}`;
            if (!map.has(key)) {
                map.set(key, combo);
            }
        }
        return Array.from(map.values());
    }

    const IGNORED_COMMAND_CODES = new Set([0, 112, 113, 117, 122, 221, 222, 223, 230, 355, 357, 412, 413, 505, 655]);

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

    function extractDishNameFromComment(comment) {
        if (!comment) {
            return null;
        }
        const text = comment.trim();
        if (!text || /recipe/i.test(text)) {
            return null;
        }
        return text;
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

    function findCommonEventByName(name) {
        if (typeof $dataCommonEvents === 'undefined' || !Array.isArray($dataCommonEvents)) {
            return null;
        }
        return $dataCommonEvents.find(evt => evt && evt.name === name) || null;
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
        this._scrollY = 0;
        this._headerHeight = 0;
        this.deactivate();
        this.refreshPanelBackground();
        this.requestImmediateRefresh();
    };

    Window_CabbyCodesCookbook.prototype.refreshPanelBackground = function() {
        if (!this.contentsBack) {
            return;
        }
        this.contentsBack.clear();
        // Improved styling - darker background with subtle texture
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

    Window_CabbyCodesCookbook.prototype.maxItems = function() {
        if (!this._combinations || !Array.isArray(this._combinations)) {
            return 0;
        }
        return this._combinations.length;
    };

    Window_CabbyCodesCookbook.prototype.itemRect = function(index) {
        const rect = new Rectangle(0, 0, 0, 0);
        const itemWidth = this.itemWidth();
        const itemHeight = this.itemHeight();
        const rowSpacing = this.rowSpacing();
        
        // Calculate row position accounting for spacing
        rect.x = CONTENT_PADDING;
        rect.y = index * (itemHeight + rowSpacing);
        rect.width = itemWidth;
        rect.height = itemHeight;
        return rect;
    };

    Window_CabbyCodesCookbook.prototype.itemWidth = function() {
        return this.innerWidth - CONTENT_PADDING * 2;
    };

    Window_CabbyCodesCookbook.prototype.itemHeight = function() {
        return ROW_HEIGHT;
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
        
        // Handle scrolling with keyboard
        if (this.active) {
            if (Input.isRepeated('down') || Input.isRepeated('ok')) {
                this.scrollDown();
            }
            if (Input.isRepeated('up')) {
                this.scrollUp();
            }
        }
        
        // Handle wheel scrolling
        if (TouchInput.wheelY !== 0) {
            this.processWheelScroll();
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
        
        if (!force && 
            this._discoveredCount === discoveredCount &&
            combinationsEqual(this._combinations, combinations)) {
            return;
        }
        
        this._combinations = combinations;
        this._discoveredCount = discoveredCount;
        this.refresh();
    };

    Window_CabbyCodesCookbook.prototype.requestImmediateRefresh = function() {
        this._refreshTimer = 0;
        this._combinations = [];
        this._discoveredCount = -1;
        this.refreshIfNeeded(true);
    };

    function combinationsEqual(a, b) {
        if (a.length !== b.length) {
            return false;
        }
        for (let i = 0; i < a.length; i++) {
            if (a[i].combinationKey !== b[i].combinationKey || 
                a[i].discovered !== b[i].discovered) {
                return false;
            }
        }
        return true;
    }

    Window_CabbyCodesCookbook.prototype.paint = function() {
        // Override paint to include header and footer
        if (this.contents) {
            this.resetFontSettings();
            this.contents.clear();
            this.contentsBack.clear();
            this.refreshPanelBackground();
            
            const usableWidth = this.contentsWidth() - CONTENT_PADDING * 2;
            let offsetY = CONTENT_PADDING;

            // Draw header with count
            offsetY += this.drawHeader(offsetY, usableWidth);
            offsetY += ROW_SPACING * 2;

            // Store header offset for item drawing
            this._headerHeight = offsetY;
            
            // Draw scrollable item list
            this.drawAllItems();
            
            // Draw footer
            if (FOOTER_TEXT) {
                const footerY = this.contentsHeight() - this.lineHeight() - CONTENT_PADDING;
                this.changeTextColor(ColorManager.textColor(6));
                this.drawText(FOOTER_TEXT, CONTENT_PADDING, footerY, usableWidth, 'center');
            }
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

    Window_CabbyCodesCookbook.prototype.drawItem = function(index) {
        if (!this._combinations || !Array.isArray(this._combinations)) {
            return;
        }
        if (index < 0 || index >= this._combinations.length) {
            return;
        }
        const combination = this._combinations[index];
        const rect = this.itemRect(index);
        // Adjust Y position to account for header offset
        const adjustedY = (this._headerHeight || CONTENT_PADDING + this.lineHeight() + ROW_SPACING * 2) + rect.y;
        this.drawCombinationRow(combination, rect.x, adjustedY, rect.width);
    };

    Window_CabbyCodesCookbook.prototype.maxVisibleItems = function() {
        const lineHeight = this.itemHeight() + this.rowSpacing();
        const headerHeight = this._headerHeight || (CONTENT_PADDING + this.lineHeight() + ROW_SPACING * 2);
        const footerHeight = FOOTER_TEXT ? this.lineHeight() + ROW_SPACING : 0;
        const availableHeight = this.contentsHeight() - headerHeight - footerHeight - CONTENT_PADDING;
        return Math.max(1, Math.floor(availableHeight / lineHeight));
    };

    Window_CabbyCodesCookbook.prototype.topIndex = function() {
        return Math.max(0, Math.floor((this._scrollY || 0) / (this.itemHeight() + this.rowSpacing())));
    };

    Window_CabbyCodesCookbook.prototype.contentsHeight = function() {
        const lineHeight = this.lineHeight();
        const headerHeight = lineHeight + ROW_SPACING * 2;
        const footerHeight = FOOTER_TEXT ? lineHeight + ROW_SPACING : 0;
        const combinationsLength = (this._combinations && Array.isArray(this._combinations)) ? this._combinations.length : 0;
        const listHeight = combinationsLength * (ROW_HEIGHT + ROW_SPACING);
        return headerHeight + listHeight + footerHeight + CONTENT_PADDING * 2;
    };

    Window_CabbyCodesCookbook.prototype.processWheelScroll = function() {
        if (this.isOpenAndActive() && TouchInput.wheelY !== 0) {
            const threshold = 3;
            const scrollAmount = Math.floor(Math.abs(TouchInput.wheelY) / threshold);
            if (TouchInput.wheelY > 0) {
                for (let i = 0; i < scrollAmount; i++) {
                    this.scrollDown();
                }
            } else {
                for (let i = 0; i < scrollAmount; i++) {
                    this.scrollUp();
                }
            }
        }
    };

    Window_CabbyCodesCookbook.prototype.scrollDown = function() {
        const maxScroll = Math.max(0, this.maxItems() - this.maxVisibleItems());
        const currentTop = this.topIndex();
        if (currentTop < maxScroll) {
            this._scrollY = (this._scrollY || 0) + (this.itemHeight() + this.rowSpacing());
            this.paint();
        }
    };

    Window_CabbyCodesCookbook.prototype.scrollUp = function() {
        const currentTop = this.topIndex();
        if (currentTop > 0) {
            this._scrollY = Math.max(0, (this._scrollY || 0) - (this.itemHeight() + this.rowSpacing()));
            this.paint();
        }
    };

    Window_CabbyCodesCookbook.prototype.isOpenAndActive = function() {
        return this.isOpen() && this.active;
    };

    Window_CabbyCodesCookbook.prototype.drawHeader = function(top, usableWidth) {
        const lineHeight = this.lineHeight();
        const combinationsLength = (this._combinations && Array.isArray(this._combinations)) ? this._combinations.length : 0;
        const countText = `${this._discoveredCount || 0} / ${combinationsLength}`;
        
        // Title
        this.changeTextColor(ColorManager.systemColor());
        this.drawText(HEADER_TEXT, CONTENT_PADDING, top, usableWidth / 2, 'left');
        
        // Count
        this.changeTextColor(ColorManager.normalColor());
        this.drawText(countText, CONTENT_PADDING + usableWidth / 2, top, usableWidth / 2, 'right');
        
        return lineHeight;
    };

    Window_CabbyCodesCookbook.prototype.drawCombinationRow = function(combination, x, y, width) {
        if (!this._listOffsetY) {
            this._listOffsetY = CONTENT_PADDING + this.lineHeight() + ROW_SPACING * 2;
        }
        
        const checkboxX = x + CONTENT_PADDING;
        const lineHeight = this.itemHeight();
        // Better vertical alignment: center checkbox with text baseline
        const textBaseline = y + Math.floor((lineHeight - this.lineHeight()) / 2) + this.lineHeight() - 2;
        const checkboxY = textBaseline - CHECKBOX_SIZE / 2;
        const nameX = checkboxX + CHECKBOX_SIZE + CHECKBOX_PADDING * 2;
        const nameWidth = width - CHECKBOX_SIZE - CHECKBOX_PADDING * 3 - CONTENT_PADDING;

        // Draw checkbox
        this.drawCheckbox(checkboxX, checkboxY, combination.discovered);

        // Draw combination name/result
        const combinationText = combination.secondaryId
            ? `${combination.primaryName} + ${combination.secondaryName} -> ${combination.resultName}`
            : `${combination.primaryName} (solo) -> ${combination.resultName}`;
        this.changeTextColor(
            combination.discovered 
                ? ColorManager.normalColor() 
                : ColorManager.textColor(6)
        );
        this.drawText(combinationText, nameX, y, nameWidth, 'left');
    };

    Window_CabbyCodesCookbook.prototype.drawCheckbox = function(x, y, checked) {
        const size = CHECKBOX_SIZE;
        const borderWidth = 2;
        
        // Draw checkbox background
        this.contents.fillRect(
            x, 
            y, 
            size, 
            size, 
            checked ? CHECKBOX_CHECKED_COLOR : CHECKBOX_UNCHECKED_COLOR
        );
        
        // Draw border
        this.contents.fillRect(x, y, size, borderWidth, CHECKBOX_BORDER_COLOR);
        this.contents.fillRect(x, y, borderWidth, size, CHECKBOX_BORDER_COLOR);
        this.contents.fillRect(x + size - borderWidth, y, borderWidth, size, CHECKBOX_BORDER_COLOR);
        this.contents.fillRect(x, y + size - borderWidth, size, borderWidth, CHECKBOX_BORDER_COLOR);
        
        // Draw checkmark if checked
        if (checked) {
            this.drawCheckmark(x, y, size);
        }
    };

    Window_CabbyCodesCookbook.prototype.drawCheckmark = function(x, y, size) {
        const checkColor = '#000000';
        const lineWidth = 2.5;
        const padding = 4;
        
        // Draw checkmark as a simple V shape using two lines
        // Start point: bottom-left
        const startX = x + padding;
        const startY = y + size - padding;
        // Mid point: center
        const midX = x + size / 2;
        const midY = y + size / 2 + 1;
        // End point: top-right
        const endX = x + size - padding;
        const endY = y + padding;
        
        // Draw left leg (bottom-left to center)
        this.drawThickLine(startX, startY, midX, midY, lineWidth, checkColor);
        
        // Draw right leg (center to top-right)
        this.drawThickLine(midX, midY, endX, endY, lineWidth, checkColor);
    };
    
    Window_CabbyCodesCookbook.prototype.drawThickLine = function(x1, y1, x2, y2, thickness, color) {
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
        this.createCookbookWindow();
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

    Scene_CabbyCodesCookbook.prototype.createCookbookWindow = function() {
        const rect = this.cookbookWindowRect();
        this._cookbookWindow = new Window_CabbyCodesCookbook(rect);
        this.addWindow(this._cookbookWindow);
    };

    Scene_CabbyCodesCookbook.prototype.cookbookWindowRect = function() {
        const ww = Math.min(WINDOW_WIDTH, Graphics.boxWidth - 48);
        const padding = typeof Window_Base !== 'undefined' &&
            typeof Window_Base.prototype.standardPadding === 'function'
            ? Window_Base.prototype.standardPadding.call(Window_Base.prototype)
            : 12;
        
        const lineHeight = typeof Window_Base !== 'undefined' &&
            typeof Window_Base.prototype.lineHeight === 'function'
            ? Window_Base.prototype.lineHeight.call(Window_Base.prototype)
            : 36;
        
        // Fixed window height for scrolling - large enough to show many items
        const headerHeight = lineHeight + ROW_SPACING * 2;
        const footerHeight = FOOTER_TEXT ? lineHeight + ROW_SPACING : 0;
        const listHeight = Graphics.boxHeight - 200; // Fixed scrollable area
        const contentHeight = headerHeight + listHeight + footerHeight + CONTENT_PADDING * 2;
        
        const wh = Math.min(contentHeight + padding * 2, Graphics.boxHeight - 48);
        const wx = (Graphics.boxWidth - ww) / 2;
        const wy = (Graphics.boxHeight - wh) / 2;
        return new Rectangle(wx, wy, ww, wh);
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

