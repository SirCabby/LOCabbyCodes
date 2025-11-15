//=============================================================================
// CabbyCodes Logger
//=============================================================================
/*:
 * @target MZ
 * @plugindesc CabbyCodes Logger - Writes CabbyCodes output to CabbyCodes.log
 * @author CabbyCodes
 * @help
 * Redirects CabbyCodes log/warn/error calls to both the original console
 * output and a persistent CabbyCodes.log file inside the game directory.
 */

(() => {
    'use strict';

    if (typeof window.CabbyCodes === 'undefined') {
        return;
    }

    const canRequire = typeof window.require === 'function' && typeof window.process === 'object';
    if (!canRequire) {
        CabbyCodes.warn('[CabbyCodes] Logger unavailable: no filesystem access.');
        return;
    }

    let fs;
    let path;
    try {
        fs = window.require('fs');
        path = window.require('path');
    } catch (e) {
        CabbyCodes.error(`[CabbyCodes] Logger failed to load filesystem modules: ${e?.message || e}`);
        return;
    }

    const rootDir = (() => {
        try {
            const mainModule = window.process?.mainModule;
            if (mainModule && mainModule.filename) {
                return path.dirname(mainModule.filename);
            }
        } catch (e) {
            CabbyCodes.warn(`[CabbyCodes] Logger could not resolve root path: ${e?.message || e}`);
        }
        return null;
    })();

    if (!rootDir) {
        CabbyCodes.warn('[CabbyCodes] Logger disabled: unable to determine game directory.');
        return;
    }

    const logPath = path.join(rootDir, 'CabbyCodes.log');

    function formatLine(level, message) {
        const timestamp = new Date().toISOString();
        return `[${timestamp}] [${level}] ${message}\n`;
    }

    function appendLine(level, message) {
        const line = formatLine(level, message);
        try {
            fs.appendFileSync(logPath, line, { encoding: 'utf8' });
        } catch (e) {
            console.error(`[CabbyCodes] Failed to write log file: ${e?.message || e}`);
        }
    }

    function wrapLogger(originalFn, level) {
        return function(message) {
            appendLine(level, message);
            if (typeof originalFn === 'function') {
                originalFn.call(CabbyCodes, message);
            }
        };
    }

    CabbyCodes.getLogFilePath = function() {
        return logPath;
    };

    CabbyCodes.log = wrapLogger(CabbyCodes.log, 'INFO');
    CabbyCodes.warn = wrapLogger(CabbyCodes.warn, 'WARN');
    CabbyCodes.error = wrapLogger(CabbyCodes.error, 'ERROR');

    CabbyCodes.log('[CabbyCodes] Logger initialized');
})();


