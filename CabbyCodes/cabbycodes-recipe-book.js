//=============================================================================
// CabbyCodes Recipe Book
//=============================================================================
/*:
 * @target MZ
 * @plugindesc CabbyCodes Recipe Book - Press-to-open recipe book showing all crafting recipes
 * @author CabbyCodes
 * @help
 * Adds a "Press" option to the CabbyCodes section of the Options menu that
 * instantly opens a recipe book showing all discovered crafting recipes with checkboxes.
 * Shows count of discovered recipes over total recipes.
 * Press OK/Cancel to exit the window and return to the game.
 */

(() => {
    'use strict';

    if (typeof window.CabbyCodes === 'undefined') {
        console.warn('[CabbyCodes] Recipe Book requires the core module.');
        return;
    }

    const moduleApi = (CabbyCodes.recipeBook = CabbyCodes.recipeBook || {});
    const bookUi = CabbyCodes.bookUi || null;
    const bookUiDefaults = (bookUi && bookUi.defaults) || {};
    const settingKey = 'recipeBook';

    // Recipe IDs are 551-600 (50 recipes total)
    const RECIPE_MIN_ID = 551;
    const RECIPE_MAX_ID = 600;
    const TOTAL_RECIPES = RECIPE_MAX_ID - RECIPE_MIN_ID + 1;

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
    const HEADER_TEXT = 'Recipe Book';
    const CHECKBOX_SIZE = bookUi?.defaults?.checkboxSize ?? 16;
    const CHECKBOX_PADDING = 4;
    const RECIPE_NAME_OFFSET = CHECKBOX_SIZE + CHECKBOX_PADDING * 2;
    const CONTENT_PADDING = bookUi?.defaults?.contentPadding ?? 12;
    const FOOTER_TEXT = '';
    const ROW_CONTENT_LEFT = Math.max(
        0,
        (bookUi?.defaults?.rowContentLeft ?? 16) - 8
    );
    const ROW_CONTENT_RIGHT = bookUi?.defaults?.rowContentRight ?? 8;
    const RESET_DELAY_MS = 30;
    const COLUMN_GAP = 12;
    const RECIPE_COLUMN_RATIO = 0.45;
    const COLUMN_HEADER_RECIPE_TEXT = 'Recipe';
    const COLUMN_HEADER_INGREDIENTS_TEXT = 'Ingredients';
    const COLUMN_HEADER_LINE_HEIGHT = ROW_HEIGHT;

    // Checkbox colors
    const CHECKBOX_CHECKED_COLOR = '#68ffd1';
    const CHECKBOX_UNCHECKED_COLOR = 'rgba(255, 255, 255, 0.3)';
    const CHECKBOX_BORDER_COLOR = '#ffffff';
    const RECIPE_INGREDIENT_KEYS = ['ing1', 'ing2', 'ing3', 'ing4', 'ing5'];
    const UNKNOWN_INGREDIENT_TEXT = 'Ingredients unknown';

    function columnHeaderPadding() {
        return resolveWindowBasePadding();
    }

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

    CabbyCodes.registerSetting(settingKey, 'Recipe Book', {
        defaultValue: false,
        order: 30,
        formatValue: () => 'Press',
        onChange: newValue => {
            if (!newValue) {
                return;
            }
            openRecipeBookScene();
            scheduleReset();
        }
    });

    moduleApi.settingKey = settingKey;
    moduleApi.openViewer = () => {
        openRecipeBookScene();
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

    function openRecipeBookScene() {
        if (typeof SceneManager === 'undefined' || typeof SceneManager.push !== 'function') {
            CabbyCodes.warn('[CabbyCodes] Recipe Book could not open (SceneManager missing)');
            return;
        }
        if (typeof Scene_CabbyCodesRecipeBook === 'undefined') {
            CabbyCodes.warn('[CabbyCodes] Recipe Book scene is unavailable.');
            return;
        }
        SceneManager.push(Scene_CabbyCodesRecipeBook);
    }

    /**
     * Get all recipe items from the game database
     * @returns {Array<{id: number, name: string, discovered: boolean}>}
     */
    function getAllRecipes() {
        const recipes = [];
        if (typeof $dataItems === 'undefined' || !$dataItems) {
            return recipes;
        }
        
        for (let id = RECIPE_MIN_ID; id <= RECIPE_MAX_ID; id++) {
            const item = $dataItems[id];
            if (item && item.name) {
                const ingredients = getRecipeIngredients(item);
                recipes.push({
                    id: id,
                    name: item.name,
                    discovered: checkRecipe(id),
                    ingredients,
                    combinationText: formatIngredientList(ingredients)
                });
            }
        }
        
        // Sort recipes alphabetically by the resulting item name (case-insensitive)
        recipes.sort((a, b) => {
            const nameCompare = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
            if (nameCompare !== 0) {
                return nameCompare;
            }
            return a.id - b.id;
        });
        
        return recipes;
    }

    function getRecipeIngredients(item) {
        if (!item || !item.meta) {
            return [];
        }
        const ingredients = [];
        for (const key of RECIPE_INGREDIENT_KEYS) {
            if (!Object.prototype.hasOwnProperty.call(item.meta, key)) {
                continue;
            }
            const rawValue = item.meta[key];
            const ingredientId = Number(rawValue);
            if (!Number.isFinite(ingredientId) || ingredientId <= 0) {
                continue;
            }
            ingredients.push({
                id: ingredientId,
                name: resolveItemName(ingredientId)
            });
        }
        return ingredients;
    }

    function resolveItemName(itemId) {
        if (typeof $dataItems === 'undefined' || !$dataItems) {
            return `Item ${itemId}`;
        }
        const item = $dataItems[itemId];
        if (item && item.name) {
            return item.name;
        }
        return `Item ${itemId}`;
    }

    function formatIngredientList(ingredients) {
        if (!Array.isArray(ingredients) || ingredients.length === 0) {
            return UNKNOWN_INGREDIENT_TEXT;
        }
        return ingredients.map(ingredient => ingredient.name).join(' + ');
    }

    /**
     * Check if a recipe is discovered using the game's chkRecipe function
     * @param {number} recipeId
     * @returns {boolean}
     */
    function checkRecipe(recipeId) {
        if (typeof window.chkRecipe === 'function') {
            try {
                return !!window.chkRecipe(recipeId);
            } catch (e) {
                CabbyCodes.warn(`[CabbyCodes] Error checking recipe ${recipeId}:`, e);
                return false;
            }
        }
        // Fallback: try to check variable 441 directly
        if (typeof $gameVariables !== 'undefined' && $gameVariables) {
            const recipeData = $gameVariables.value(441);
            if (Array.isArray(recipeData)) {
                const index = recipeId - RECIPE_MIN_ID;
                return !!recipeData[index];
            }
        }
        return false;
    }

    /**
     * Get discovered recipe count
     * @returns {number}
     */
    function getDiscoveredCount() {
        const recipes = getAllRecipes();
        return recipes.filter(r => r.discovered).length;
    }

    // -- Window implementation -------------------------------------------------

    function Window_CabbyCodesRecipeBook() {
        this.initialize(...arguments);
    }

    window.Window_CabbyCodesRecipeBook = Window_CabbyCodesRecipeBook;

    Window_CabbyCodesRecipeBook.prototype = Object.create(Window_Selectable.prototype);
    Window_CabbyCodesRecipeBook.prototype.constructor = Window_CabbyCodesRecipeBook;

    Window_CabbyCodesRecipeBook.prototype.initialize = function(rect) {
        Window_Selectable.prototype.initialize.call(this, rect);
        this.opacity = 255;
        this._recipes = [];
        this._discoveredCount = 0;
        this._refreshTimer = 0;
        this._headerWindow = null;
        this.deactivate();
        this.refreshPanelBackground();
        this.requestImmediateRefresh();
    };

    Window_CabbyCodesRecipeBook.prototype.refreshPanelBackground = function() {
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

    Window_CabbyCodesRecipeBook.prototype.setHeaderWindow = function(headerWindow) {
        this._headerWindow = headerWindow;
        if (this._headerWindow) {
            this._headerWindow.setListWindow(this);
        }
    };

    Window_CabbyCodesRecipeBook.prototype.headerInfo = function() {
        return {
            discovered: this._discoveredCount || 0,
            total: this._recipes && Array.isArray(this._recipes) ? this._recipes.length : 0
        };
    };

    Window_CabbyCodesRecipeBook.prototype.maxItems = function() {
        if (!this._recipes || !Array.isArray(this._recipes)) {
            return 0;
        }
        return this._recipes.length;
    };

    Window_CabbyCodesRecipeBook.prototype.itemWidth = function() {
        return this.innerWidth - CONTENT_PADDING * 2;
    };

    Window_CabbyCodesRecipeBook.prototype.itemHeight = function() {
        return ROW_HEIGHT;
    };

    Window_CabbyCodesRecipeBook.prototype.maxCols = function() {
        return 1;
    };

    Window_CabbyCodesRecipeBook.prototype.itemRect = function(index) {
        const rect = Window_Selectable.prototype.itemRect.call(this, index);
        rect.x = 0;
        rect.width = this.contentsWidth();
        return rect;
    };

    Window_CabbyCodesRecipeBook.prototype.colSpacing = function() {
        return 0;
    };

    Window_CabbyCodesRecipeBook.prototype.rowSpacing = function() {
        return ROW_SPACING;
    };

    Window_CabbyCodesRecipeBook.prototype.update = function() {
        Window_Selectable.prototype.update.call(this);
        
        // Ensure cursor is visible with smooth scrolling
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

    Window_CabbyCodesRecipeBook.prototype.refreshIfNeeded = function(force) {
        const recipes = getAllRecipes();
        const discoveredCount = recipes.filter(r => r.discovered).length;
        
        if (!force && 
            this._discoveredCount === discoveredCount &&
            recipesEqual(this._recipes, recipes)) {
            return;
        }
        
        this._recipes = recipes;
        this._discoveredCount = discoveredCount;
        this.paint();
        if (this._headerWindow) {
            this._headerWindow.refresh();
        }
    };

    Window_CabbyCodesRecipeBook.prototype.requestImmediateRefresh = function() {
        this._refreshTimer = 0;
        this._recipes = [];
        this._discoveredCount = -1;
        this.refreshIfNeeded(true);
    };

    function recipesEqual(a, b) {
        if (a.length !== b.length) {
            return false;
        }
        for (let i = 0; i < a.length; i++) {
            if (
                a[i].id !== b[i].id ||
                a[i].discovered !== b[i].discovered ||
                a[i].name !== b[i].name ||
                a[i].combinationText !== b[i].combinationText
            ) {
                return false;
            }
        }
        return true;
    }

    Window_CabbyCodesRecipeBook.prototype.paint = function() {
        if (this.contents) {
            this.resetFontSettings();
            this.contents.clear();
            this.contentsBack.clear();
            this.refreshPanelBackground();
            this.drawAllItems();
        }
    };

    Window_CabbyCodesRecipeBook.prototype.drawAllItems = function() {
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

    Window_CabbyCodesRecipeBook.prototype.drawItemBackground = function(index) {
        const rect = this.itemRect(index);
        this.drawBackgroundRect(rect);
    };

    Window_CabbyCodesRecipeBook.prototype.drawBackgroundRect = function(rect) {
        // Draw a subtle background for each row
        const c1 = ColorManager.itemBackColor1();
        const c2 = ColorManager.itemBackColor2();
        const x = rect.x;
        const y = rect.y;
        const w = rect.width;
        const h = rect.height;
        // Draw on contentsBack which scrolls with contents
        this.contentsBack.gradientFillRect(x, y, w, h, c1, c2, true);
        // Add a subtle border/separator line at the bottom
        this.contentsBack.fillRect(x, y + h - 1, w, 1, 'rgba(255, 255, 255, 0.1)');
    };

    function calculateRecipeColumnLayout(availableWidth) {
        const usableWidth = Math.max(
            0,
            availableWidth - ROW_CONTENT_LEFT - ROW_CONTENT_RIGHT
        );
        const recipeX = ROW_CONTENT_LEFT + CHECKBOX_SIZE + CHECKBOX_PADDING * 2;
        const textWidth = Math.max(0, usableWidth - CHECKBOX_SIZE - CHECKBOX_PADDING * 2);
        const recipeWidth = Math.max(0, Math.floor(textWidth * RECIPE_COLUMN_RATIO));
        const ingredientsX = recipeX + recipeWidth + COLUMN_GAP;
        const ingredientsWidth = Math.max(0, textWidth - recipeWidth - COLUMN_GAP);
        return {
            recipeX,
            recipeWidth,
            ingredientsX,
            ingredientsWidth
        };
    }

    Window_CabbyCodesRecipeBook.prototype.drawItem = function(index) {
        if (!this._recipes || !Array.isArray(this._recipes)) {
            return;
        }
        if (index < 0 || index >= this._recipes.length) {
            return;
        }
        const recipe = this._recipes[index];
        const rect = this.itemRect(index);
        // Use itemRect directly - it already accounts for scrolling
        this.drawRecipeRow(recipe, rect.x, rect.y, rect.width);
    };

    Window_CabbyCodesRecipeBook.prototype.drawRecipeRow = function(recipe, x, y, width) {
        const checkboxX = x + ROW_CONTENT_LEFT;
        const itemHeight = this.itemHeight();
        const lineHeight = this.lineHeight();
        
        // Center checkbox vertically within the row
        const checkboxY = y + Math.floor((itemHeight - CHECKBOX_SIZE) / 2);
        
        const layout = this.columnLayout();
        const recipeX = x + layout.recipeX;
        const recipeWidth = layout.recipeWidth;
        const comboX = x + layout.ingredientsX;
        const comboWidth = layout.ingredientsWidth;
        
        // Center text vertically within the row
        const textY = y + Math.floor((itemHeight - lineHeight) / 2);

        // Draw checkbox
        this.drawCheckbox(checkboxX, checkboxY, recipe.discovered);

        // Draw recipe name
        const nameColor = recipe.discovered
            ? ColorManager.normalColor()
            : ColorManager.textColor(6);
        const comboColor = recipe.discovered
            ? ColorManager.systemColor()
            : ColorManager.textColor(6);
        const combinationText = recipe.combinationText || UNKNOWN_INGREDIENT_TEXT;

        this.changeTextColor(nameColor);
        this.drawText(recipe.name, recipeX, textY, recipeWidth, 'left');

        if (comboWidth > 0) {
            this.changeTextColor(comboColor);
            this.drawText(combinationText, comboX, textY, comboWidth, 'left');
        }
    };

    Window_CabbyCodesRecipeBook.prototype.columnLayout = function() {
        return calculateRecipeColumnLayout(this.contentsWidth());
    };

    Window_CabbyCodesRecipeBook.prototype.drawCheckbox = function(x, y, checked) {
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

    Window_CabbyCodesRecipeBook.prototype.drawCheckmark = function(x, y, size) {
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
    
    Window_CabbyCodesRecipeBook.prototype.drawThickLine = function(x1, y1, x2, y2, thickness, color) {
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

    // -- Header window ---------------------------------------------------------

    const RecipeHeaderBase = bookUi && bookUi.BookHeaderWindow ? bookUi.BookHeaderWindow : null;

    let Window_CabbyCodesRecipeBookHeader;

    if (RecipeHeaderBase) {
        Window_CabbyCodesRecipeBookHeader = function(rect) {
            RecipeHeaderBase.call(this, rect, {
                title: HEADER_TEXT,
                contentPadding: CONTENT_PADDING
            });
        };
        Window_CabbyCodesRecipeBookHeader.prototype = Object.create(RecipeHeaderBase.prototype);
        Window_CabbyCodesRecipeBookHeader.prototype.constructor = Window_CabbyCodesRecipeBookHeader;
    } else {
        Window_CabbyCodesRecipeBookHeader = function() {
            this.initialize(...arguments);
        };

        const FALLBACK_HEADER_GREEN = '#2edf87';

        function recipeIncompleteHeaderColor() {
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
                        // Ignore and use fallback.
                    }
                }
            }
            return FALLBACK_HEADER_GREEN;
        }

        Window_CabbyCodesRecipeBookHeader.prototype = Object.create(Window_Base.prototype);
        Window_CabbyCodesRecipeBookHeader.prototype.constructor = Window_CabbyCodesRecipeBookHeader;

        Window_CabbyCodesRecipeBookHeader.prototype.initialize = function(rect) {
            Window_Base.prototype.initialize.call(this, rect);
            this.opacity = 255;
            this._listWindow = null;
            this.padding = this.standardPadding();
            this.refreshBackground();
            this.refresh();
        };

        Window_CabbyCodesRecipeBookHeader.prototype.setListWindow = function(listWindow) {
            this._listWindow = listWindow;
            this.refresh();
        };

        Window_CabbyCodesRecipeBookHeader.prototype.refreshBackground = function() {
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

        Window_CabbyCodesRecipeBookHeader.prototype.refresh = function() {
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
                ? recipeIncompleteHeaderColor()
                : ColorManager?.systemColor?.() || '#FFFFFF';
            const countColor = isIncomplete
                ? accentColor
                : ColorManager?.normalColor?.() || '#FFFFFF';
            const usableWidth = this.contentsWidth() - CONTENT_PADDING * 2;
            const top = Math.max(0, Math.floor((this.contentsHeight() - this.lineHeight()) / 2));

            this.changeTextColor(accentColor);
            this.drawText(HEADER_TEXT, CONTENT_PADDING, top, usableWidth / 2, 'left');

            this.changeTextColor(countColor);
            const countText = `${info.discovered || 0} / ${info.total || 0}`;
            this.drawText(countText, CONTENT_PADDING + usableWidth / 2, top, usableWidth / 2, 'right');
        };

        Window_CabbyCodesRecipeBookHeader.prototype.standardPadding = function() {
            return 8;
        };

        Window_CabbyCodesRecipeBookHeader.prototype.updatePadding = function() {
            this.padding = this.standardPadding();
        };
    }

    window.Window_CabbyCodesRecipeBookHeader = Window_CabbyCodesRecipeBookHeader;

    function Window_CabbyCodesRecipeBookColumns() {
        this.initialize(...arguments);
    }

    window.Window_CabbyCodesRecipeBookColumns = Window_CabbyCodesRecipeBookColumns;

    Window_CabbyCodesRecipeBookColumns.prototype = Object.create(Window_Base.prototype);
    Window_CabbyCodesRecipeBookColumns.prototype.constructor = Window_CabbyCodesRecipeBookColumns;

    Window_CabbyCodesRecipeBookColumns.prototype.initialize = function(rect) {
        Window_Base.prototype.initialize.call(this, rect);
        this.opacity = 255;
        this.padding = this.standardPadding();
        this.refreshBackground();
        this.refresh();
    };

    Window_CabbyCodesRecipeBookColumns.prototype.standardPadding = function() {
        return columnHeaderPadding();
    };

    Window_CabbyCodesRecipeBookColumns.prototype.lineHeight = function() {
        return COLUMN_HEADER_LINE_HEIGHT;
    };

    Window_CabbyCodesRecipeBookColumns.prototype.refreshBackground = function() {
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

    Window_CabbyCodesRecipeBookColumns.prototype.refresh = function() {
        if (!this.contents) {
            this.createContents();
        }
        this.resetFontSettings();
        this.contents.clear();
        this.refreshBackground();

        const layout = calculateRecipeColumnLayout(this.contentsWidth());
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

    // -- Scene implementation --------------------------------------------------

    function Scene_CabbyCodesRecipeBook() {
        this.initialize(...arguments);
    }

    window.Scene_CabbyCodesRecipeBook = Scene_CabbyCodesRecipeBook;

    Scene_CabbyCodesRecipeBook.prototype = Object.create(Scene_MenuBase.prototype);
    Scene_CabbyCodesRecipeBook.prototype.constructor = Scene_CabbyCodesRecipeBook;

    Scene_CabbyCodesRecipeBook.prototype.initialize = function() {
        Scene_MenuBase.prototype.initialize.call(this);
    };

    Scene_CabbyCodesRecipeBook.prototype.create = function() {
        Scene_MenuBase.prototype.create.call(this);
        this.createRecipeHeaderWindow();
        this.createRecipeColumnHeaderWindow();
        this.createRecipeListWindow();
    };

    Scene_CabbyCodesRecipeBook.prototype.update = function() {
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

    Scene_CabbyCodesRecipeBook.prototype.createRecipeHeaderWindow = function() {
        const rect = this.recipeHeaderWindowRect();
        this._recipeHeaderWindow = new Window_CabbyCodesRecipeBookHeader(rect);
        this.addWindow(this._recipeHeaderWindow);
    };

    Scene_CabbyCodesRecipeBook.prototype.createRecipeColumnHeaderWindow = function() {
        const rect = this.recipeColumnHeaderWindowRect();
        this._recipeColumnHeaderWindow = new Window_CabbyCodesRecipeBookColumns(rect);
        this.addWindow(this._recipeColumnHeaderWindow);
    };

    Scene_CabbyCodesRecipeBook.prototype.createRecipeListWindow = function() {
        const rect = this.recipeListWindowRect();
        this._recipeBookWindow = new Window_CabbyCodesRecipeBook(rect);
        this._recipeBookWindow.setHeaderWindow(this._recipeHeaderWindow);
        this.addWindow(this._recipeBookWindow);
    };

    Scene_CabbyCodesRecipeBook.prototype.recipeHeaderWindowRect = function() {
        const layout = this.layoutInfo();
        return new Rectangle(layout.wx, layout.headerY, layout.ww, layout.headerHeight);
    };

    Scene_CabbyCodesRecipeBook.prototype.recipeColumnHeaderWindowRect = function() {
        const layout = this.layoutInfo();
        return new Rectangle(layout.wx, layout.columnY, layout.ww, layout.columnHeight);
    };

    Scene_CabbyCodesRecipeBook.prototype.recipeListWindowRect = function() {
        const layout = this.layoutInfo();
        return new Rectangle(layout.wx, layout.listY, layout.ww, layout.listHeight);
    };

    Scene_CabbyCodesRecipeBook.prototype.layoutInfo = function() {
        if (this._recipeLayout) {
            return this._recipeLayout;
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
        this._recipeLayout = {
            ww,
            headerHeight,
            columnHeight,
            listHeight,
            headerY,
            columnY,
            listY,
            wx
        };
        return this._recipeLayout;
    };

    Scene_CabbyCodesRecipeBook.prototype.windowGap = function() {
        return 0;
    };

    Scene_CabbyCodesRecipeBook.prototype.columnHeaderWindowHeight = function() {
        const padding = columnHeaderPadding();
        return COLUMN_HEADER_LINE_HEIGHT + padding * 2;
    };

    Scene_CabbyCodesRecipeBook.prototype.headerWindowHeight = function() {
        const lineHeight = typeof Window_Base !== 'undefined' &&
            typeof Window_Base.prototype.lineHeight === 'function'
            ? Window_Base.prototype.lineHeight.call(Window_Base.prototype)
            : 36;
        return lineHeight + CONTENT_PADDING;
    };

    Scene_CabbyCodesRecipeBook.prototype.listWindowHeight = function(occupiedHeightAboveList) {
        const padding = this.standardPadding();
        const maxRows = Math.max(6, Math.floor((Graphics.boxHeight - 200) / (ROW_HEIGHT + ROW_SPACING)));
        const listAreaHeight = maxRows * (ROW_HEIGHT + ROW_SPACING) + CONTENT_PADDING * 2;
        const desiredHeight = listAreaHeight + padding * 2;
        const maxAvailable = Graphics.boxHeight - 48 - occupiedHeightAboveList;
        return Math.max(padding * 2 + ROW_HEIGHT * 2, Math.min(desiredHeight, maxAvailable));
    };

    Scene_CabbyCodesRecipeBook.prototype.standardPadding = function() {
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

    CabbyCodes.log('[CabbyCodes] Recipe Book initialized');
})();

