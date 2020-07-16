'use strict';

const files = process.argv.slice(2);
const fs = require('fs');

const results = {};

for (const file of files) {
  let checkfile = file;
  if (checkfile.includes('.gclog')) {
    results[file] = fs.existsSync(checkfile)
      || fs.existsSync(checkfile.replace('.gclog', '.gcprofile'));
  }
  results[file] = fs.existsSync(checkfile);
}

console.log(JSON.stringify(results));