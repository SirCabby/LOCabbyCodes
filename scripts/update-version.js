#!/usr/bin/env node

/**
 * Synchronize the CabbyCodes version string across source files.
 * Usage: node scripts/update-version.js 1.2.3
 */

const fs = require('node:fs');
const path = require('node:path');

const newVersion = process.argv[2];

if (!newVersion) {
    console.error('Usage: node scripts/update-version.js <version>');
    process.exit(1);
}

const versionPattern = /^\d+\.\d+\.\d+$/;
if (!versionPattern.test(newVersion)) {
    console.error(`Invalid version "${newVersion}". Use semantic format X.Y.Z`);
    process.exit(1);
}

function replaceInFile(filePath, replacer) {
    const absolutePath = path.resolve(filePath);
    const original = fs.readFileSync(absolutePath, 'utf8');
    const updated = replacer(original);
    if (updated === original) {
        console.warn(`[version] No changes applied to ${filePath}`);
    }
    fs.writeFileSync(absolutePath, updated, 'utf8');
    console.log(`[version] Updated ${filePath}`);
}

const coreFile = path.join(__dirname, '..', 'CabbyCodes', 'cabbycodes-core.js');
replaceInFile(coreFile, (contents) => {
    const regex = /CabbyCodes\.version\s*=\s*'[^']*';/;
    if (!regex.test(contents)) {
        throw new Error(`CabbyCodes.version marker not found in ${coreFile}`);
    }
    return contents.replace(regex, `CabbyCodes.version = '${newVersion}';`);
});

console.log(`[version] Version synchronized to ${newVersion}`);

