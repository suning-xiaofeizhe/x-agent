'use strict';

const fs = require('fs');
const path = require('path');

exports.packages = [];

exports.reportInterval = 60 * 60 * 1000; // 1h

exports.immediate = true;

exports.init = function (config) {
  exports.packages = config.packages;
};

exports.run = function (callback) {
  const packages = exports.packages;
  if (!Array.isArray(packages) || packages.length === 0) {
    callback(null, {
      type: 'xagent_notification',
      metrics: { ok: true, data: { packages: [] } }
    });
    return;
  }

  const results = [];
  for (const pkg of packages) {
    if (!fs.existsSync(pkg)) {
      continue;
    }
    const data = {};
    data.package = fs.readFileSync(pkg, 'utf8');
    const lockfile = path.join(path.dirname(pkg), 'package-lock.json');
    if (fs.existsSync(lockfile)) {
      data.packageLock = fs.readFileSync(lockfile, 'utf8');
    }
    results.push(data);
  }

  callback(null, {
    type: 'xagent_notification',
    metrics: { ok: true, data: { packages: results } }
  });
};