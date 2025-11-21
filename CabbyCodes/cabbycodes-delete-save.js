//=============================================================================
// CabbyCodes Delete Save
//=============================================================================
/*:
 * @target MZ
 * @plugindesc CabbyCodes Delete Save - Allows deleting save files from the load and save screens.
 * @author CabbyCodes
 * @help
 * Adds delete buttons (X) to each save file row on the load and save screens.
 * Clicking the X button will show a confirmation dialog before deleting the save file.
 */

(() => {
    'use strict';

    if (typeof window.CabbyCodes === 'undefined') {
        if (typeof console !== 'undefined' && console.warn) {
            console.warn('[CabbyCodes] Delete Save requires CabbyCodes core.');
        }
        return;
    }

    // Delete button size and position constants
    const DELETE_BUTTON_SIZE = 32;  // Size of the X button (larger)
    const DELETE_BUTTON_MARGIN = 8; // Margin from the right edge
    const DELETE_BUTTON_Y_OFFSET = 6; // Vertical offset from item top

    /**
     * Get the delete button rectangle for a save file item
     * @param {Window_SavefileList} window - The savefile list window
     * @param {number} index - The item index
     * @returns {Rectangle} The delete button rectangle in window coordinates
     */
    function getDeleteButtonRect(window, index) {
        const itemRect = window.itemRect(index);
        const x = window.contentsWidth() - DELETE_BUTTON_SIZE - DELETE_BUTTON_MARGIN;
        const y = itemRect.y + DELETE_BUTTON_Y_OFFSET;
        return new Rectangle(x, y, DELETE_BUTTON_SIZE, DELETE_BUTTON_SIZE);
    }

    /**
     * Check if a point is within the delete button for the specified index
     * @param {Window_SavefileList} window - The savefile list window
     * @param {number} index - The item index
     * @param {number} x - X coordinate in window content coordinates
     * @param {number} y - Y coordinate in window content coordinates
     * @returns {boolean} True if the point is within the delete button
     */
    function isPointInDeleteButton(window, index, x, y) {
        const buttonRect = getDeleteButtonRect(window, index);
        return buttonRect.contains(x, y);
    }

    /**
     * Draw the delete button (X) for a save file item
     * @param {Window_SavefileList} window - The savefile list window
     * @param {number} index - The item index
     */
    function drawDeleteButton(window, index) {
        const savefileId = window.indexToSavefileId(index);
        const isEnabled = window.isEnabled(savefileId);
        
        // Only show delete button if this save file exists (is enabled)
        if (!isEnabled) {
            return;
        }

        const buttonRect = getDeleteButtonRect(window, index);
        
        // Save original paint opacity
        const originalOpacity = window.contents.paintOpacity;
        
        // Draw button background with square corners - darker red
        window.contents.paintOpacity = 255;
        window.contents.fillRect(
            buttonRect.x,
            buttonRect.y,
            buttonRect.width,
            buttonRect.height,
            '#660000'
        );
        
        // Draw border - square corners
        window.contents.strokeRect(
            buttonRect.x,
            buttonRect.y,
            buttonRect.width,
            buttonRect.height,
            '#aa0000'
        );
        
        window.contents.paintOpacity = originalOpacity;

        // Draw X symbol - larger and bolder
        const originalColor = window.contents.textColor;
        window.changeTextColor('#ff6666');
        const originalFontSize = window.contents.fontSize;
        window.contents.fontSize = 24;
        window.contents.fontBold = true;
        
        // Draw X using text character, centered
        window.drawText('✕', buttonRect.x, buttonRect.y - 1, buttonRect.width, 'center');
        
        // Reset text properties
        window.changeTextColor(originalColor);
        window.contents.fontSize = originalFontSize;
        window.contents.fontBold = false;
    }

    // Global state for confirmation dialog
    let _deleteConfirmWindow = null;
    let _deleteConfirmCallback = null;

    /**
     * Custom confirmation dialog window with square corners
     */
    function Window_DeleteConfirm() {
        this.initialize(...arguments);
    }

    Window_DeleteConfirm.prototype = Object.create(Window_HorzCommand.prototype);
    Window_DeleteConfirm.prototype.constructor = Window_DeleteConfirm;

    Window_DeleteConfirm.prototype.initialize = function(message) {
        this._message = message || "";
        const width = 360; // Fixed width
        // Calculate height using fixed values (methods not available yet)
        // Message area: ~2 lines * 36px = 72px + padding
        // Button area: 1 row * 44px = 44px + padding  
        // Window padding: 12px * 2 = 24px
        // Total: ~148px, use safe minimum
        const height = Math.max(140, (36 * 2) + 44 + (8 * 4) + (12 * 2));
        
        // Position window centered - use boxWidth/boxHeight for window layer coordinates
        // Window layer is already offset, so we position relative to the box
        const x = Math.max(0, (Graphics.boxWidth - width) / 2);
        const y = Math.max(0, (Graphics.boxHeight - height) / 2);
        
        // Initialize with the rectangle - this will set up all window parts
        Window_HorzCommand.prototype.initialize.call(this, new Rectangle(x, y, width, height));
        
        // Now that window is initialized, we can recalculate height properly
        const actualHeight = this.windowHeight();
        if (actualHeight > 0 && actualHeight !== height) {
            // Update window height if calculation differs
            this.height = actualHeight;
            this.y = Math.max(0, (Graphics.boxHeight - actualHeight) / 2);
            this.createContents(); // Recreate contents with new height
        }
        
        // Set up handlers - use the symbol as the key
        // When OK button (symbol "ok") is selected and OK is pressed, call onOk
        // When Cancel button (symbol "cancel") is selected and OK is pressed, call onCancel
        this.setHandler("ok", this.onOk.bind(this));
        this.setHandler("cancel", this.onCancel.bind(this));
        
        // Ensure window is visible
        this.visible = true;
        this.show();
        this.active = true;
    };

    Window_DeleteConfirm.prototype.windowWidth = function() {
        return 360;
    };

    Window_DeleteConfirm.prototype.windowHeight = function() {
        // Calculate height exactly - no excess space
        // Use standard RPG Maker values - these should be available but use defaults as fallback
        let lineHeight, itemHeight, padding, itemPadding;
        
        try {
            lineHeight = this.lineHeight ? this.lineHeight() : 36;
            itemHeight = this.itemHeight ? this.itemHeight() : (lineHeight + 8);
            padding = this.padding || 12;
            itemPadding = this.itemPadding ? this.itemPadding() : 8;
        } catch (e) {
            // If methods aren't available yet, use defaults
            lineHeight = 36;
            itemHeight = 44;
            padding = 12;
            itemPadding = 8;
        }
        
        // Message area: calculate actual lines needed
        const messageLines = this.calculateMessageLines();
        const messageAreaHeight = (lineHeight * messageLines) + (itemPadding * 2);
        
        // Button area: 1 row of buttons (OK and Cancel side by side)
        const buttonAreaHeight = itemHeight + (itemPadding * 2);
        
        // Add window padding (top and bottom)
        const totalHeight = messageAreaHeight + buttonAreaHeight + (padding * 2);
        
        return totalHeight;
    };

    Window_DeleteConfirm.prototype.calculateMessageLines = function() {
        if (!this._message) {
            return 1;
        }
        try {
            const padding = this.itemPadding();
            const maxWidth = this.contentsWidth() - padding * 2;
            const textWidth = this.textWidth(this._message);
            const lines = Math.max(1, Math.ceil(textWidth / Math.max(1, maxWidth)));
            return Math.min(lines, 3); // Cap at 3 lines
        } catch (e) {
            return 1; // Fallback to 1 line
        }
    };

    Window_DeleteConfirm.prototype.maxCols = function() {
        return 2; // OK and Cancel side by side
    };

    Window_DeleteConfirm.prototype.numVisibleRows = function() {
        return 1; // One row of buttons
    };

    Window_DeleteConfirm.prototype.itemHeight = function() {
        return this.lineHeight() + 8;
    };

    Window_DeleteConfirm.prototype.makeCommandList = function() {
        const okText = TextManager.ok || "OK";
        const cancelText = TextManager.cancel || "Cancel";
        this.addCommand(okText, "ok");
        this.addCommand(cancelText, "cancel");
    };

    Window_DeleteConfirm.prototype.refresh = function() {
        Window_HorzCommand.prototype.refresh.call(this);
        // Draw message after contents is ready
        if (this.contents && this._message) {
            this.drawMessage();
        }
    };

    Window_DeleteConfirm.prototype.drawMessage = function() {
        // Draw message at the top - only if contents sprite and message exist
        if (!this._contentsSprite || !this._contentsSprite.bitmap || !this._message) {
            return;
        }
        
        try {
            const padding = this.itemPadding();
            const messageLines = this.calculateMessageLines();
            const messageHeight = messageLines * this.lineHeight();
            const contentsWidth = this.contentsWidth();
            const rect = new Rectangle(padding, padding, contentsWidth - padding * 2, messageHeight);
            
            const originalFontSize = this.contents.fontSize;
            const originalColor = this.contents.textColor;
            
            this.contents.fontSize = 20;
            this.changeTextColor('#ffffff');
            this.drawText(this._message, rect.x, rect.y, rect.width, 'center');
            
            // Reset font
            this.contents.fontSize = originalFontSize;
            this.changeTextColor(originalColor);
        } catch (e) {
            CabbyCodes.error('[CabbyCodes] Error drawing message: ' + (e.message || e));
        }
    };

    Window_DeleteConfirm.prototype.messageHeight = function() {
        const messageLines = this.calculateMessageLines();
        return messageLines * this.lineHeight();
    };

    Window_DeleteConfirm.prototype.callOkHandler = function() {
        // Override to ensure correct handler is called based on current symbol
        // Get the symbol of the currently selected item
        const symbol = this.currentSymbol();
        
        // Directly call the handler for the selected item's symbol
        if (symbol && this.isHandled(symbol)) {
            this.callHandler(symbol);
        } else {
            // If no handler for this symbol, use parent behavior
            Window_HorzCommand.prototype.callOkHandler.call(this);
        }
    };
    
    Window_DeleteConfirm.prototype.processOk = function() {
        // Don't call parent processOk - we'll handle it ourselves
        if (this.isCurrentItemEnabled()) {
            this.playOkSound();
            this.updateInputData();
            this.deactivate();
            // Call our custom callOkHandler which routes based on symbol
            this.callOkHandler();
        } else {
            this.playBuzzerSound();
        }
    };

    Window_DeleteConfirm.prototype.itemRect = function(index) {
        // Override to position buttons horizontally below the message
        if (index < 0 || index >= this.maxItems()) {
            return new Rectangle(0, 0, 0, 0);
        }
        
        const padding = this.itemPadding ? this.itemPadding() : 8;
        // Calculate actual message height based on lines
        const messageLines = this.calculateMessageLines ? this.calculateMessageLines() : 1;
        const lineHeight = this.lineHeight ? this.lineHeight() : 36;
        const messageHeight = (lineHeight * messageLines) + padding;
        const buttonY = padding + messageHeight + padding;
        const buttonHeight = this.itemHeight();
        const contentsWidth = this.contentsWidth ? this.contentsWidth() : (this.width - this.padding * 2);
        
        // Calculate button width for horizontal layout (2 buttons side by side)
        const maxCols = this.maxCols ? this.maxCols() : 2;
        const buttonWidth = Math.floor((contentsWidth - padding * 2 - padding * (maxCols - 1)) / maxCols);
        const col = index % maxCols;
        
        const rect = new Rectangle(
            padding + (col * (buttonWidth + padding)),
            buttonY,
            buttonWidth,
            buttonHeight
        );
        return rect;
    };

    Window_DeleteConfirm.prototype.drawItem = function(index) {
        // Override to draw buttons properly
        const rect = this.itemRect(index);
        const command = this.commandName(index);
        const align = this.itemTextAlign();
        this.resetTextColor();
        this.changePaintOpacity(this.isCommandEnabled(index));
        this.drawText(command, rect.x, rect.y, rect.width, align);
    };

    Window_DeleteConfirm.prototype.drawShape = function(graphics) {
        // Override to draw square corners instead of rounded
        if (graphics) {
            const width = this.width;
            const height = (this.height * this._openness) / 255;
            const x = this.x;
            const y = this.y + (this.height - height) / 2;
            graphics.beginFill(0xffffff);
            graphics.drawRect(x, y, width, height); // drawRect instead of drawRoundedRect for square corners
            graphics.endFill();
        }
    };

    Window_DeleteConfirm.prototype.onOk = function() {
        // Handler for "ok" symbol - user confirmed deletion
        SoundManager.playOk();
        this.deactivate();
        if (_deleteConfirmCallback) {
            const callback = _deleteConfirmCallback;
            _deleteConfirmCallback = null; // Clear callback immediately to prevent double-call
            this.close();
            callback(true);
            // Reactivate list window immediately
            const scene = SceneManager._scene;
            if (scene && scene._listWindow) {
                scene._listWindow.activate();
            }
        } else {
            this.close();
        }
    };

    Window_DeleteConfirm.prototype.onCancel = function() {
        // Handler for "cancel" symbol - user cancelled deletion
        SoundManager.playCancel();
        this.deactivate();
        if (_deleteConfirmCallback) {
            const callback = _deleteConfirmCallback;
            _deleteConfirmCallback = null; // Clear callback immediately to prevent double-call
            this.close();
            callback(false);
            // Reactivate list window immediately
            const scene = SceneManager._scene;
            if (scene && scene._listWindow) {
                scene._listWindow.activate();
            }
        } else {
            this.close();
        }
    };

    Window_DeleteConfirm.prototype.update = function() {
        // Check if window is still valid before updating
        if (!this._container) {
            // Window has been destroyed, don't update
            return;
        }
        Window_HorzCommand.prototype.update.call(this);
        // Cleanup is handled in the scene update loop
    };

    /**
     * Show confirmation dialog
     * @param {string} message - The confirmation message
     * @param {Function} callback - Callback function(result) called with true if confirmed, false if cancelled
     */
    function showConfirmDialog(message, callback) {
        const scene = SceneManager._scene;
        if (!scene || !(scene instanceof Scene_File)) {
            // Fallback to browser confirm if not in a file scene
            const result = confirm(message);
            if (callback) callback(result);
            return;
        }

        // Close any existing confirm window
        if (_deleteConfirmWindow) {
            try {
                // Check if window is still valid
                if (_deleteConfirmWindow._container && _deleteConfirmWindow.parent) {
                    if (scene._windowLayer) {
                        scene._windowLayer.removeChild(_deleteConfirmWindow);
                    }
                    // Properly destroy the window to clean up resources
                    _deleteConfirmWindow.destroy();
                }
            } catch (e) {
                // Window might already be removed or destroyed, ignore
            }
            _deleteConfirmWindow = null;
            _deleteConfirmCallback = null;
        }

        try {
            // Create the confirmation window
            _deleteConfirmWindow = new Window_DeleteConfirm(message);
            _deleteConfirmCallback = callback;
            
            // Add window to scene
            scene.addWindow(_deleteConfirmWindow);
            
            // Ensure the window is visible
            _deleteConfirmWindow.visible = true;
            _deleteConfirmWindow.show();
            
            // Open the window (this triggers proper initialization)
            _deleteConfirmWindow.open();
            
            // Force it to be fully open immediately (skip animation)
            _deleteConfirmWindow.openness = 255;
            _deleteConfirmWindow._opening = false;
            _deleteConfirmWindow._closing = false;
            
            // Ensure contents exist and are refreshed
            if (!_deleteConfirmWindow.contents || !_deleteConfirmWindow._contentsSprite) {
                _deleteConfirmWindow.createContents();
            }
            _deleteConfirmWindow.refresh();
            
            // Ensure window is active and can receive input
            _deleteConfirmWindow.activate();
            _deleteConfirmWindow.select(0);
            
            // Force update to render
            _deleteConfirmWindow.update();
            
            // Move to top of window layer
            if (scene._windowLayer && _deleteConfirmWindow.parent) {
                const children = scene._windowLayer.children;
                if (children.length > 0) {
                    scene._windowLayer.setChildIndex(_deleteConfirmWindow, children.length - 1);
                }
            }
            
            // Deactivate the list window while confirmation is showing
            const listWindow = scene._listWindow;
            if (listWindow) {
                listWindow.deactivate();
            }
            
        } catch (e) {
            CabbyCodes.error('[CabbyCodes] Error creating confirmation window: ' + (e.message || e));
            // Fallback to browser confirm on error
            const result = confirm(message);
            if (callback) callback(result);
        }
    }

    /**
     * Clean up confirmation window reference
     * Call this when the scene is destroyed or changed
     */
    function cleanupConfirmWindow() {
        if (_deleteConfirmWindow) {
            try {
                // Check if window is still valid before accessing properties
                if (_deleteConfirmWindow._container) {
                    if (_deleteConfirmWindow.parent) {
                        const scene = SceneManager._scene;
                        if (scene && scene._windowLayer) {
                            scene._windowLayer.removeChild(_deleteConfirmWindow);
                        }
                    }
                    // Properly destroy the window to clean up resources
                    _deleteConfirmWindow.destroy();
                }
            } catch (e) {
                // Window might already be destroyed, ignore
            }
            _deleteConfirmWindow = null;
            _deleteConfirmCallback = null;
        }
    }

    // Update confirmation window in scene update loop
    CabbyCodes.after(
        Scene_File.prototype,
        'update',
        function() {
            if (_deleteConfirmWindow) {
                try {
                    // Check if window is still valid before updating
                    if (_deleteConfirmWindow._container) {
                        _deleteConfirmWindow.update();
                        
                        // Clean up if window is fully closed
                        if (_deleteConfirmWindow.isClosed() && _deleteConfirmWindow.openness === 0) {
                            cleanupConfirmWindow();
                        }
                    } else {
                        // Window is destroyed but we still have a reference - clean it up
                        cleanupConfirmWindow();
                    }
                } catch (e) {
                    // Window might be destroyed, clean up reference
                    CabbyCodes.warn('[CabbyCodes] Error updating confirm window, cleaning up: ' + (e.message || e));
                    cleanupConfirmWindow();
                }
            }
        }
    );

    // Clean up when leaving the file scene
    CabbyCodes.before(
        Scene_File.prototype,
        'stop',
        function() {
            cleanupConfirmWindow();
        }
    );

    /**
     * Delete a save file
     * @param {number} savefileId - The save file ID to delete
     * @param {Window_SavefileList} window - The savefile list window
     */
    function deleteSaveFile(savefileId, window) {
        const saveName = DataManager.makeSavename(savefileId);
        
        // Remove the save file (synchronous for local, async for forage)
        const removeResult = StorageManager.remove(saveName);
        
        // Handle async removal if it returns a Promise
        const finishDelete = () => {
            // Remove from global info (set to null for array)
            if (DataManager._globalInfo) {
                DataManager._globalInfo[savefileId] = null;
                DataManager.saveGlobalInfo();
            }
            
            // Refresh the list window
            window.refresh();
            
            // Play sound
            SoundManager.playCursor();
        };
        
        // If it's a Promise, wait for it; otherwise finish immediately
        if (removeResult && typeof removeResult.then === 'function') {
            removeResult.then(finishDelete).catch(err => {
                CabbyCodes.error('[CabbyCodes] Error deleting save file: ' + (err.message || err));
                finishDelete(); // Still update UI even if deletion failed
            });
        } else {
            finishDelete();
        }
    }

    // Enable on both load and save screens
    CabbyCodes.override(
        Window_SavefileList.prototype,
        'drawItem',
        function(index) {
            // Call original drawItem first
            CabbyCodes.callOriginal(Window_SavefileList.prototype, 'drawItem', this, [index]);
            
            // Draw delete button on both load and save screens (only for existing saves)
            drawDeleteButton(this, index);
        }
    );

    // Handle input for delete button clicks (works on both load and save screens)
    CabbyCodes.override(
        Window_SavefileList.prototype,
        'processTouch',
        function() {
            // Handle delete button clicks on both load and save screens
            if (TouchInput.isTriggered()) {
                const touchPos = new Point(TouchInput.x, TouchInput.y);
                const localPos = this.worldTransform.applyInverse(touchPos);
                
                // Check if click is within the inner rect (contents area)
                if (this.innerRect.contains(localPos.x, localPos.y)) {
                    const cx = this.origin.x + localPos.x - this.padding;
                    const cy = this.origin.y + localPos.y - this.padding;
                    
                    // Check each visible item for delete button hit
                    const topIndex = this.topIndex();
                    for (let i = 0; i < this.maxVisibleItems(); i++) {
                        const index = topIndex + i;
                        if (index < this.maxItems()) {
                            const savefileId = this.indexToSavefileId(index);
                            const isEnabled = this.isEnabled(savefileId);
                            
                            // Only allow deletion of existing saves (enabled items)
                            if (isEnabled && isPointInDeleteButton(this, index, cx, cy)) {
                                try {
                                    // Clear the touch input first to prevent it from also triggering item selection
                                    TouchInput.clear();
                                    
                                    // Show confirmation dialog
                                    const savefileName = savefileId === 0 ? (TextManager.autosave || "Autosave") : (TextManager.file || "File") + " " + savefileId;
                                    const confirmMessage = `Delete ${savefileName}?`;
                                    
                                    // Show confirmation dialog
                                    showConfirmDialog(confirmMessage, (confirmed) => {
                                        try {
                                            if (confirmed) {
                                                deleteSaveFile(savefileId, this);
                                            }
                                        } catch (e) {
                                            CabbyCodes.error('[CabbyCodes] Error in delete callback: ' + (e.message || e));
                                        }
                                    });
                                } catch (e) {
                                    CabbyCodes.error('[CabbyCodes] Error handling delete button click: ' + (e.message || e));
                                }
                                
                                // Don't call original processTouch - we've handled it
                                return;
                            }
                        }
                    }
                }
            }
            
            // Call original processTouch for normal item selection
            CabbyCodes.callOriginal(Window_SavefileList.prototype, 'processTouch', this, []);
        }
    );

    // Hook into Scene_Save.onSavefileOk to add confirmation for overwriting
    CabbyCodes.override(
        Scene_Save.prototype,
        'onSavefileOk',
        function() {
            const savefileId = this.savefileId();
            
            // Check if save file already exists
            if (DataManager.savefileExists && DataManager.savefileExists(savefileId)) {
                // Save file exists - show confirmation dialog
                const savefileName = savefileId === 0 ? (TextManager.autosave || "Autosave") : (TextManager.file || "File") + " " + savefileId;
                const confirmMessage = `Overwrite ${savefileName}?`;
                
                // Deactivate list window while confirmation is showing
                if (this._listWindow) {
                    this._listWindow.deactivate();
                }
                
                // Store scene reference for callback
                const scene = this;
                
                // Show confirmation dialog
                showConfirmDialog(confirmMessage, (confirmed) => {
                    
                    // Reactivate list window
                    if (scene._listWindow) {
                        scene._listWindow.activate();
                    }
                    
                    if (confirmed) {
                        // User confirmed - proceed with save by calling the original method
                        // Call parent first (onSavefileOk), then executeSave if enabled
                        Scene_File.prototype.onSavefileOk.call(scene);
                        if (scene.isSavefileEnabled(savefileId)) {
                            scene.executeSave(savefileId);
                        } else {
                            scene.onSaveFailure();
                        }
                    }
                    // If cancelled, do nothing (just return without saving)
                });
                
                // Don't call original - we'll handle it in the callback
                return;
            }
            
            // Save file doesn't exist - call original method to proceed with save
            CabbyCodes.callOriginal(Scene_Save.prototype, 'onSavefileOk', this, []);
        }
    );

    CabbyCodes.log('[CabbyCodes] Delete save feature loaded');
})();

