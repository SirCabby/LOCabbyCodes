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
    const settingKey = 'recipeBook';

    // Recipe IDs are 551-600 (50 recipes total)
    const RECIPE_MIN_ID = 551;
    const RECIPE_MAX_ID = 600;
    const TOTAL_RECIPES = RECIPE_MAX_ID - RECIPE_MIN_ID + 1;

    // Window constants
    const WINDOW_WIDTH = 640;
    const ROW_HEIGHT = 24;  // Tight vertical spacing
    const ROW_SPACING = 2;
    const REFRESH_INTERVAL_FRAMES = 30;
    const HEADER_TEXT = 'Recipe Book';
    const CHECKBOX_SIZE = 16;
    const CHECKBOX_PADDING = 4;
    const RECIPE_NAME_OFFSET = CHECKBOX_SIZE + CHECKBOX_PADDING * 2;
    const CONTENT_PADDING = 12;
    const FOOTER_TEXT = '';
    const ROW_LEFT_PADDING = 16;
    const ROW_RIGHT_PADDING = 8;
    const RESET_DELAY_MS = 30;

    // Checkbox colors
    const CHECKBOX_CHECKED_COLOR = '#68ffd1';
    const CHECKBOX_UNCHECKED_COLOR = 'rgba(255, 255, 255, 0.3)';
    const CHECKBOX_BORDER_COLOR = '#ffffff';

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
                recipes.push({
                    id: id,
                    name: item.name,
                    discovered: checkRecipe(id)
                });
            }
        }
        
        // Sort recipes alphabetically by name
        recipes.sort((a, b) => {
            return a.name.localeCompare(b.name);
        });
        
        return recipes;
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
            if (a[i].id !== b[i].id || a[i].discovered !== b[i].discovered) {
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
        const checkboxX = x + ROW_LEFT_PADDING;
        const itemHeight = this.itemHeight();
        const lineHeight = this.lineHeight();
        
        // Center checkbox vertically within the row
        const checkboxY = y + Math.floor((itemHeight - CHECKBOX_SIZE) / 2);
        
        // Position text to align with checkbox center
        const contentWidth = width - ROW_LEFT_PADDING - ROW_RIGHT_PADDING;
        const nameX = checkboxX + CHECKBOX_SIZE + CHECKBOX_PADDING * 2;
        const nameWidth = Math.max(0, contentWidth - CHECKBOX_SIZE - CHECKBOX_PADDING * 2);
        
        // Center text vertically within the row
        const textY = y + Math.floor((itemHeight - lineHeight) / 2);

        // Draw checkbox
        this.drawCheckbox(checkboxX, checkboxY, recipe.discovered);

        // Draw recipe name
        this.changeTextColor(
            recipe.discovered 
                ? ColorManager.normalColor() 
                : ColorManager.textColor(6)
        );
        this.drawText(recipe.name, nameX, textY, nameWidth, 'left');
    };

    Window_CabbyCodesRecipeBook.prototype.drawCheckbox = function(x, y, checked) {
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

    Window_CabbyCodesRecipeBook.prototype.drawCheckmark = function(x, y, size) {
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
    
    Window_CabbyCodesRecipeBook.prototype.drawThickLine = function(x1, y1, x2, y2, thickness, color) {
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

    function Window_CabbyCodesRecipeBookHeader() {
        this.initialize(...arguments);
    }

    window.Window_CabbyCodesRecipeBookHeader = Window_CabbyCodesRecipeBookHeader;

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
        const usableWidth = this.contentsWidth() - CONTENT_PADDING * 2;
        const top = Math.max(0, Math.floor((this.contentsHeight() - this.lineHeight()) / 2));

        this.changeTextColor(ColorManager.systemColor());
        this.drawText(HEADER_TEXT, CONTENT_PADDING, top, usableWidth / 2, 'left');

        this.changeTextColor(ColorManager.normalColor());
        const countText = `${info.discovered || 0} / ${info.total || 0}`;
        this.drawText(countText, CONTENT_PADDING + usableWidth / 2, top, usableWidth / 2, 'right');
    };

    Window_CabbyCodesRecipeBookHeader.prototype.standardPadding = function() {
        return 8;
    };

    Window_CabbyCodesRecipeBookHeader.prototype.updatePadding = function() {
        this.padding = this.standardPadding();
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

    Scene_CabbyCodesRecipeBook.prototype.recipeListWindowRect = function() {
        const layout = this.layoutInfo();
        return new Rectangle(layout.wx, layout.listY, layout.ww, layout.listHeight);
    };

    Scene_CabbyCodesRecipeBook.prototype.layoutInfo = function() {
        if (this._recipeLayout) {
            return this._recipeLayout;
        }
        const ww = Math.min(WINDOW_WIDTH, Graphics.boxWidth - 48);
        const headerHeight = this.headerWindowHeight();
        const gap = this.windowGap();
        const listHeight = this.listWindowHeight(headerHeight, gap);
        const totalHeight = headerHeight + gap + listHeight;
        const wx = (Graphics.boxWidth - ww) / 2;
        const headerY = Math.max(24, (Graphics.boxHeight - totalHeight) / 2);
        const listY = headerY + headerHeight + gap;
        this._recipeLayout = { ww, headerHeight, listHeight, headerY, listY, wx };
        return this._recipeLayout;
    };

    Scene_CabbyCodesRecipeBook.prototype.windowGap = function() {
        return 6;
    };

    Scene_CabbyCodesRecipeBook.prototype.headerWindowHeight = function() {
        const lineHeight = typeof Window_Base !== 'undefined' &&
            typeof Window_Base.prototype.lineHeight === 'function'
            ? Window_Base.prototype.lineHeight.call(Window_Base.prototype)
            : 36;
        return lineHeight + CONTENT_PADDING;
    };

    Scene_CabbyCodesRecipeBook.prototype.listWindowHeight = function(headerHeight, gap) {
        const padding = this.standardPadding();
        const maxRows = Math.max(6, Math.floor((Graphics.boxHeight - 200) / (ROW_HEIGHT + ROW_SPACING)));
        const listAreaHeight = maxRows * (ROW_HEIGHT + ROW_SPACING) + CONTENT_PADDING * 2;
        const desiredHeight = listAreaHeight + padding * 2;
        const maxAvailable = Graphics.boxHeight - 48 - headerHeight - gap;
        return Math.max(padding * 2 + ROW_HEIGHT * 2, Math.min(desiredHeight, maxAvailable));
    };

    Scene_CabbyCodesRecipeBook.prototype.standardPadding = function() {
        return typeof Window_Base !== 'undefined' &&
            typeof Window_Base.prototype.standardPadding === 'function'
            ? Window_Base.prototype.standardPadding.call(Window_Base.prototype)
            : 12;
    };

    CabbyCodes.log('[CabbyCodes] Recipe Book initialized');
})();

