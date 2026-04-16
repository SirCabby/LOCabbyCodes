//=============================================================================
// CabbyCodes Debug
//=============================================================================
/*:
 * @target MZ
 * @plugindesc CabbyCodes Debug - Debugging utilities for recursion detection
 * @author CabbyCodes
 * @help
 * Provides debugging utilities to detect infinite recursion and log stack traces.
 */

(() => {
    'use strict';

    if (typeof window.CabbyCodes === 'undefined') {
        window.CabbyCodes = {};
    }

    // Call stack tracking for recursion detection
    const callStacks = new Map();
    const callCounts = new Map();
    const recursionWarningsIssued = new Set();
    const MAX_STACK_DEPTH = 50;
    const RECURSION_THRESHOLD = 10;
    const recursionOverrides = new Map([
        // Game_Interpreter.update legitimately re-enters while events queue nested interpreters.
        // Only warn when the depth becomes extreme, and log as a warning instead of an error.
        [
            'Game_Interpreter.update',
            {
                threshold: 250,
                level: 'warn',
                includeStack: false,
                note: 'Large interpreter stacks are common when multiple parallel/child events are active.'
            }
        ]
    ]);

    /**
     * Get a unique identifier for a function call
     */
    function getCallId(target, functionName) {
        const targetName = target.constructor?.name || 'Unknown';
        return `${targetName}.${functionName}`;
    }

    /**
     * Track a function call entry
     */
    function getRecursionOverride(callId) {
        return recursionOverrides.get(callId) || null;
    }

    function getRecursionThreshold(callId) {
        return getRecursionOverride(callId)?.threshold ?? RECURSION_THRESHOLD;
    }

    function getRecursionLogger(override) {
        const level = override?.level || 'error';
        if (typeof CabbyCodes[level] === 'function') {
            return CabbyCodes[level];
        }
        return CabbyCodes.error;
    }

    function trackCallEntry(callId) {
        const stack = callStacks.get(callId) || [];
        stack.push(new Error().stack);
        
        if (stack.length > MAX_STACK_DEPTH) {
            stack.shift(); // Remove oldest entry
        }
        
        callStacks.set(callId, stack);
        
        // Track call count
        const count = callCounts.get(callId) || 0;
        callCounts.set(callId, count + 1);
        
        // Check for recursion
        const override = getRecursionOverride(callId);
        const threshold = override?.threshold ?? RECURSION_THRESHOLD;
        const shouldWarn =
            stack.length >= threshold && !recursionWarningsIssued.has(callId);
        if (shouldWarn) {
            recursionWarningsIssued.add(callId);
            const log = getRecursionLogger(override);
            log(`[CabbyCodes] Potential recursion detected: ${callId} called ${stack.length} times`);
            if (override?.note) {
                log(`[CabbyCodes]   Note: ${override.note}`);
            }
            if (override?.includeStack !== false) {
                log(`[CabbyCodes] Call stack for ${callId}:`);
                const detailCount = Number.isFinite(override?.stackEntries)
                    ? override.stackEntries
                    : 5;
                stack.slice(-detailCount).forEach((trace, idx) => {
                    log(`[CabbyCodes]   Call ${stack.length - detailCount + idx + 1}:`);
                    const lines = trace.split('\n').slice(0, 5);
                    lines.forEach(line => {
                        log(`[CabbyCodes]     ${line.trim()}`);
                    });
                });
            }
        }
        
        return stack.length;
    }

    /**
     * Track a function call exit
     */
    function trackCallExit(callId) {
        const stack = callStacks.get(callId);
        if (stack && stack.length > 0) {
            stack.pop();
            if (stack.length === 0) {
                recursionWarningsIssued.delete(callId);
            }
            callStacks.set(callId, stack);
        }
    }

    const STACK_OVERFLOW_RESET_DELAY_MS = 0;
    let stackOverflowLogging = false;

    function isStackOverflowError(error) {
        return (
            error instanceof RangeError &&
            typeof error.message === 'string' &&
            error.message.includes('Maximum call stack')
        );
    }

    function logStackOverflowError(callId, depth, error, functionName) {
        if (stackOverflowLogging) {
            return;
        }
        stackOverflowLogging = true;
        try {
            CabbyCodes.error(`[CabbyCodes] ========================================`);
            CabbyCodes.error(`[CabbyCodes] STACK OVERFLOW DETECTED`);
            CabbyCodes.error(`[CabbyCodes] ========================================`);
            CabbyCodes.error(`[CabbyCodes] Function: ${callId}`);
            CabbyCodes.error(`[CabbyCodes] Call depth when error occurred: ${depth}`);
            CabbyCodes.error(`[CabbyCodes] Total calls to this function: ${callCounts.get(callId) || 0}`);
            CabbyCodes.error(`[CabbyCodes] Error message: ${error.message}`);
            CabbyCodes.error(`[CabbyCodes] Full stack trace:`);
            const stackLines = error.stack?.split('\n') || [];
            stackLines.forEach(line => {
                CabbyCodes.error(`[CabbyCodes]   ${line.trim()}`);
            });
            
            const recentCalls = callStacks.get(callId) || [];
            if (recentCalls.length > 0) {
                CabbyCodes.error(`[CabbyCodes] Recent call history for ${callId} (showing last 3):`);
                recentCalls.slice(-3).forEach((trace, idx) => {
                    CabbyCodes.error(`[CabbyCodes]   --- Call ${recentCalls.length - 3 + idx + 1} ---`);
                    const lines = trace.split('\n').slice(0, 10);
                    lines.forEach(line => {
                        CabbyCodes.error(`[CabbyCodes]     ${line.trim()}`);
                    });
                });
            }
            
            CabbyCodes.error(`[CabbyCodes] Top 10 most called functions:`);
            const stats = CabbyCodes.getCallStats();
            stats.slice(0, 10).forEach(stat => {
                CabbyCodes.error(`[CabbyCodes]   ${stat.callId}: ${stat.totalCalls} calls, current depth: ${stat.currentDepth}`);
            });
            
            if (typeof CabbyCodes.getAppliedPatches === 'function') {
                const patches = CabbyCodes.getAppliedPatches();
                const relatedPatches = patches.filter(p => 
                    p.function === functionName || 
                    callId.includes(p.target) ||
                    callId.includes(p.function)
                );
                if (relatedPatches.length > 0) {
                    CabbyCodes.error(`[CabbyCodes] Related patches applied:`);
                    relatedPatches.forEach(patch => {
                        CabbyCodes.error(`[CabbyCodes]   - ${patch.type} on ${patch.target}.${patch.function}${patch.setting ? ` (${patch.setting})` : ''}`);
                    });
                }
            }
            
            CabbyCodes.error(`[CabbyCodes] ========================================`);
        } finally {
            setTimeout(() => {
                stackOverflowLogging = false;
            }, STACK_OVERFLOW_RESET_DELAY_MS);
        }
    }

    /**
     * Wrap a function with debugging
     */
    CabbyCodes.debugWrap = function(target, functionName, originalFunction) {
        const callId = getCallId(target, functionName);
        
        // Check if already wrapped to avoid double-wrapping
        if (originalFunction._cabbycodesDebugWrapped) {
            return originalFunction;
        }
        
        const wrappedFunction = function(...args) {
            const depth = trackCallEntry(callId);
            
            try {
                const result = originalFunction.apply(this, args);
                trackCallExit(callId);
                return result;
            } catch (error) {
                trackCallExit(callId);
                
                if (isStackOverflowError(error)) {
                    logStackOverflowError(callId, depth, error, functionName);
                }
                
                throw error;
            }
        };
        
        // Mark as wrapped to prevent double-wrapping
        wrappedFunction._cabbycodesDebugWrapped = true;
        
        // Preserve any override chain markers from the original function
        // This allows callOriginal to properly traverse the chain
        if (originalFunction._cabbycodesIsOverride !== undefined) {
            wrappedFunction._cabbycodesIsOverride = originalFunction._cabbycodesIsOverride;
        }
        if (originalFunction._cabbycodesOriginal !== undefined) {
            wrappedFunction._cabbycodesOriginal = originalFunction._cabbycodesOriginal;
        }
        
        return wrappedFunction;
    };

    /**
     * Get call statistics
     */
    CabbyCodes.getCallStats = function() {
        const stats = [];
        callCounts.forEach((count, callId) => {
            const depth = callStacks.get(callId)?.length || 0;
            stats.push({
                callId,
                totalCalls: count,
                currentDepth: depth
            });
        });
        return stats.sort((a, b) => b.totalCalls - a.totalCalls);
    };

    /**
     * Log call statistics
     */
    CabbyCodes.logCallStats = function() {
        const stats = CabbyCodes.getCallStats();
        CabbyCodes.log(`[CabbyCodes] Call statistics (top 20):`);
        stats.slice(0, 20).forEach(stat => {
            CabbyCodes.log(`[CabbyCodes]   ${stat.callId}: ${stat.totalCalls} total calls, depth: ${stat.currentDepth}`);
        });
    };

    /**
     * Clear call statistics
     */
    CabbyCodes.clearCallStats = function() {
        callStacks.clear();
        callCounts.clear();
        CabbyCodes.log('[CabbyCodes] Call statistics cleared');
    };

    /**
     * Global error handler to catch stack overflow errors
     */
    const originalErrorHandler = window.onerror;
    window.onerror = function(message, source, lineno, colno, error) {
        if (message && message.includes('Maximum call stack')) {
            CabbyCodes.error(`[CabbyCodes] ========================================`);
            CabbyCodes.error(`[CabbyCodes] GLOBAL STACK OVERFLOW DETECTED`);
            CabbyCodes.error(`[CabbyCodes] ========================================`);
            CabbyCodes.error(`[CabbyCodes] Message: ${message}`);
            CabbyCodes.error(`[CabbyCodes] Source: ${source}:${lineno}:${colno}`);
            if (error && error.stack) {
                CabbyCodes.error(`[CabbyCodes] Stack trace:`);
                error.stack.split('\n').forEach(line => {
                    CabbyCodes.error(`[CabbyCodes]   ${line.trim()}`);
                });
            }
            
            // Log current call stats
            CabbyCodes.logCallStats();
            
            // Log applied patches
            if (typeof CabbyCodes.logAppliedPatches === 'function') {
                CabbyCodes.logAppliedPatches();
            }
            
            CabbyCodes.error(`[CabbyCodes] ========================================`);
        }
        
        // Call original error handler if it exists
        if (typeof originalErrorHandler === 'function') {
            return originalErrorHandler(message, source, lineno, colno, error);
        }
        return false;
    };

    /**
     * Catch unhandled promise rejections that might be stack overflows
     */
    window.addEventListener('unhandledrejection', function(event) {
        const error = event.reason;
        if (error instanceof RangeError && error.message && error.message.includes('Maximum call stack')) {
            CabbyCodes.error(`[CabbyCodes] ========================================`);
            CabbyCodes.error(`[CabbyCodes] UNHANDLED PROMISE REJECTION - STACK OVERFLOW`);
            CabbyCodes.error(`[CabbyCodes] ========================================`);
            CabbyCodes.error(`[CabbyCodes] ${error.message}`);
            if (error.stack) {
                CabbyCodes.error(`[CabbyCodes] Stack trace:`);
                error.stack.split('\n').forEach(line => {
                    CabbyCodes.error(`[CabbyCodes]   ${line.trim()}`);
                });
            }
            CabbyCodes.logCallStats();
            if (typeof CabbyCodes.logAppliedPatches === 'function') {
                CabbyCodes.logAppliedPatches();
            }
            CabbyCodes.error(`[CabbyCodes] ========================================`);
        }
    });

    CabbyCodes.log('[CabbyCodes] Debug module loaded');
})();

