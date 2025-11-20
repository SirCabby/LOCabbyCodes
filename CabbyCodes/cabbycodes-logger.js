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

    /**
     * Log levels: DEBUG < INFO < WARN < ERROR
     * By default, only WARN and ERROR are logged.
     */
    const LOG_LEVELS = {
        DEBUG: 0,
        INFO: 1,
        WARN: 2,
        ERROR: 3
    };
    
    /**
     * Get the current minimum log level based on debugLoggingEnabled setting.
     * @returns {number} Minimum log level (WARN by default, DEBUG if debug logging enabled)
     */
    function getMinLogLevel() {
        return CabbyCodes.debugLoggingEnabled ? LOG_LEVELS.DEBUG : LOG_LEVELS.WARN;
    }
    
    function formatLine(levelName, message) {
        const timestamp = new Date().toISOString();
        return `[${timestamp}] [${levelName}] ${message}\n`;
    }

    function appendLine(level, levelName, message, includeStackTrace = false) {
        const minLevel = getMinLogLevel();
        if (level < minLevel) {
            return; // Don't log if below minimum level
        }
        
        try {
            const line = formatLine(levelName, message);
            fs.appendFileSync(logPath, line, { encoding: 'utf8' });
            
            // For errors, always include stack trace
            if (includeStackTrace || level === LOG_LEVELS.ERROR) {
                let stackTrace = '';
                if (message instanceof Error && message.stack) {
                    stackTrace = message.stack;
                } else {
                    // Create an Error to get stack trace
                    const error = new Error(message);
                    if (error.stack) {
                        stackTrace = error.stack;
                    }
                }
                
                if (stackTrace) {
                    // Indent stack trace lines
                    const stackLines = stackTrace.split('\n').map(line => `    ${line}`).join('\n');
                    fs.appendFileSync(logPath, stackLines + '\n', { encoding: 'utf8' });
                }
            }
        } catch (e) {
            console.error(`[CabbyCodes] Failed to write log file: ${e?.message || e}`);
        }
    }

    function wrapLogger(originalFn, level, levelName) {
        return function(message) {
            // Check if we should log this level
            const minLevel = getMinLogLevel();
            if (level >= minLevel) {
                appendLine(level, levelName, message, level === LOG_LEVELS.ERROR);
            }
            
            if (typeof originalFn === 'function') {
                originalFn.call(CabbyCodes, message);
            }
        };
    }

    CabbyCodes.getLogFilePath = function() {
        return logPath;
    };

    // Store original functions before wrapping
    const originalLog = CabbyCodes.log;
    const originalWarn = CabbyCodes.warn;
    const originalError = CabbyCodes.error;

    CabbyCodes.log = wrapLogger(originalLog, LOG_LEVELS.INFO, 'INFO');
    CabbyCodes.warn = wrapLogger(originalWarn, LOG_LEVELS.WARN, 'WARN');
    CabbyCodes.error = wrapLogger(originalError, LOG_LEVELS.ERROR, 'ERROR');

    CabbyCodes.log('[CabbyCodes] Logger initialized');
})();



