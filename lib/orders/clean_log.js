'use strict';

const fs = require('fs');
const path = require('path');
const moment = require('moment');
const utils = require('../utils');

exports.logdir = '';

const KEEP_DAYS = 7;

const removeFiles = function (logdir, files, callback) {
  let count = files.length;
  if (count === 0) {
    return callback(null);
  }

  const done = function (err) {
    if (err) {
      return callback(err);
    }

    count--;
    if (count <= 0) {
      callback(null);
    }
  };

  for (let i = 0; i < files.length; i++) {
    const filename = files[i];
    const filepath = path.join(logdir, filename);
    console.log('clean old log or socket file: %s', filepath);
    fs.unlink(filepath, done);
  }
};

const xnodeLogPatt = /^(xnode)-(\d{8})\.log$/;
const xprofilerPatt = /^(xprofiler)-(\d{8})\.log$/;
const xprofilerErrorPatt = /^(xprofiler-error)-(\d{8})\.log$/;
const xprofilerDebugPatt = /^(xprofiler-debug)-(\d{8})\.log$/;
const xnodeSocketPatt = /^(xnode-uds-path)-(\d+)\.sock$/;
const xprofilerSocketPatt = /^(xprofiler-uds-path)-(\d+)\.sock$/;

const cleanOldLogs = function (callback) {
  fs.readdir(exports.logdir, function (err, files) {
    if (err) {
      return callback(err);
    }

    const today = moment();

    const logs = files.filter(filename => {
      const matched = filename.match(xnodeLogPatt)
        || filename.match(xprofilerPatt)
        || filename.match(xprofilerErrorPatt)
        || filename.match(xprofilerDebugPatt);
      if (matched) {
        const pass = moment(matched[2]);
        const diff = today.diff((pass), 'days');
        return diff >= KEEP_DAYS;
      }
      return false;
    });

    const sockets = files.filter(filename => {
      const matched = filename.match(xnodeSocketPatt)
        || filename.match(xprofilerSocketPatt);
      if (matched) {
        const pid = parseInt(matched[2]);
        if (isNaN(pid) || !utils.isAlive(pid)) {
          return true;
        }
      }
      return false;
    });

    const needCleanFiles = [].concat(logs).concat(sockets);

    removeFiles(exports.logdir, needCleanFiles, callback);
  });
};

exports.init = function (config) {
  exports.logdir = config.logdir;
};

exports.run = function (callback) {
  if (!exports.logdir) {
    return callback(new Error('Not specific logdir in agentx config file'));
  }

  cleanOldLogs(function (err) {
    if (err) {
      return callback(err);
    }

    // nothing to report
    callback(null);
  });
};

exports.reportInterval = 24 * 60 * 60 * 1000; // 1 day

exports.immediate = true;
