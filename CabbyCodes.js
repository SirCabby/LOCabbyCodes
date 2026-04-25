//=============================================================================
// CabbyCodes Loader
//=============================================================================
/*:
 * @target MZ
 * @plugindesc CabbyCodes Mod Loader - Loads all CabbyCodes mod files
 * @author CabbyCodes
 * @help
 * This plugin loads all CabbyCodes mod files from the CabbyCodes folder.
 * 
 * Installation:
 * 1. Copy this file to js/plugins/CabbyCodes.js
 * 2. Copy the CabbyCodes folder to js/plugins/CabbyCodes/
 * 3. Add this plugin to js/plugins.js
 */

(() => {
    'use strict';

    const pluginName = "CabbyCodes";
    
    // Load all scripts from the CabbyCodes folder
    function loadCabbyCodesScripts() {
        // List of scripts to load in order
        const scripts = [
            'cabbycodes-core.js',
            'cabbycodes-logger.js',
            'cabbycodes-debug.js',
            'cabbycodes-patches.js',
            'cabbycodes-session-state.js',
            'cabbycodes-settings.js',
            'cabbycodes-book-ui.js',
            'cabbycodes-enemy-health-bars.js',
            'cabbycodes-version-display.js',
            'cabbycodes-hidden-stats-display.js',
            'cabbycodes-clock-display.js',
            'cabbycodes-cookbook.js',
            'cabbycodes-recipe-book.js',
            'cabbycodes-oven-checkboxes.js',
            'cabbycodes-craft-checkboxes.js',
            'cabbycodes-oven-navigation.js',
            'cabbycodes-refill-status.js',
            'cabbycodes-save-anywhere.js',
            'cabbycodes-delete-save.js',
            'cabbycodes-infinite-money.js',
            'cabbycodes-invincibility.js',
            'cabbycodes-one-hit-kill.js',
            'cabbycodes-never-miss.js',
            'cabbycodes-status-immunity.js',
            'cabbycodes-always-escape.js',
            'cabbycodes-stamina.js',
            'cabbycodes-exp-rate.js',
            'cabbycodes-infinite-consumables.js',
            'cabbycodes-unbreakable-items.js',
            'cabbycodes-unstick-equipment.js',
            'cabbycodes-infinite-ammo.js',
            'cabbycodes-friendly-door-visitors.js',
            'cabbycodes-free-vending.js',
            'cabbycodes-free-merchants.js',
            'cabbycodes-doorbell.js',
            'cabbycodes-freeze-time.js',
            'cabbycodes-time-advance-logger.js',
            'cabbycodes-freeze-hygiene.js',
            'cabbycodes-item-giver.js',
            'cabbycodes-set-time.js',
            'cabbycodes-set-danger.js',
            'cabbycodes-set-difficulty.js',
            'cabbycodes-max-cooking.js',
            'cabbycodes-item-editor.js',
            'cabbycodes-money-editor.js',
            'cabbycodes-story-flags.js',
            'cabbycodes-video-games.js',
            'cabbycodes-fast-credits.js'
        ];
        
        scripts.forEach((scriptName) => {
            const script = document.createElement('script');
            script.type = 'text/javascript';
            script.src = `js/plugins/CabbyCodes/${scriptName}`;
            script.async = false;
            script.defer = false;
            
            // Handle load errors gracefully
            script.onerror = function() {
                console.warn(`[CabbyCodes] Failed to load: ${scriptName}`);
            };
            
            document.body.appendChild(script);
        });
    }
    
    // Wait for PluginManager to be available, then load scripts
    if (typeof PluginManager !== 'undefined') {
        // PluginManager is already loaded, load immediately
        loadCabbyCodesScripts();
    } else {
        // Wait for PluginManager to be defined
        const checkPluginManager = setInterval(() => {
            if (typeof PluginManager !== 'undefined') {
                clearInterval(checkPluginManager);
                loadCabbyCodesScripts();
            }
        }, 10);
        
        // Timeout after 5 seconds
        setTimeout(() => {
            clearInterval(checkPluginManager);
            console.error('[CabbyCodes] PluginManager not found after 5 seconds');
        }, 5000);
    }
})();

