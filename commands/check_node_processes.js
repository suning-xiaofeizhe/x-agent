'use strict';

const pids = process.argv.slice(2);
const utils = require('../lib/utils');

const results = pids.reduce((res, pid) => {
  if (utils.isAlive(pid)) {
    res[pid] = true;
  } else {
    res[pid] = false;
  }
  return res;
}, {});

console.log(JSON.stringify(results));