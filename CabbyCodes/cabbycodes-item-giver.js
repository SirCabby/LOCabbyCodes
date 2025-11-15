//=============================================================================
// CabbyCodes Item Giver
//=============================================================================
/*:
 * @target MZ
 * @plugindesc CabbyCodes Item Giver - Give any item from the game database
 * @author CabbyCodes
 * @help
 * Allows players to open a filtered item selection window to add any item
 * from the game database to their inventory. Accessible from the Options menu.
 */

(() => {
    'use strict';

    // Ensure CabbyCodes namespace exists
    if (typeof window.CabbyCodes === 'undefined') {
        window.CabbyCodes = {};
    }

    /**
     * Collects all valid items from the game database.
     * @returns {Array} Array of item objects with metadata
     */
    function collectAllItems() {
        const items = [];

        // Collect items
        if ($dataItems && Array.isArray($dataItems)) {
            for (let i = 0; i < $dataItems.length; i++) {
                const item = $dataItems[i];
                if (item && DataManager.isItem(item)) {
                    // Skip items without names (these are expected placeholders)
                    if (!item.name || item.name.trim() === '') {
                        continue;
                    }
                    items.push({
                        item: item,
                        type: 'item',
                        id: item.id,
                        name: item.name
                    });
                }
            }
        }

        // Collect weapons
        if ($dataWeapons && Array.isArray($dataWeapons)) {
            for (let i = 0; i < $dataWeapons.length; i++) {
                const weapon = $dataWeapons[i];
                if (weapon && DataManager.isWeapon(weapon)) {
                    // Skip weapons without names (these are expected placeholders)
                    if (!weapon.name || weapon.name.trim() === '') {
                        continue;
                    }
                    items.push({
                        item: weapon,
                        type: 'weapon',
                        id: weapon.id,
                        name: weapon.name
                    });
                }
            }
        }

        // Collect armors
        if ($dataArmors && Array.isArray($dataArmors)) {
            for (let i = 0; i < $dataArmors.length; i++) {
                const armor = $dataArmors[i];
                if (armor && DataManager.isArmor(armor)) {
                    // Skip armors without names (these are expected placeholders)
                    if (!armor.name || armor.name.trim() === '') {
                        continue;
                    }
                    items.push({
                        item: armor,
                        type: 'armor',
                        id: armor.id,
                        name: armor.name
                    });
                }
            }
        }

        // Sort by name
        items.sort((a, b) => {
            if (a.name < b.name) return -1;
            if (a.name > b.name) return 1;
            return 0;
        });

        return items;
    }

    /**
     * Window for filtering items by type and search text
     */
    function Window_CabbyCodesItemGiverFilter() {
        this.initialize(...arguments);
    }

    window.Window_CabbyCodesItemGiverFilter = Window_CabbyCodesItemGiverFilter;

    Window_CabbyCodesItemGiverFilter.prototype = Object.create(Window_HorzCommand.prototype);
    Window_CabbyCodesItemGiverFilter.prototype.constructor = Window_CabbyCodesItemGiverFilter;

    Window_CabbyCodesItemGiverFilter.prototype.initialize = function(rect) {
        Window_HorzCommand.prototype.initialize.call(this, rect);
        this._searchText = '';
        this._category = 'all';
    };

    Window_CabbyCodesItemGiverFilter.prototype.maxCols = function() {
        return 4;
    };

    Window_CabbyCodesItemGiverFilter.prototype.makeCommandList = function() {
        this.addCommand('All Items', 'all');
        this.addCommand('Items', 'item');
        this.addCommand('Weapons', 'weapon');
        this.addCommand('Armors', 'armor');
    };

    Window_CabbyCodesItemGiverFilter.prototype.setCategory = function(category) {
        if (this._category !== category) {
            this._category = category;
            this.refresh();
            if (this._itemWindow) {
                this._itemWindow.setFilters(this._category, this._searchText);
            }
        }
    };

    Window_CabbyCodesItemGiverFilter.prototype.setSearchText = function(text) {
        if (this._searchText !== text) {
            this._searchText = text;
            if (this._itemWindow) {
                this._itemWindow.setFilters(this._category, this._searchText);
            }
        }
    };

    Window_CabbyCodesItemGiverFilter.prototype.category = function() {
        return this._category;
    };

    Window_CabbyCodesItemGiverFilter.prototype.searchText = function() {
        return this._searchText;
    };

    Window_CabbyCodesItemGiverFilter.prototype.setItemWindow = function(itemWindow) {
        this._itemWindow = itemWindow;
    };

    Window_CabbyCodesItemGiverFilter.prototype.processOk = function() {
        const symbol = this.commandSymbol(this.index());
        this.setCategory(symbol);
        this._itemWindow.activate();
    };

    Window_CabbyCodesItemGiverFilter.prototype.processCancel = function() {
        // Don't allow cancel from filter window
    };

    /**
     * Window for displaying and selecting items
     */
    function Window_CabbyCodesItemGiverList() {
        this.initialize(...arguments);
    }

    window.Window_CabbyCodesItemGiverList = Window_CabbyCodesItemGiverList;

    Window_CabbyCodesItemGiverList.prototype = Object.create(Window_Selectable.prototype);
    Window_CabbyCodesItemGiverList.prototype.constructor = Window_CabbyCodesItemGiverList;

    Window_CabbyCodesItemGiverList.prototype.initialize = function(rect) {
        Window_Selectable.prototype.initialize.call(this, rect);
        this._allItems = [];
        this._data = [];
        this._category = 'all';
        this._searchText = '';
        this.loadItems();
    };

    Window_CabbyCodesItemGiverList.prototype.loadItems = function() {
        try {
            this._allItems = collectAllItems();
            this.refresh();
        } catch (e) {
            CabbyCodes.error(`[CabbyCodes] Failed to load items: ${e?.message || e}`);
            this._allItems = [];
            this._data = [];
        }
    };

    Window_CabbyCodesItemGiverList.prototype.setFilters = function(category, searchText) {
        this._category = category;
        this._searchText = searchText || '';
        this.refresh();
        this.scrollTo(0, 0);
    };

    Window_CabbyCodesItemGiverList.prototype.maxCols = function() {
        return 1;
    };

    Window_CabbyCodesItemGiverList.prototype.maxItems = function() {
        return this._data ? this._data.length : 0;
    };

    Window_CabbyCodesItemGiverList.prototype.item = function() {
        return this.itemAt(this.index());
    };

    Window_CabbyCodesItemGiverList.prototype.itemAt = function(index) {
        return this._data && index >= 0 && index < this._data.length ? this._data[index] : null;
    };

    Window_CabbyCodesItemGiverList.prototype.makeItemList = function() {
        this._data = this._allItems.filter(itemData => {
            // Filter by category
            if (this._category === 'item') {
                if (itemData.type !== 'item') return false;
            } else if (this._category === 'weapon') {
                if (itemData.type !== 'weapon') return false;
            } else if (this._category === 'armor') {
                if (itemData.type !== 'armor') return false;
            }
            // else 'all' - no category filter

            // Filter by search text
            if (this._searchText && this._searchText.trim() !== '') {
                const searchLower = this._searchText.toLowerCase();
                if (!itemData.name.toLowerCase().includes(searchLower)) {
                    return false;
                }
            }

            return true;
        });
    };

    Window_CabbyCodesItemGiverList.prototype.drawItem = function(index) {
        try {
            const itemData = this.itemAt(index);
            if (!itemData) {
                return;
            }
            
            if (!itemData.item) {
                CabbyCodes.warn('[CabbyCodes] Item Giver: itemData.item is null/undefined at index ' + index);
                return;
            }
            
            if (!itemData.type) {
                CabbyCodes.warn('[CabbyCodes] Item Giver: itemData.type is null/undefined at index ' + index);
                return;
            }
            
            const rect = this.itemLineRect(index);
            const item = itemData.item;
            const typeText = itemData.type.charAt(0).toUpperCase() + itemData.type.slice(1);
            const typeWidth = this.textWidth(typeText);
            const padding = 12; // Space between name and type
            const nameWidth = rect.width - typeWidth - padding;
            
            this.changePaintOpacity(true);
            // Draw item name (icon + text) - drawItemName handles both
            if (typeof this.drawItemName === 'function') {
                this.drawItemName(item, rect.x, rect.y, nameWidth);
            } else {
                CabbyCodes.warn('[CabbyCodes] Item Giver: drawItemName is not a function');
            }
            
            // Draw type indicator on the far right with padding
            this.changeTextColor(this.systemColor());
            this.drawText(typeText, rect.x, rect.y, rect.width, 'right');
            this.resetTextColor();
        } catch (e) {
            CabbyCodes.error('[CabbyCodes] Item Giver: Error drawing item at index ' + index + ': ' + (e?.message || e));
            CabbyCodes.error('[CabbyCodes] Item Giver: Stack: ' + (e?.stack || 'No stack trace'));
            // Don't throw - just skip drawing this item
        }
    };

    Window_CabbyCodesItemGiverList.prototype.updateHelp = function() {
        try {
            const itemData = this.item();
            CabbyCodes.log('[CabbyCodes] Item Giver: updateHelp called, itemData: ' + (itemData ? itemData.name : 'null'));
            // Update description window (not header window)
            if (this._scene) {
                if (itemData && itemData.item) {
                    const description = itemData.item.description || '';
                    CabbyCodes.log('[CabbyCodes] Item Giver: Item description: ' + (description ? description.substring(0, 50) + '...' : 'empty'));
                    // Use scene's update method to resize window dynamically
                    this._scene.updateDescriptionWindow(description);
                } else {
                    CabbyCodes.log('[CabbyCodes] Item Giver: No item data, clearing description');
                    this._scene.updateDescriptionWindow('');
                }
            } else {
                CabbyCodes.warn('[CabbyCodes] Item Giver: Scene is null in updateHelp');
            }
        } catch (e) {
            CabbyCodes.error('[CabbyCodes] Item Giver: Error updating help: ' + (e?.message || e));
            CabbyCodes.error('[CabbyCodes] Item Giver: Stack: ' + (e?.stack || 'No stack trace'));
            // Don't throw - help just won't update
        }
    };
    
    Window_CabbyCodesItemGiverList.prototype.setScene = function(scene) {
        this._scene = scene;
    };
    
    Window_CabbyCodesItemGiverList.prototype.setDescriptionWindow = function(descriptionWindow) {
        this._descriptionWindow = descriptionWindow;
        // Reuse base help-window mechanism to ensure callUpdateHelp triggers.
        this._helpWindow = descriptionWindow;
    };
    
    Window_CabbyCodesItemGiverList.prototype.update = function() {
        Window_Selectable.prototype.update.call(this);
        // Call updateHelp when cursor moves
        this.callUpdateHelp();
    };

    Window_CabbyCodesItemGiverList.prototype.setHelpWindow = function(helpWindow) {
        this._helpWindow = helpWindow;
    };

    Window_CabbyCodesItemGiverList.prototype.setSearchWindow = function(searchWindow) {
        this._searchWindow = searchWindow;
    };

    Window_CabbyCodesItemGiverList.prototype.update = function() {
        try {
            Window_Selectable.prototype.update.call(this);
        } catch (e) {
            CabbyCodes.error('[CabbyCodes] Item Giver: Error in base window update: ' + (e?.message || e));
            CabbyCodes.error('[CabbyCodes] Item Giver: Stack: ' + (e?.stack || 'No stack trace'));
            return; // Don't continue if base update fails
        }
        
        try {
            if (this.active && this._searchWindow) {
                // Update search text from search window
                if (typeof this._searchWindow.searchText === 'function') {
                    const searchText = this._searchWindow.searchText();
                    if (searchText !== this._searchText) {
                        this._searchText = searchText;
                        this.refresh();
                    }
                } else {
                    CabbyCodes.warn('[CabbyCodes] Item Giver: _searchWindow.searchText is not a function');
                }
            }
        } catch (e) {
            CabbyCodes.error('[CabbyCodes] Item Giver: Error updating search text in item window: ' + (e?.message || e));
            CabbyCodes.error('[CabbyCodes] Item Giver: Stack: ' + (e?.stack || 'No stack trace'));
            // Don't throw - continue with normal window behavior
        }
    };

    Window_CabbyCodesItemGiverList.prototype.refresh = function() {
        try {
            this.makeItemList();
        } catch (e) {
            CabbyCodes.error('[CabbyCodes] Item Giver: Error making item list: ' + (e?.message || e));
            CabbyCodes.error('[CabbyCodes] Item Giver: Stack: ' + (e?.stack || 'No stack trace'));
            this._data = []; // Set empty list on error
        }
        
        try {
            Window_Selectable.prototype.refresh.call(this);
        } catch (e) {
            CabbyCodes.error('[CabbyCodes] Item Giver: Error in base window refresh: ' + (e?.message || e));
            CabbyCodes.error('[CabbyCodes] Item Giver: Stack: ' + (e?.stack || 'No stack trace'));
            // Don't throw - window will just not refresh
        }
    };

    /**
     * Quantity input window for item giver
     */
    function Window_CabbyCodesItemQuantity() {
        this.initialize(...arguments);
    }

    window.Window_CabbyCodesItemQuantity = Window_CabbyCodesItemQuantity;

    Window_CabbyCodesItemQuantity.prototype = Object.create(Window_Selectable.prototype);
    Window_CabbyCodesItemQuantity.prototype.constructor = Window_CabbyCodesItemQuantity;

    Window_CabbyCodesItemQuantity.prototype.initialize = function(rect, itemData, initialValue) {
        Window_Selectable.prototype.initialize.call(this, rect);
        this._itemData = itemData;
        this._min = 1;
        // Use Game_Party's maxItems if available, otherwise default to 99
        this._max = (typeof $gameParty !== 'undefined' && typeof $gameParty.maxItems === 'function') 
            ? $gameParty.maxItems(this._itemData ? this._itemData.item : null) 
            : 99;
        this._value = Math.max(this._min, Math.min(this._max, initialValue || 1));
        // Ensure text buffer is always a valid string
        this._textBuffer = String(this._value || this._min);
        this._cursorIndex = this._textBuffer.length; // Cursor at end
        this._cursorCount = 0; // For cursor blinking
        this._boundKeyHandler = this.onKeyDown.bind(this);
        window.addEventListener('keydown', this._boundKeyHandler, true);
        // Force initial refresh to ensure text is drawn
        this.refresh();
    };

    Window_CabbyCodesItemQuantity.prototype.destroy = function(options) {
        window.removeEventListener('keydown', this._boundKeyHandler, true);
        Window_Selectable.prototype.destroy.call(this, options);
    };

    Window_CabbyCodesItemQuantity.prototype.maxItems = function() {
        return 1;
    };

    Window_CabbyCodesItemQuantity.prototype.itemHeight = function() {
        return this.lineHeight();
    };

    Window_CabbyCodesItemQuantity.prototype.drawItem = function(index) {
        if (index !== 0) {
            return;
        }
        try {
            const rect = this.itemLineRect(index);
            const item = this._itemData.item;
            
            // Allow empty text buffer - don't force initialization
            // Only initialize if it's truly null/undefined, not if it's empty string
            if (this._textBuffer === null || this._textBuffer === undefined) {
                this._textBuffer = String(this._min);
                this._value = this._min;
                this._cursorIndex = this._textBuffer.length;
            } else if (this._textBuffer === '') {
                // Empty string is allowed - don't force a value
                this._cursorIndex = this._cursorIndex || 0;
            }
            
            // Simplify layout: Item name on left, value on right (aligned to right edge)
            const currentValueText = this._textBuffer || String(this._value);
            const valueTextWidth = this.textWidth(currentValueText || '99'); // Use max width for layout
            const padding = 8;
            const cursorSpace = 4;
            const valueAreaWidth = Math.max(60, valueTextWidth + cursorSpace + 20);
            
            // Draw item name on the left
            const nameWidth = rect.width - valueAreaWidth - padding;
            if (nameWidth > 50) {
                this.drawItemName(item, rect.x, rect.y, nameWidth);
            }
            
            // Draw value on the right side, aligned to the right edge of the window
            const valueX = rect.x + rect.width - valueAreaWidth;
            this.drawEditableValue(valueX, rect.y, valueAreaWidth);
        } catch (e) {
            CabbyCodes.error('[CabbyCodes] Item Giver: Error drawing quantity item: ' + (e?.message || e));
            CabbyCodes.error('[CabbyCodes] Item Giver: Stack: ' + (e?.stack || 'No stack trace'));
        }
    };
    
    Window_CabbyCodesItemQuantity.prototype.drawEditableValue = function(x, y, width) {
        // Allow empty text buffer - don't force a value, let user type from scratch
        // Display empty string if buffer is empty, don't force minimum
        const displayText = (this._textBuffer !== null && this._textBuffer !== undefined && this._textBuffer !== '')
            ? String(this._textBuffer) 
            : '';
        
        // Ensure we have valid contents before drawing
        if (!this.contents) {
            CabbyCodes.warn('[CabbyCodes] Item Giver: Contents is null in drawEditableValue');
            return;
        }
        
        // Reset to normal color and draw the number
        this.resetTextColor();
        this.changeTextColor(ColorManager.normalColor());
        
        // Draw the number text - align to right side of the area
        const actualTextWidth = displayText ? this.textWidth(displayText) : 0;
        const drawWidth = width;
        
        // Draw the text aligned to the right
        this.contents.fontSize = this.contents.fontSize || 28;
        this.drawText(displayText || '', x, y, drawWidth, 'right');
        
        // Debug: Log if text should be visible
        if (displayText && displayText !== '1') {
            CabbyCodes.log('[CabbyCodes] Item Giver: Drawing value "' + displayText + '" at x=' + x + ', y=' + y + ', width=' + drawWidth);
        }
        
        // Draw cursor (flashing)
        this._cursorCount = (this._cursorCount || 0) + 1;
        const cursorVisible = Math.floor(this._cursorCount / 30) % 2 === 0; // Blink every 30 frames
        
            if (cursorVisible && this.active) {
            // Calculate cursor position - align to right
            let cursorX = x + width; // Start at right edge
            if (displayText && displayText !== '' && this._cursorIndex > 0 && this._cursorIndex <= displayText.length) {
                // Calculate text width before cursor
                const textBeforeCursor = displayText.substring(0, this._cursorIndex);
                const textBeforeWidth = this.textWidth(textBeforeCursor);
                const fullTextWidth = this.textWidth(displayText);
                // Position cursor from right edge
                cursorX = x + width - fullTextWidth + textBeforeWidth;
            } else if (!displayText || displayText === '') {
                // If no text, cursor is at the right edge
                cursorX = x + width;
            }
            
            // Draw cursor as a vertical line
            const cursorY = y;
            const cursorHeight = this.lineHeight() - 4;
            this.changePaintOpacity(true);
            this.contents.fillRect(cursorX, cursorY + 2, 2, cursorHeight, this.textColor(0));
            this.changePaintOpacity(false);
        }
        
        this.resetTextColor();
    };

    Window_CabbyCodesItemQuantity.prototype.value = function() {
        return this._value;
    };

    Window_CabbyCodesItemQuantity.prototype.processOk = function() {
        this.playOkSound();
        // Final validation before confirming
        this.updateValueFromBuffer();
        
        // Get the requested quantity
        let requestedQuantity = this._value;
        
        // If value is invalid or empty, set to minimum
        if (!requestedQuantity || requestedQuantity < this._min || this._textBuffer === '' || this._textBuffer === null) {
            requestedQuantity = this._min;
        }
        
        // Clamp to max
        requestedQuantity = Math.min(requestedQuantity, this._max);
        
        // Check how many items the player currently has
        const item = this._itemData ? this._itemData.item : null;
        if (item && typeof $gameParty !== 'undefined' && typeof $gameParty.numItems === 'function') {
            const currentCount = $gameParty.numItems(item);
            const maxItems = $gameParty.maxItems(item);
            
            // Calculate how many can actually be added
            const canAdd = Math.max(0, maxItems - currentCount);
            
            // Clamp requested quantity to what can actually be added
            // If user already has max, canAdd will be 0, so actualQuantity will be 0
            const actualQuantity = Math.min(requestedQuantity, canAdd);
            
            // Update the value to what will actually be given
            this._value = actualQuantity;
        } else {
            // Fallback if game party not available
            this._value = Math.max(this._min, Math.min(requestedQuantity, this._max));
        }
        
        // Call the handler - this will be set by the scene
        if (this._okHandler) {
            this._okHandler();
        } else {
            this.callOkHandler();
        }
    };
    
    Window_CabbyCodesItemQuantity.prototype.setOkHandler = function(handler) {
        this._okHandler = handler;
    };
    
    Window_CabbyCodesItemQuantity.prototype.setCancelHandler = function(handler) {
        this._cancelHandler = handler;
    };

    Window_CabbyCodesItemQuantity.prototype.processCancel = function() {
        SoundManager.playCancel();
        this.deactivate();
        // Call the handler - this will be set by the scene
        if (this._cancelHandler) {
            this._cancelHandler();
        } else {
            this.callCancelHandler();
        }
    };

    Window_CabbyCodesItemQuantity.prototype.update = function() {
        Window_Selectable.prototype.update.call(this);
        // Update cursor blink counter and refresh only when cursor visibility changes
        if (this.active && this.isOpen()) {
            const oldCursorCount = this._cursorCount || 0;
            this._cursorCount = oldCursorCount + 1;
            // Refresh every 15 frames to update cursor blink (30 frames per blink cycle)
            if (oldCursorCount % 15 === 0) {
                this.refresh();
            }
        }
    };

    Window_CabbyCodesItemQuantity.prototype.processHandling = function() {
        Window_Selectable.prototype.processHandling.call(this);
        if (this.isOpenAndActive()) {
            // Arrow keys for cursor movement
            if (Input.isRepeated('left')) {
                this.moveCursorLeft();
            } else if (Input.isRepeated('right')) {
                this.moveCursorRight();
            } else if (Input.isRepeated('up')) {
                this.adjustValue(1);
            } else if (Input.isRepeated('down')) {
                this.adjustValue(-1);
            }
        }
    };
    
    Window_CabbyCodesItemQuantity.prototype.moveCursorLeft = function() {
        if (this._cursorIndex > 0) {
            this._cursorIndex--;
            this.playCursorSound();
            this.refresh();
        }
    };
    
    Window_CabbyCodesItemQuantity.prototype.moveCursorRight = function() {
        const maxIndex = (this._textBuffer || String(this._min)).length;
        if (this._cursorIndex < maxIndex) {
            this._cursorIndex++;
            this.playCursorSound();
            this.refresh();
        }
    };

    Window_CabbyCodesItemQuantity.prototype.adjustValue = function(delta) {
        let newValue = this._value + delta;
        newValue = Math.max(this._min, Math.min(this._max, newValue));
        this._value = newValue;
        this._textBuffer = String(newValue);
        this._cursorIndex = this._textBuffer.length; // Move cursor to end
        this.refresh();
    };

    Window_CabbyCodesItemQuantity.prototype.onKeyDown = function(event) {
        if (!this.active) {
            return;
        }
        
        try {
            // Arrow keys for cursor movement
            if (event.key === 'ArrowLeft') {
                this.moveCursorLeft();
                event.preventDefault();
                return;
            } else if (event.key === 'ArrowRight') {
                this.moveCursorRight();
                event.preventDefault();
                return;
            }
            
            // Number input
            if (event.key >= '0' && event.key <= '9') {
                this.inputDigit(event.key);
                event.preventDefault();
            } else if (event.key === 'Backspace' || event.key === 'Delete') {
                this.eraseDigit();
                event.preventDefault();
            } else if (event.key === 'Home') {
                // Move cursor to start
                this._cursorIndex = 0;
                this.playCursorSound();
                this.refresh();
                event.preventDefault();
            } else if (event.key === 'End') {
                // Move cursor to end
                this._cursorIndex = (this._textBuffer || String(this._min)).length;
                this.playCursorSound();
                this.refresh();
                event.preventDefault();
            }
        } catch (e) {
            CabbyCodes.error('[CabbyCodes] Item Giver: Error in onKeyDown: ' + (e?.message || e));
        }
    };

    Window_CabbyCodesItemQuantity.prototype.inputDigit = function(digit) {
        // Ensure text buffer exists
        if (!this._textBuffer || this._textBuffer.trim() === '') {
            this._textBuffer = '';
            this._cursorIndex = 0;
        }
        
        // Check max length (99 = 2 digits)
        const maxDigits = String(this._max).length;
        if (this._textBuffer.length >= maxDigits) {
            // If at max length, replace digit at cursor position
            if (this._cursorIndex < this._textBuffer.length) {
                // Insert/replace at cursor
                const before = this._textBuffer.substring(0, this._cursorIndex);
                const after = this._textBuffer.substring(this._cursorIndex + 1);
                this._textBuffer = before + digit + after;
                // Keep cursor in place (don't move forward when replacing)
            } else {
                // At end, can't add more
                return;
            }
        } else {
            // Insert digit at cursor position
            const before = this._textBuffer.substring(0, this._cursorIndex);
            const after = this._textBuffer.substring(this._cursorIndex);
            this._textBuffer = before + digit + after;
            this._cursorIndex++; // Move cursor forward
        }
        
        this.updateValueFromBuffer();
        this.playCursorSound();
    };

    Window_CabbyCodesItemQuantity.prototype.eraseDigit = function() {
        // Allow empty text - don't force a value back
        if (this._textBuffer === null || this._textBuffer === undefined) {
            this._textBuffer = '';
            this._cursorIndex = 0;
            this.refresh();
            this.playCursorSound();
            return;
        }
        
        const textBuffer = String(this._textBuffer);
        
        if (textBuffer.length === 0) {
            // Already empty, nothing to delete
            return;
        }
        
        // Allow deleting any character, including the first one
        if (this._cursorIndex > 0) {
            // Delete character at cursor position
            const before = textBuffer.substring(0, this._cursorIndex - 1);
            const after = textBuffer.substring(this._cursorIndex);
            this._textBuffer = before + after;
            this._cursorIndex--;
            
            // Allow empty buffer - don't force minimum value
            if (this._textBuffer === '') {
                this._textBuffer = '';
                this._cursorIndex = 0;
                this._value = 0; // Temporary value while editing
            }
        } else {
            // Cursor at start - still allow deleting the first character
            if (textBuffer.length > 0) {
                this._textBuffer = textBuffer.substring(1);
                this._cursorIndex = 0; // Keep cursor at start
                
                // Allow empty buffer
                if (this._textBuffer === '') {
                    this._textBuffer = '';
                    this._cursorIndex = 0;
                    this._value = 0;
                }
            }
        }
        
        this.updateValueFromBuffer();
        this.playCursorSound();
    };

    Window_CabbyCodesItemQuantity.prototype.updateValueFromBuffer = function() {
        // Allow empty text buffer - don't force a value during editing
        if (this._textBuffer === null || this._textBuffer === undefined || this._textBuffer === '') {
            // Empty buffer is allowed - user is typing
            this._value = 0; // Temporary value
            this._cursorIndex = this._cursorIndex || 0;
            this.refresh();
            return;
        }
        
        const textBuffer = String(this._textBuffer);
        
        // Remove leading zeros (except if the whole number is "0")
        let cleanedBuffer = textBuffer;
        if (textBuffer.length > 1 && textBuffer[0] === '0') {
            cleanedBuffer = textBuffer.replace(/^0+/, '') || '0';
            // Adjust cursor if needed
            const cursorAdjust = textBuffer.length - cleanedBuffer.length;
            this._cursorIndex = Math.max(0, this._cursorIndex - cursorAdjust);
            this._textBuffer = cleanedBuffer;
        }
        
        const parsed = Number(cleanedBuffer);
        
        // During editing, don't enforce range - just store the parsed value
        // Range will be enforced when giving the item (in processOk)
        if (Number.isNaN(parsed)) {
            // Invalid - keep text as-is, value stays at 0
            this._value = 0;
        } else {
            // Valid number - store it (even if out of range)
            this._value = parsed;
        }
        
        // Ensure cursor is within bounds
        if (this._cursorIndex > this._textBuffer.length) {
            this._cursorIndex = this._textBuffer.length;
        }
        
        this.refresh();
    };

    /**
     * Main scene for item giver
     */
    function Scene_CabbyCodesItemGiver() {
        this.initialize(...arguments);
    }

    window.Scene_CabbyCodesItemGiver = Scene_CabbyCodesItemGiver;

    Scene_CabbyCodesItemGiver.prototype = Object.create(Scene_MenuBase.prototype);
    Scene_CabbyCodesItemGiver.prototype.constructor = Scene_CabbyCodesItemGiver;

    Scene_CabbyCodesItemGiver.prototype.create = function() {
        try {
            CabbyCodes.log('[CabbyCodes] Item Giver: Creating scene');
            Scene_MenuBase.prototype.create.call(this);
            CabbyCodes.log('[CabbyCodes] Item Giver: Base scene created');
            // Create in order: header at top, then filter, then description, then hidden search window, then item list
            this.createHelpWindow();
            CabbyCodes.log('[CabbyCodes] Item Giver: Help window created');
            this.createFilterWindow();
            CabbyCodes.log('[CabbyCodes] Item Giver: Filter window created');
            this.createDescriptionWindow();
            CabbyCodes.log('[CabbyCodes] Item Giver: Description window created');
            this.createSearchWindow();
            CabbyCodes.log('[CabbyCodes] Item Giver: Search window created (hidden)');
            this.createItemWindow();
            CabbyCodes.log('[CabbyCodes] Item Giver: Item window created');
        } catch (e) {
            CabbyCodes.error('[CabbyCodes] Item Giver: Error in scene create:', e?.message || e, e?.stack);
            throw e;
        }
    };

    Scene_CabbyCodesItemGiver.prototype.helpAreaHeight = function() {
        // Header window should be small - just fit the header text
        const helpText = 'Select an item to add to inventory';
        const tempWindow = new Window_Help(new Rectangle(0, 0, Graphics.boxWidth, 100));
        const textSize = tempWindow.textSizeEx(helpText);
        const lineHeight = tempWindow.lineHeight();
        tempWindow.destroy();
        const numLines = Math.ceil(textSize.height / lineHeight);
        return this.calcWindowHeight(Math.max(1, numLines), false);
    };

    Scene_CabbyCodesItemGiver.prototype.descriptionAreaHeight = function(text) {
        // Calculate height dynamically based on description text
        if (!text || text === '') {
            return 0; // No height if no text
        }
        const tempWindow = new Window_Help(new Rectangle(0, 0, Graphics.boxWidth, 100));
        const textSize = tempWindow.textSizeEx(text);
        const lineHeight = tempWindow.lineHeight();
        tempWindow.destroy();
        const numLines = Math.ceil(textSize.height / lineHeight);
        // Minimum 1 line, but fit to content
        return this.calcWindowHeight(Math.max(1, numLines), false);
    };

    Scene_CabbyCodesItemGiver.prototype.createHelpWindow = function() {
        // Position header window at top of screen - small, just for header text
        const helpHeight = this.helpAreaHeight();
        const rect = new Rectangle(0, 0, Graphics.boxWidth, helpHeight);
        this._helpWindow = new Window_Help(rect);
        this._helpWindow.setText('Select an item to add to inventory');
        this.addWindow(this._helpWindow);
    };

    Scene_CabbyCodesItemGiver.prototype.createDescriptionWindow = function() {
        // Position description window at bottom of screen
        // Start with minimal height, will resize when content is added
        const initialHeight = this.calcWindowHeight(1, false);
        const rect = new Rectangle(0, Graphics.boxHeight - initialHeight, Graphics.boxWidth, initialHeight);
        this._descriptionWindow = new Window_Help(rect);
        this._descriptionWindow.setText(''); // Start empty
        this.addWindow(this._descriptionWindow);
    };
    
    Scene_CabbyCodesItemGiver.prototype.updateDescriptionWindow = function(text) {
        if (!this._descriptionWindow) {
            CabbyCodes.warn('[CabbyCodes] Item Giver: Description window is null');
            return;
        }
        
        try {
            // Calculate new height based on text
            const newHeight = this.descriptionAreaHeight(text);
            
            if (newHeight > 0 && text) {
                // Check if we need to resize
                const needsResize = this._descriptionWindow.height !== newHeight;
                
                if (needsResize) {
                    // Resize window - need to recreate contents after resize
                    this._descriptionWindow.height = newHeight;
                    this._descriptionWindow.y = Graphics.boxHeight - newHeight;
                    this._descriptionWindow.createContents();
                } else {
                    // Just reposition if height hasn't changed
                    this._descriptionWindow.y = Graphics.boxHeight - newHeight;
                }
                
                this._descriptionWindow.setText(text);
                // Force refresh and redraw
                this._descriptionWindow.refresh();
                CabbyCodes.log('[CabbyCodes] Item Giver: Updated description window with text: ' + (text ? text.substring(0, 50) + '...' : 'empty'));
            } else {
                // Show minimal window with empty text
                const minHeight = this.calcWindowHeight(1, false);
                const needsResize = this._descriptionWindow.height !== minHeight;
                
                if (needsResize) {
                    this._descriptionWindow.height = minHeight;
                    this._descriptionWindow.createContents();
                }
                this._descriptionWindow.y = Graphics.boxHeight - minHeight;
                this._descriptionWindow.setText('');
                this._descriptionWindow.refresh();
            }
        } catch (e) {
            CabbyCodes.error('[CabbyCodes] Item Giver: Error updating description window: ' + (e?.message || e));
            CabbyCodes.error('[CabbyCodes] Item Giver: Stack: ' + (e?.stack || 'No stack trace'));
        }
    };

    Scene_CabbyCodesItemGiver.prototype.createFilterWindow = function() {
        const rect = this.filterWindowRect();
        this._filterWindow = new Window_CabbyCodesItemGiverFilter(rect);
        this._filterWindow.setHandler('ok', this.onFilterOk.bind(this));
        this._filterWindow.setHandler('cancel', this.onFilterCancel.bind(this));
        this.addWindow(this._filterWindow);
    };

    Scene_CabbyCodesItemGiver.prototype.createItemWindow = function() {
        try {
            CabbyCodes.log('[CabbyCodes] Item Giver: Creating item window');
            const rect = this.itemWindowRect();
            this._itemWindow = new Window_CabbyCodesItemGiverList(rect);
            CabbyCodes.log('[CabbyCodes] Item Giver: Item window instance created');
            
            if (this._descriptionWindow) {
                this._itemWindow.setDescriptionWindow(this._descriptionWindow);
                this._itemWindow.setScene(this); // Pass scene reference for dynamic resizing
                CabbyCodes.log('[CabbyCodes] Item Giver: Description window set');
            } else {
                CabbyCodes.warn('[CabbyCodes] Item Giver: Description window is undefined');
            }
            
            if (this._searchWindow) {
                if (typeof this._itemWindow.setSearchWindow === 'function') {
                    this._itemWindow.setSearchWindow(this._searchWindow);
                }
                if (typeof this._searchWindow.setItemWindow === 'function') {
                    this._searchWindow.setItemWindow(this._itemWindow);
                }
                CabbyCodes.log('[CabbyCodes] Item Giver: Search window linked to item window');
            } else {
                CabbyCodes.warn('[CabbyCodes] Item Giver: Search window is undefined');
            }
            
            this._itemWindow.setHandler('ok', this.onItemOk.bind(this));
            this._itemWindow.setHandler('cancel', this.onItemCancel.bind(this));
            this.addWindow(this._itemWindow);
            
            if (this._filterWindow) {
                if (typeof this._filterWindow.setItemWindow === 'function') {
                    this._filterWindow.setItemWindow(this._itemWindow);
                } else {
                    CabbyCodes.error('[CabbyCodes] Item Giver: setItemWindow is not a function on filter window');
                }
            }
            
            this._itemWindow.activate();
            this._itemWindow.select(0);
            // Update help window with initial selection
            this._itemWindow.callUpdateHelp();
            CabbyCodes.log('[CabbyCodes] Item Giver: Item window setup complete');
        } catch (e) {
            CabbyCodes.error('[CabbyCodes] Item Giver: Error creating item window:', e?.message || e, e?.stack);
            throw e;
        }
    };

    Scene_CabbyCodesItemGiver.prototype.createSearchWindow = function() {
        const rect = this.searchWindowRect();
        this._searchWindow = new Window_CabbyCodesItemSearch(rect);
        this._searchWindow.visible = false;
        this._searchWindow.opacity = 0;
        this._searchWindow.deactivate();
        this.addWindow(this._searchWindow);
        CabbyCodes.log('[CabbyCodes] Item Giver: Hidden search window created for keyboard input');
    };

    Scene_CabbyCodesItemGiver.prototype.searchWindowRect = function() {
        // Place the search window off-screen so it doesn't render, but still handles keyboard input.
        return new Rectangle(0, Graphics.boxHeight + 50, Graphics.boxWidth, this.calcWindowHeight(1, false));
    };

    Scene_CabbyCodesItemGiver.prototype.filterWindowRect = function() {
        // Position filter below help window at top
        const helpHeight = this.helpAreaHeight();
        const wx = 0;
        const wy = helpHeight;
        const ww = Graphics.boxWidth;
        const wh = this.calcWindowHeight(1, true);
        return new Rectangle(wx, wy, ww, wh);
    };

    Scene_CabbyCodesItemGiver.prototype.itemWindowRect = function() {
        // Item list fills most of the screen, between filter and description
        const filterHeight = this.calcWindowHeight(1, true);
        const helpHeight = this.helpAreaHeight();
        // Use minimum description height for layout calculation
        const minDescHeight = this.calcWindowHeight(1, false);
        const wx = 0;
        const wy = helpHeight + filterHeight;
        const ww = Graphics.boxWidth;
        // Fill space between filter and description window at bottom
        const wh = Graphics.boxHeight - helpHeight - filterHeight - minDescHeight;
        return new Rectangle(wx, wy, ww, wh);
    };

    Scene_CabbyCodesItemGiver.prototype.onFilterOk = function() {
        const symbol = this._filterWindow.commandSymbol(this._filterWindow.index());
        this._filterWindow.setCategory(symbol);
        this._itemWindow.activate();
    };

    Scene_CabbyCodesItemGiver.prototype.onFilterCancel = function() {
        // Don't allow cancel from filter
    };

    Scene_CabbyCodesItemGiver.prototype.onItemOk = function() {
        try {
            CabbyCodes.log('[CabbyCodes] Item Giver: onItemOk called');
            const itemData = this._itemWindow.item();
            CabbyCodes.log('[CabbyCodes] Item Giver: itemData = ' + (itemData ? itemData.name : 'null'));
            if (itemData) {
                this.openQuantityWindow(itemData);
            } else {
                CabbyCodes.warn('[CabbyCodes] Item Giver: itemData is null in onItemOk');
            }
        } catch (e) {
            CabbyCodes.error('[CabbyCodes] Item Giver: Error in onItemOk: ' + (e?.message || e));
            CabbyCodes.error('[CabbyCodes] Item Giver: Stack: ' + (e?.stack || 'No stack trace'));
        }
    };

    Scene_CabbyCodesItemGiver.prototype.onItemCancel = function() {
        this.popScene();
    };

    Scene_CabbyCodesItemGiver.prototype.start = function() {
        try {
            Scene_MenuBase.prototype.start.call(this);
            CabbyCodes.log('[CabbyCodes] Item Giver: Scene started');
        } catch (e) {
            CabbyCodes.error('[CabbyCodes] Item Giver: Error in scene start:', e?.message || e, e?.stack);
            throw e;
        }
    };

    Scene_CabbyCodesItemGiver.prototype.update = function() {
        try {
            Scene_MenuBase.prototype.update.call(this);
        } catch (e) {
            CabbyCodes.error('[CabbyCodes] Item Giver: Error in base scene update: ' + (e?.message || e));
            CabbyCodes.error('[CabbyCodes] Item Giver: Stack: ' + (e?.stack || 'No stack trace'));
            // Continue to try our custom update logic
        }
        
        // Search is always active when item window is active
        try {
            if (this._searchWindow) {
                try {
                    let itemWindowActive = false;
                    if (this._itemWindow) {
                        if (typeof this._itemWindow.active !== 'undefined') {
                            itemWindowActive = this._itemWindow.active;
                        } else {
                            CabbyCodes.warn('[CabbyCodes] Item Giver: _itemWindow.active is undefined');
                        }
                    } else {
                        CabbyCodes.warn('[CabbyCodes] Item Giver: _itemWindow is null/undefined in update');
                    }
                    
                    if (typeof this._searchWindow._active !== 'undefined') {
                        this._searchWindow._active = itemWindowActive;
                    } else {
                        CabbyCodes.warn('[CabbyCodes] Item Giver: _searchWindow._active property missing');
                    }
                    
                    if (this._searchWindow._active) {
                        if (typeof this._searchWindow.refresh === 'function') {
                            this._searchWindow.refresh();
                        } else {
                            CabbyCodes.warn('[CabbyCodes] Item Giver: _searchWindow.refresh is not a function');
                        }
                    }
                } catch (e) {
                    CabbyCodes.error('[CabbyCodes] Item Giver: Error updating search window: ' + (e?.message || e));
                    CabbyCodes.error('[CabbyCodes] Item Giver: Stack: ' + (e?.stack || 'No stack trace'));
                }
            } else {
                CabbyCodes.warn('[CabbyCodes] Item Giver: _searchWindow is null/undefined in update');
            }
        } catch (e) {
            CabbyCodes.error('[CabbyCodes] Item Giver: Error in scene update (search window logic): ' + (e?.message || e));
            CabbyCodes.error('[CabbyCodes] Item Giver: Stack: ' + (e?.stack || 'No stack trace'));
            // Don't throw - try to continue
        }
    };

    Scene_CabbyCodesItemGiver.prototype.openQuantityWindow = function(itemData) {
        try {
            CabbyCodes.log('[CabbyCodes] Item Giver: Opening quantity window for item: ' + (itemData?.name || 'unknown'));
            const callbacks = {
                onApply: (quantity) => {
                    CabbyCodes.log('[CabbyCodes] Item Giver: Quantity callback onApply called with quantity: ' + quantity);
                    this.addItemToInventory(itemData, quantity);
                },
                onCancel: () => {
                    CabbyCodes.log('[CabbyCodes] Item Giver: Quantity callback onCancel called');
                    // Return to item selection
                }
            };
            // Push first to create the scene instance, then prepare it
            SceneManager.push(Scene_CabbyCodesItemQuantity);
            SceneManager.prepareNextScene(itemData, 1, callbacks);
            CabbyCodes.log('[CabbyCodes] Item Giver: Quantity window pushed and prepared');
        } catch (e) {
            CabbyCodes.error('[CabbyCodes] Item Giver: Error opening quantity window: ' + (e?.message || e));
            CabbyCodes.error('[CabbyCodes] Item Giver: Stack: ' + (e?.stack || 'No stack trace'));
        }
    };

    Scene_CabbyCodesItemGiver.prototype.addItemToInventory = function(itemData, quantity) {
        try {
            // Only add if quantity is greater than 0
            if (quantity > 0) {
                $gameParty.gainItem(itemData.item, quantity);
                SoundManager.playShop();
                CabbyCodes.log(`[CabbyCodes] Added ${quantity}x ${itemData.name} to inventory`);
            } else {
                CabbyCodes.log(`[CabbyCodes] Quantity is 0, not adding item (player may already have max)`);
                SoundManager.playBuzzer();
            }
            // Refresh item window if it exists
            if (this._itemWindow) {
                this._itemWindow.refresh();
            }
        } catch (e) {
            CabbyCodes.error(`[CabbyCodes] Failed to add item: ${e?.message || e}`);
            SoundManager.playBuzzer();
        }
    };

    /**
     * Quantity input scene
     */
    function Scene_CabbyCodesItemQuantity() {
        this.initialize(...arguments);
    }

    window.Scene_CabbyCodesItemQuantity = Scene_CabbyCodesItemQuantity;

    Scene_CabbyCodesItemQuantity.prototype = Object.create(Scene_MenuBase.prototype);
    Scene_CabbyCodesItemQuantity.prototype.constructor = Scene_CabbyCodesItemQuantity;

    Scene_CabbyCodesItemQuantity.prototype.prepare = function(itemData, initialValue, callbacks = {}) {
        CabbyCodes.log('[CabbyCodes] Item Giver: Quantity scene prepare called');
        CabbyCodes.log('[CabbyCodes] Item Giver: itemData = ' + (itemData ? itemData.name : 'null'));
        CabbyCodes.log('[CabbyCodes] Item Giver: initialValue = ' + initialValue);
        CabbyCodes.log('[CabbyCodes] Item Giver: callbacks = ' + (callbacks ? 'present' : 'null'));
        this._itemData = itemData;
        this._initialValue = initialValue || 1;
        this._callbacks = callbacks;
    };

    Scene_CabbyCodesItemQuantity.prototype.create = function() {
        Scene_MenuBase.prototype.create.call(this);
        this.createHelpWindow(); // Create help window first so it's at the top
        this.createQuantityWindow();
        this.createButtons();
    };

    Scene_CabbyCodesItemQuantity.prototype.helpAreaHeight = function() {
        // Calculate height dynamically based on text
        const maxValue = (typeof $gameParty !== 'undefined' && typeof $gameParty.maxItems === 'function') 
            ? $gameParty.maxItems(this._itemData ? this._itemData.item : null) 
            : 99;
        const helpText = `Enter quantity (1-${maxValue}). Type numbers or use arrow keys.`;
        
        // Calculate text height using textSizeEx
        const tempWindow = new Window_Help(new Rectangle(0, 0, Graphics.boxWidth, 100));
        const textSize = tempWindow.textSizeEx(helpText);
        const lineHeight = tempWindow.lineHeight();
        tempWindow.destroy();
        
        // Calculate number of lines needed
        const numLines = Math.ceil(textSize.height / lineHeight);
        
        // Return height to fit contents
        return this.calcWindowHeight(Math.max(1, numLines), false);
    };

    Scene_CabbyCodesItemQuantity.prototype.createHelpWindow = function() {
        // Calculate dynamic height first
        const helpHeight = this.helpAreaHeight();
        // Position at top of screen
        const rect = new Rectangle(0, 0, Graphics.boxWidth, helpHeight);
        this._helpWindow = new Window_Help(rect);
        const maxValue = (typeof $gameParty !== 'undefined' && typeof $gameParty.maxItems === 'function') 
            ? $gameParty.maxItems(this._itemData ? this._itemData.item : null) 
            : 99;
        // Window_Help uses drawTextEx which automatically wraps text
        this._helpWindow.setText(`Enter quantity (1-${maxValue}). Type numbers or use arrow keys.`);
        this.addWindow(this._helpWindow);
    };
    
    Scene_CabbyCodesItemQuantity.prototype.createButtons = function() {
        // Create text-based button window
        this.createButtonWindow();
    };
    
    Scene_CabbyCodesItemQuantity.prototype.createButtonWindow = function() {
        const buttonHeight = this.calcWindowHeight(1, true);
        const spacing = 8;
        // Calculate button width - enough for "OK" and "Cancel" with spacing
        const buttonWidth = 200; // Appropriate width for two buttons
        const wx = (Graphics.boxWidth - buttonWidth) / 2; // Center horizontally
        // Position buttons below the quantity window
        const quantityWindowBottom = this.quantityWindowRect().y + this.quantityWindowRect().height;
        const wy = quantityWindowBottom + spacing;
        const rect = new Rectangle(wx, wy, buttonWidth, buttonHeight);
        this._buttonWindow = new Window_CabbyCodesItemQuantityButtons(rect);
        this._buttonWindow.setHandler('ok', this.onButtonOk.bind(this));
        this._buttonWindow.setHandler('cancel', this.onButtonCancel.bind(this));
        this.addWindow(this._buttonWindow);
        this._buttonWindow.activate();
        this._buttonWindow.select(0); // Select OK by default
    };
    
    Scene_CabbyCodesItemQuantity.prototype.onButtonOk = function() {
        // Call the quantity window's processOk directly, which will call the handler
        if (this._quantityWindow) {
            this._quantityWindow.processOk();
        }
    };
    
    Scene_CabbyCodesItemQuantity.prototype.onButtonCancel = function() {
        if (this._quantityWindow) {
            this._quantityWindow.processCancel();
        }
    };

    Scene_CabbyCodesItemQuantity.prototype.quantityWindowRect = function() {
        const helpHeight = this.helpAreaHeight();
        const buttonHeight = this.calcWindowHeight(1, true);
        const spacing = 8;
        const ww = 360;
        const wh = this.calcWindowHeight(1, true); // Smaller height - just fit the item row
        const wx = (Graphics.boxWidth - ww) / 2;
        // Position below help window at top, above buttons
        const wy = helpHeight + 24;
        return new Rectangle(wx, wy, ww, wh);
    };

    Scene_CabbyCodesItemQuantity.prototype.createQuantityWindow = function() {
        const rect = this.quantityWindowRect();
        this._quantityWindow = new Window_CabbyCodesItemQuantity(rect, this._itemData, this._initialValue);
        // Set handlers for button clicks
        this._quantityWindow.setOkHandler(this.onQuantityOk.bind(this));
        this._quantityWindow.setCancelHandler(this.onQuantityCancel.bind(this));
        this.addWindow(this._quantityWindow);
        // Quantity window uses keydown event listener, so it doesn't need to be active
        // But we'll keep it selectable for visual feedback
        this._quantityWindow.activate();
        this._quantityWindow.select(0);
    };
    
    Scene_CabbyCodesItemQuantity.prototype.update = function() {
        Scene_MenuBase.prototype.update.call(this);
    };

    Scene_CabbyCodesItemQuantity.prototype.onQuantityOk = function() {
        // Prevent double calls
        if (this._processingOk) {
            CabbyCodes.warn('[CabbyCodes] Item Giver: onQuantityOk already processing, ignoring duplicate call');
            return;
        }
        this._processingOk = true;
        
        try {
            CabbyCodes.log('[CabbyCodes] Item Giver: onQuantityOk called');
            const quantity = this._quantityWindow.value();
            CabbyCodes.log('[CabbyCodes] Item Giver: quantity = ' + quantity);
            CabbyCodes.log('[CabbyCodes] Item Giver: _callbacks = ' + (this._callbacks ? 'present' : 'null'));
            if (this._callbacks && typeof this._callbacks.onApply === 'function') {
                CabbyCodes.log('[CabbyCodes] Item Giver: Calling onApply callback with quantity: ' + quantity);
                this._callbacks.onApply(quantity);
            } else {
                CabbyCodes.warn('[CabbyCodes] Item Giver: onApply callback is not available');
            }
            SceneManager.pop();
        } catch (e) {
            CabbyCodes.error('[CabbyCodes] Item Giver: Error in onQuantityOk: ' + (e?.message || e));
            CabbyCodes.error('[CabbyCodes] Item Giver: Stack: ' + (e?.stack || 'No stack trace'));
            SceneManager.pop(); // Still pop even on error
        } finally {
            this._processingOk = false;
        }
    };

    Scene_CabbyCodesItemQuantity.prototype.onQuantityCancel = function() {
        if (this._callbacks && typeof this._callbacks.onCancel === 'function') {
            this._callbacks.onCancel();
        }
        SceneManager.pop();
    };

    /**
     * Search input window - simplified to show search text and handle via keyboard
     */
    function Window_CabbyCodesItemSearch() {
        this.initialize(...arguments);
    }

    window.Window_CabbyCodesItemSearch = Window_CabbyCodesItemSearch;

    Window_CabbyCodesItemSearch.prototype = Object.create(Window_Base.prototype);
    Window_CabbyCodesItemSearch.prototype.constructor = Window_CabbyCodesItemSearch;

    Window_CabbyCodesItemSearch.prototype.initialize = function(rect) {
        Window_Base.prototype.initialize.call(this, rect);
        this._searchText = '';
        this._active = false;
        this._boundKeyHandler = this.onKeyDown.bind(this);
        window.addEventListener('keydown', this._boundKeyHandler, true);
    };

    Window_CabbyCodesItemSearch.prototype.destroy = function(options) {
        window.removeEventListener('keydown', this._boundKeyHandler, true);
        Window_Base.prototype.destroy.call(this, options);
    };

    Window_CabbyCodesItemSearch.prototype.searchText = function() {
        return this._searchText;
    };

    Window_CabbyCodesItemSearch.prototype.setSearchText = function(text) {
        this._searchText = text || '';
        this.refresh();
    };

    Window_CabbyCodesItemSearch.prototype.clearSearch = function() {
        this._searchText = '';
        this.refresh();
        if (this._itemWindow) {
            this._itemWindow.setFilters(this._itemWindow._category, '');
        }
    };

    Window_CabbyCodesItemSearch.prototype.setItemWindow = function(itemWindow) {
        this._itemWindow = itemWindow;
    };

    Window_CabbyCodesItemSearch.prototype.activate = function() {
        this._active = true;
        this.refresh();
    };

    Window_CabbyCodesItemSearch.prototype.deactivate = function() {
        this._active = false;
        this.refresh();
    };

    Window_CabbyCodesItemSearch.prototype.refresh = function() {
        try {
            if (!this.contents) {
                this.createContents();
            } else {
                this.contents.clear();
            }
            this.drawAllItems();
        } catch (e) {
            CabbyCodes.error('[CabbyCodes] Item Giver: Error refreshing search window: ' + (e?.message || e));
            CabbyCodes.error('[CabbyCodes] Item Giver: Stack: ' + (e?.stack || 'No stack trace'));
        }
    };

    Window_CabbyCodesItemSearch.prototype.drawAllItems = function() {
        try {
            if (!this.contents) {
                this.createContents();
            } else {
                this.contents.clear();
            }
            const rect = this.baseTextRect();
            const label = 'Search: ';
            const labelWidth = this.textWidth(label);
            this.drawText(label, rect.x, rect.y, labelWidth, 'left');
            
            const searchRect = new Rectangle(rect.x + labelWidth, rect.y, rect.width - labelWidth - 80, rect.height);
            let isActive = false;
            if (this._itemWindow) {
                if (typeof this._itemWindow.active !== 'undefined') {
                    isActive = this._itemWindow.active;
                }
            }
            const displayText = this._searchText || (isActive ? '(Type to search)' : '');
            this.changeTextColor(isActive ? this.normalColor() : this.gaugeBackColor());
            this.drawText(displayText, searchRect.x, rect.y, searchRect.width, 'left');
            this.resetTextColor();
            
            // Draw clear hint
            if (this._searchText) {
                this.changeTextColor(this.systemColor());
                this.drawText('(Esc to clear)', rect.x + rect.width - 80, rect.y, 80, 'right');
                this.resetTextColor();
            }
        } catch (e) {
            CabbyCodes.error('[CabbyCodes] Item Giver: Error in drawAllItems: ' + (e?.message || e));
            CabbyCodes.error('[CabbyCodes] Item Giver: Stack: ' + (e?.stack || 'No stack trace'));
            // Don't throw - just skip drawing
        }
    };

    /**
     * Button window for OK/Cancel in quantity scene
     */
    function Window_CabbyCodesItemQuantityButtons() {
        this.initialize(...arguments);
    }

    window.Window_CabbyCodesItemQuantityButtons = Window_CabbyCodesItemQuantityButtons;

    Window_CabbyCodesItemQuantityButtons.prototype = Object.create(Window_Command.prototype);
    Window_CabbyCodesItemQuantityButtons.prototype.constructor = Window_CabbyCodesItemQuantityButtons;

    Window_CabbyCodesItemQuantityButtons.prototype.initialize = function(rect) {
        Window_Command.prototype.initialize.call(this, rect);
    };

    Window_CabbyCodesItemQuantityButtons.prototype.makeCommandList = function() {
        this.addCommand('OK', 'ok');
        this.addCommand('Cancel', 'cancel');
    };

    Window_CabbyCodesItemQuantityButtons.prototype.maxCols = function() {
        return 2;
    };

    Window_CabbyCodesItemSearch.prototype.onKeyDown = function(event) {
        try {
            if (!event || !event.key) {
                return;
            }
            
            // Always allow search input when item window is active
            if (!this._itemWindow) {
                return;
            }
            
            if (typeof this._itemWindow.active === 'undefined' || !this._itemWindow.active) {
                return;
            }
            
            // Allow alphanumeric and space
            if (event.key.length === 1 && /[a-zA-Z0-9\s]/.test(event.key)) {
                this._searchText = (this._searchText || '') + event.key;
                this.refresh();
                if (this._itemWindow && typeof this._itemWindow.setFilters === 'function') {
                    const category = this._itemWindow._category || 'all';
                    this._itemWindow.setFilters(category, this._searchText);
                }
                if (event.preventDefault) {
                    event.preventDefault();
                }
            } else if (event.key === 'Backspace' || event.key === 'Delete') {
                this._searchText = (this._searchText || '').slice(0, -1);
                this.refresh();
                if (this._itemWindow && typeof this._itemWindow.setFilters === 'function') {
                    const category = this._itemWindow._category || 'all';
                    this._itemWindow.setFilters(category, this._searchText);
                }
                if (event.preventDefault) {
                    event.preventDefault();
                }
            } else if (event.key === 'Escape') {
                this.clearSearch();
                if (event.preventDefault) {
                    event.preventDefault();
                }
            }
        } catch (e) {
            CabbyCodes.error('[CabbyCodes] Item Giver: Error in search window onKeyDown: ' + (e?.message || e));
            CabbyCodes.error('[CabbyCodes] Item Giver: Stack: ' + (e?.stack || 'No stack trace'));
            // Don't throw - just ignore the key press
        }
    };

    // Register setting with formatValue to show "Press OK" instead of on/off
    CabbyCodes.registerSetting('itemGiver', 'Give Item', {
        defaultValue: false,
        formatValue: () => 'Press OK'
    });

    // Hook into Window_Options to open scene when setting is selected
    // This needs to wrap the settings.js hook to intercept before toggle
    function setupProcessOkHook() {
        try {
            if (typeof Window_Options === 'undefined') {
                CabbyCodes.log('[CabbyCodes] Item Giver: Window_Options is undefined');
                return false;
            }
            if (!Window_Options.prototype.processOk) {
                CabbyCodes.log('[CabbyCodes] Item Giver: Window_Options.prototype.processOk is undefined');
                return false;
            }
            const _Window_Options_processOk_itemGiver = Window_Options.prototype.processOk;
            const hookType = typeof _Window_Options_processOk_itemGiver;
            CabbyCodes.log('[CabbyCodes] Item Giver: Stored processOk hook, type: ' + hookType);
            if (hookType !== 'function' && hookType !== 'undefined') {
                CabbyCodes.warn('[CabbyCodes] Item Giver: processOk is not a function, type:', hookType);
            }
            
            Window_Options.prototype.processOk = function() {
                try {
                    CabbyCodes.log('[CabbyCodes] Item Giver: processOk called');
                    const index = this.index();
                    CabbyCodes.log('[CabbyCodes] Item Giver: index = ' + String(index));
                    const symbol = this.commandSymbol(index);
                    CabbyCodes.log('[CabbyCodes] Item Giver: symbol = ' + String(symbol || '(empty)'));
                    if (symbol === 'cabbycodes_itemGiver') {
                        // Always open the scene when this option is selected (don't toggle)
                        CabbyCodes.log('[CabbyCodes] Item Giver: Opening scene');
                        if (typeof Scene_CabbyCodesItemGiver === 'undefined') {
                            CabbyCodes.error('[CabbyCodes] Item Giver: Scene_CabbyCodesItemGiver is undefined!');
                            return;
                        }
                        if (typeof SceneManager === 'undefined' || typeof SceneManager.push !== 'function') {
                            CabbyCodes.error('[CabbyCodes] Item Giver: SceneManager.push is not available!');
                            return;
                        }
                        SceneManager.push(Scene_CabbyCodesItemGiver);
                        return;
                    }
                    // Call the previous hook (which may be from settings.js)
                    if (typeof _Window_Options_processOk_itemGiver === 'function') {
                        CabbyCodes.log('[CabbyCodes] Item Giver: Calling previous hook');
                        _Window_Options_processOk_itemGiver.call(this);
                    } else {
                        CabbyCodes.warn('[CabbyCodes] Item Giver: Previous hook is not a function, type:', typeof _Window_Options_processOk_itemGiver);
                    }
                } catch (e) {
                    CabbyCodes.error('[CabbyCodes] Item Giver: Error in processOk hook:', e?.message || e);
                    CabbyCodes.error('[CabbyCodes] Item Giver: Stack:', e?.stack);
                    // Don't throw - let the original handler try
                    if (typeof _Window_Options_processOk_itemGiver === 'function') {
                        try {
                            _Window_Options_processOk_itemGiver.call(this);
                        } catch (e2) {
                            CabbyCodes.error('[CabbyCodes] Item Giver: Error in fallback hook:', e2?.message || e2);
                        }
                    }
                }
            };
            CabbyCodes.log('[CabbyCodes] Item Giver: Hook installed successfully');
            return true;
        } catch (e) {
            CabbyCodes.error('[CabbyCodes] Item Giver: Error setting up hook:', e?.message || e, e?.stack);
            return false;
        }
    }
    
    // Try to set up the hook immediately
    if (!setupProcessOkHook()) {
        CabbyCodes.log('[CabbyCodes] Item Giver: Window_Options not ready, waiting...');
        // If Window_Options isn't loaded yet, wait for it
        const checkWindowOptions = setInterval(() => {
            if (setupProcessOkHook()) {
                clearInterval(checkWindowOptions);
            }
        }, 10);
        setTimeout(() => {
            clearInterval(checkWindowOptions);
            if (!Window_Options || !Window_Options.prototype.processOk) {
                CabbyCodes.error('[CabbyCodes] Item Giver: Failed to set up hook after 5 seconds');
            }
        }, 5000);
    }

    CabbyCodes.log('[CabbyCodes] Item Giver module loaded');
})();

