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
    
    // Track applied patches for debugging
    CabbyCodes._appliedPatches = CabbyCodes._appliedPatches || [];
    CabbyCodes._duplicatePatchWarnings = CabbyCodes._duplicatePatchWarnings || new Set();

    // Per-call stack of the chainedFunction currently executing. Lets
    // CabbyCodes.callOriginal/callPrevious know which link of the chain invoked
    // them, so middle overrides delegate to their own previous link instead of
    // to the outermost wrapper (which would recurse forever).
    CabbyCodes._overrideCallStack = CabbyCodes._overrideCallStack || [];
    
    /**
     * Log patch application for debugging
     */
    function logPatch(type, target, functionName, settingKey) {
        const targetName = target.constructor?.name || 'Unknown';
        const patchInfo = {
            type: type,
            target: targetName,
            function: functionName,
            setting: settingKey,
            timestamp: Date.now()
        };
        CabbyCodes._appliedPatches.push(patchInfo);
        CabbyCodes.log(`[CabbyCodes] Patch applied: ${type} on ${targetName}.${functionName}${settingKey ? ` (setting: ${settingKey})` : ''}`);
        
        // Check for duplicate patches
        const duplicates = CabbyCodes._appliedPatches.filter(p => 
            p.target === targetName && 
            p.function === functionName && 
            p !== patchInfo
        );
        if (duplicates.length > 0) {
            const duplicateKey = `${targetName}.${functionName}`;
            const alreadyWarned = CabbyCodes._duplicatePatchWarnings.has(duplicateKey);
            const logFn = alreadyWarned ? CabbyCodes.log : CabbyCodes.warn;
            logFn(`[CabbyCodes] ${alreadyWarned ? 'NOTICE' : 'WARNING'}: Multiple patches detected on ${targetName}.${functionName}:`);
            duplicates.forEach(dup => {
                logFn(`[CabbyCodes]   - ${dup.type} patch applied at ${new Date(dup.timestamp).toISOString()}`);
            });
            logFn(`[CabbyCodes]   - ${type} patch applied now`);
            if (!alreadyWarned) {
                CabbyCodes._duplicatePatchWarnings.add(duplicateKey);
            }
        }
    }
    
    /**
     * Get the true original function from the chain
     * @param {Object} target - The object containing the function
     * @param {string} functionName - Name of the function
     * @returns {Function|null} The original function or null if not found
     */
    function getTrueOriginal(target, functionName) {
        if (!target._cabbycodesOriginals) {
            return null;
        }
        
        // The true original is always stored in _cabbycodesOriginals[functionName]
        // This is set only on the first override and never overwritten
        const original = target._cabbycodesOriginals[functionName];
        if (original && typeof original === 'function') {
            return original;
        }
        
        return null;
    }
    
    /**
     * Get the previous function in the override chain
     * @param {Function} currentFunction - The current function
     * @returns {Function|null} The previous function in the chain
     */
    function getPreviousInChain(currentFunction) {
        if (currentFunction && currentFunction._cabbycodesIsOverride && currentFunction._cabbycodesOriginal) {
            return currentFunction._cabbycodesOriginal;
        }
        return null;
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
            CabbyCodes.warn(`[CabbyCodes] Cannot override ${functionName}: function not found`);
            return;
        }
        
        // Check setting if provided
        if (settingKey && !CabbyCodes.getSetting(settingKey, false)) {
            return; // Setting is disabled, don't apply override
        }
        
        const currentFunction = target[functionName];
        
        // Initialize originals storage if needed
        if (!target._cabbycodesOriginals) {
            target._cabbycodesOriginals = {};
        }
        
        // If this is the first override, store the true original
        if (!target._cabbycodesOriginals[functionName]) {
            target._cabbycodesOriginals[functionName] = currentFunction;
        }
        
        // Check if current function is already an override
        const isCurrentAnOverride = currentFunction._cabbycodesIsOverride === true;
        
        // Create a wrapper that chains properly
        // If current is an override, we need to make sure our override can call it via callPrevious
        const chainedFunction = function(...args) {
            CabbyCodes._overrideCallStack.push(chainedFunction);
            try {
                return newFunction.apply(this, args);
            } finally {
                CabbyCodes._overrideCallStack.pop();
            }
        };

        // Mark this as an override and store the previous function in the chain
        chainedFunction._cabbycodesIsOverride = true;
        chainedFunction._cabbycodesOriginal = currentFunction;
        
        // Wrap the chained function with debugging if available
        const wrappedFunction = (typeof CabbyCodes.debugWrap === 'function') 
            ? CabbyCodes.debugWrap(target, functionName, chainedFunction)
            : chainedFunction;
        
        // Preserve the override marker
        if (wrappedFunction !== chainedFunction) {
            wrappedFunction._cabbycodesIsOverride = true;
            wrappedFunction._cabbycodesOriginal = currentFunction;
        }
        
        target[functionName] = wrappedFunction;
        
        logPatch('override', target, functionName, settingKey);
    };
    
    /**
     * Helper function to call the original function from within an override
     * This properly handles chained overrides by calling the previous override
     * in the chain if one exists, otherwise the true original
     * @param {Object} target - The object containing the function
     * @param {string} functionName - Name of the function
     * @param {Object} context - The 'this' context to use
     * @param {Array} args - Arguments to pass to the original function
     * @returns {*} The return value of the original function
     */
    CabbyCodes.callOriginal = function(target, functionName, context, args) {
        // Delegate to the link directly below whichever override is currently
        // executing. Reading target[fn] instead would always return the
        // outermost wrapper and make middle overrides recurse into themselves.
        const stack = CabbyCodes._overrideCallStack;
        const activeLink = stack && stack.length > 0 ? stack[stack.length - 1] : null;
        if (activeLink && typeof activeLink._cabbycodesOriginal === 'function') {
            return activeLink._cabbycodesOriginal.apply(context, args);
        }

        // No active override on the stack — fall back to the true original.
        const original = getTrueOriginal(target, functionName);
        if (original && typeof original === 'function') {
            return original.apply(context, args);
        }

        return undefined;
    };
    
    /**
     * Helper function to call the true original function, bypassing all overrides
     * Use this when you specifically need the original game function, not any overrides
     * @param {Object} target - The object containing the function
     * @param {string} functionName - Name of the function
     * @param {Object} context - The 'this' context to use
     * @param {Array} args - Arguments to pass to the original function
     * @returns {*} The return value of the original function
     */
    CabbyCodes.callTrueOriginal = function(target, functionName, context, args) {
        const original = getTrueOriginal(target, functionName);
        if (original && typeof original === 'function') {
            return original.apply(context, args);
        }
        
        return undefined;
    };
    
    /**
     * Helper function to call the previous override in the chain
     * This allows overrides to call the previous override instead of the true original
     * @param {Object} target - The object containing the function
     * @param {string} functionName - Name of the function
     * @param {Object} context - The 'this' context to use
     * @param {Array} args - Arguments to pass to the previous function
     * @returns {*} The return value of the previous function
     */
    CabbyCodes.callPrevious = function(target, functionName, context, args) {
        return CabbyCodes.callOriginal(target, functionName, context, args);
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
            CabbyCodes.warn(`[CabbyCodes] Cannot hook before ${functionName}: function not found`);
            return;
        }
        
        // Check setting if provided
        if (settingKey && !CabbyCodes.getSetting(settingKey, false)) {
            return; // Setting is disabled, don't apply hook
        }
        
        const original = target[functionName];
        
        const wrappedFunction = function(...args) {
            // Run the hook function first
            hookFunction.apply(this, args);
            // Then run the original function
            return original.apply(this, args);
        };
        
        // Wrap with debugging if available
        const finalFunction = (typeof CabbyCodes.debugWrap === 'function')
            ? CabbyCodes.debugWrap(target, functionName, wrappedFunction)
            : wrappedFunction;
        
        target[functionName] = finalFunction;
        
        // Store original for potential restoration
        if (!target._cabbycodesOriginals) {
            target._cabbycodesOriginals = {};
        }
        target._cabbycodesOriginals[functionName] = original;
        
        logPatch('before', target, functionName, settingKey);
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
            CabbyCodes.warn(`[CabbyCodes] Cannot hook after ${functionName}: function not found`);
            return;
        }
        
        // Check setting if provided
        if (settingKey && !CabbyCodes.getSetting(settingKey, false)) {
            return; // Setting is disabled, don't apply hook
        }
        
        const original = target[functionName];
        
        const wrappedFunction = function(...args) {
            // Run the original function first
            const result = original.apply(this, args);
            // Then run the hook function
            hookFunction.apply(this, args);
            // Return the original result
            return result;
        };
        
        // Wrap with debugging if available
        const finalFunction = (typeof CabbyCodes.debugWrap === 'function')
            ? CabbyCodes.debugWrap(target, functionName, wrappedFunction)
            : wrappedFunction;
        
        target[functionName] = finalFunction;
        
        // Store original for potential restoration
        if (!target._cabbycodesOriginals) {
            target._cabbycodesOriginals = {};
        }
        target._cabbycodesOriginals[functionName] = original;
        
        logPatch('after', target, functionName, settingKey);
    };
    
    /**
     * Restore an original function (removes hooks/overrides)
     * @param {Object} target - The object containing the function
     * @param {string} functionName - Name of the function to restore
     */
    CabbyCodes.restore = function(target, functionName) {
        if (!target || !target._cabbycodesOriginals || !target._cabbycodesOriginals[functionName]) {
            CabbyCodes.warn(`[CabbyCodes] Cannot restore ${functionName}: original not found`);
            return;
        }
        
        target[functionName] = target._cabbycodesOriginals[functionName];
        delete target._cabbycodesOriginals[functionName];
        
        // Remove from patch tracking
        const targetName = target.constructor?.name || 'Unknown';
        CabbyCodes._appliedPatches = CabbyCodes._appliedPatches.filter(p => 
            !(p.target === targetName && p.function === functionName)
        );
        
        CabbyCodes.log(`[CabbyCodes] Restored: ${functionName}`);
    };
    
    /**
     * Get list of all applied patches (for debugging)
     */
    CabbyCodes.getAppliedPatches = function() {
        return CabbyCodes._appliedPatches.slice();
    };
    
    /**
     * Log all applied patches (for debugging)
     */
    CabbyCodes.logAppliedPatches = function() {
        CabbyCodes.log(`[CabbyCodes] Applied patches (${CabbyCodes._appliedPatches.length} total):`);
        CabbyCodes._appliedPatches.forEach((patch, idx) => {
            CabbyCodes.log(`[CabbyCodes]   ${idx + 1}. ${patch.type} on ${patch.target}.${patch.function}${patch.setting ? ` (${patch.setting})` : ''}`);
        });
    };
    
    CabbyCodes.log('[CabbyCodes] Patches module loaded');
})();

