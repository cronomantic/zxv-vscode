import * as fs from 'fs';
import Mocha = require('mocha');
import * as path from 'path';

export function run(): Promise<void> {
    const mocha = new Mocha({ ui: 'bdd', color: true, timeout: 120000, grep: process.env.ZXV_TEST_GREP || undefined });
    for (const f of fs.readdirSync(__dirname))
        if (f.endsWith('.test.js'))
            mocha.addFile(path.join(__dirname, f));
    return new Promise((resolve, reject) => {
        mocha.run(failures => (failures ? reject(new Error(`${failures} pruebas fallan`)) : resolve()));
    });
}
