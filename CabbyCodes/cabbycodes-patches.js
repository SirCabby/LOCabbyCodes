//=============================================================================
// CabbyCodes Patches
//=============================================================================
/*:
 * @target MZ
 * @plugindesc CabbyCodes Patches - Function patching utilities
 * @author CabbyCodes
 * @help
 * Provides utilities for patching game functions with overrides and hooks.
 */

(() => {
    'use strict';

    // Ensure CabbyCodes namespace exists
    if (typeof window.CabbyCodes === 'undefined') {
        window.CabbyCodes = {};
    }
    
    /**
     * Override a function completely
     * @param {Object} target - The object containing the function
     * @param {string} functionName - Name of the function to override
     * @param {Function} newFunction - The new function to replace it with
     * @param {string} settingKey - Optional setting key to check before applying
     */
    CabbyCodes.override = function(target, functionName, newFunction, settingKey = null) {
        if (!target || typeof target[functionName] !== 'function') {
            console.warn(`[CabbyCodes] Cannot override ${functionName}: function not found`);
            return;
        }
        
        // Check setting if provided
        if (settingKey && !CabbyCodes.getSetting(settingKey, false)) {
            return; // Setting is disabled, don't apply override
        }
        
        const original = target[functionName];
        target[functionName] = newFunction;
        
        // Store original for potential restoration
        if (!target._cabbycodesOriginals) {
            target._cabbycodesOriginals = {};
        }
        target._cabbycodesOriginals[functionName] = original;
        
        console.log(`[CabbyCodes] Overridden: ${functionName}`);
    };
    
    /**
     * Add a before hook (runs before the original function)
     * @param {Object} target - The object containing the function
     * @param {string} functionName - Name of the function to hook
     * @param {Function} hookFunction - Function to run before the original
     * @param {string} settingKey - Optional setting key to check before applying
     */
    CabbyCodes.before = function(target, functionName, hookFunction, settingKey = null) {
        if (!target || typeof target[functionName] !== 'function') {
            console.warn(`[CabbyCodes] Cannot hook before ${functionName}: function not found`);
            return;
        }
        
        // Check setting if provided
        if (settingKey && !CabbyCodes.getSetting(settingKey, false)) {
            return; // Setting is disabled, don't apply hook
        }
        
        const original = target[functionName];
        
        target[functionName] = function(...args) {
            // Run the hook function first
            hookFunction.apply(this, args);
            // Then run the original function
            return original.apply(this, args);
        };
        
        // Store original for potential restoration
        if (!target._cabbycodesOriginals) {
            target._cabbycodesOriginals = {};
        }
        target._cabbycodesOriginals[functionName] = original;
        
        console.log(`[CabbyCodes] Before hook added: ${functionName}`);
    };
    
    /**
     * Add an after hook (runs after the original function)
     * @param {Object} target - The object containing the function
     * @param {string} functionName - Name of the function to hook
     * @param {Function} hookFunction - Function to run after the original
     * @param {string} settingKey - Optional setting key to check before applying
     */
    CabbyCodes.after = function(target, functionName, hookFunction, settingKey = null) {
        if (!target || typeof target[functionName] !== 'function') {
            console.warn(`[CabbyCodes] Cannot hook after ${functionName}: function not found`);
            return;
        }
        
        // Check setting if provided
        if (settingKey && !CabbyCodes.getSetting(settingKey, false)) {
            return; // Setting is disabled, don't apply hook
        }
        
        const original = target[functionName];
        
        target[functionName] = function(...args) {
            // Run the original function first
            const result = original.apply(this, args);
            // Then run the hook function
            hookFunction.apply(this, args);
            // Return the original result
            return result;
        };
        
        // Store original for potential restoration
        if (!target._cabbycodesOriginals) {
            target._cabbycodesOriginals = {};
        }
        target._cabbycodesOriginals[functionName] = original;
        
        console.log(`[CabbyCodes] After hook added: ${functionName}`);
    };
    
    /**
     * Restore an original function (removes hooks/overrides)
     * @param {Object} target - The object containing the function
     * @param {string} functionName - Name of the function to restore
     */
    CabbyCodes.restore = function(target, functionName) {
        if (!target || !target._cabbycodesOriginals || !target._cabbycodesOriginals[functionName]) {
            console.warn(`[CabbyCodes] Cannot restore ${functionName}: original not found`);
            return;
        }
        
        target[functionName] = target._cabbycodesOriginals[functionName];
        delete target._cabbycodesOriginals[functionName];
        
        console.log(`[CabbyCodes] Restored: ${functionName}`);
    };
    
    console.log('[CabbyCodes] Patches module loaded');
})();

