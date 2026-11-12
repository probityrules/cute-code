import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const
    version = process.argv[2],
    root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
    changelogPath = path.join(root, 'CHANGELOG.md');

if (!version) {
    console.error('Usage: node scripts/extract-changelog.mjs <version>');
    process.exit(1);
}

const
    changelog = fs.readFileSync(changelogPath, 'utf8').replace(/\r\n/g, '\n'),
    // ## [1.2.3], ## 1.2.3, optional " - date" / " — date"
    headerRe = new RegExp(
        `^## \\[?${version.replace(/\./g, '\\.')}\\]?(?:\\s*[\\u2014\\u2013\\-]\\s*.*)?$`,
        'm'
    ),
    match = headerRe.exec(changelog);

if (!match) {
    console.error(`No CHANGELOG.md section found for version ${version}.`);
    process.exit(1);
}

const
    start = match.index,
    afterHeader = changelog.indexOf('\n', start),
    bodyStart = afterHeader === -1 ? changelog.length : afterHeader + 1,
    rest = changelog.slice(bodyStart),
    nextMatch = /^## /m.exec(rest),
    body = rest.slice(0, nextMatch ? nextMatch.index : undefined).trim();

if (!body) {
    console.error(`CHANGELOG.md section for version ${version} is empty.`);
    process.exit(1);
}

process.stdout.write(`## ${version}\n\n${body}\n`);
