'use strict';

const fs = require('fs');
const path = require('path');
const through = require('through2');
const split = require('split2');
const moment = require('moment');

const MAX_LINES = 250;
const PERFORMANCE_LOG_TYPE = ['gc', 'cpu', 'memory', 'uv', 'http'];
let buffered = [];
let fileType = 'xprofiler';
exports.logdir = '';

const map = new Map();

const patt = /\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\] \[(\d{1,3}.\d{1,3}.\d{1,3})\] \[(.+)\] \[(.+)\] \[(\d+)\] (.*)/g;
const xprofilerPatt = /\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\] \[(.+)\] \[(.+)\] \[(\d+)\] \[(\d{1,3}\.\d{1,3}\.\d{1,3}.*)\] (.*)/g;
const reg = /([^\s]*): (\d+(\.\d{0,2})?)/g;

function convertNodeLog(item, value) {
  const items = [];
  // cpu
  if (item === 'cpu_now') {
    items.push({ item: 'now', value });
  }
  // gc
  else if (item === 'gc_time_during_last_record') {
    items.push({ item: 'gc_time_during_last_min', value });
  }
  else if (item === 'total_gc_duration') {
    items.push({ item: 'total', value });
  }
  else if (item === 'scavange_duration_last_record') {
    items.push({ item: 'scavange_duration', value });
  }
  else if (item === 'marksweep_duration_last_record') {
    items.push({ item: 'marksweep_duration', value });
  }
  else if (item === 'total_scavange_duration') {
    items.push({ item: 'scavange_duration_total', value });
  }
  else if (item === 'total_marksweep_duration') {
    items.push({ item: 'marksweep_duration_total', value });
  }
  // libuv handles
  else if (item === 'active_file_handles') {
    items.push({ item: 'file_handles_active', value });
    items.push({ item: 'file_handles_inactive', value: 0 });
  }
  else if (item === 'active_tcp_handles') {
    items.push({ item: 'tcp_handles_active', value });
    items.push({ item: 'tcp_handles_inactive', value: 0 });
  }
  else if (item === 'active_udp_handles') {
    items.push({ item: 'udp_handles_active', value });
    items.push({ item: 'udp_handles_inactive', value: 0 });
  }
  else if (item === 'active_timer_handles') {
    items.push({ item: 'timer_handles_active', value });
    items.push({ item: 'timer_handles_inactive', value: 0 });
  }
  // other
  else {
    items.push({ item, value });
  }

  return items;
}

const getNodeLog = function (msg) {
  let matched;
  const result = { ok: true, data: [] };
  if (fileType === 'xprofiler') {
    while ((matched = xprofilerPatt.exec(msg)) !== null) {
      result.xnode_version = matched[4];
      const level = matched[1];
      if (level !== 'info') {
        continue;
      }
      const type = matched[2];
      if (!PERFORMANCE_LOG_TYPE.includes(type)) {
        continue;
      }
      const pid = matched[3];
      const detail = matched[5];
      let pair;
      while ((pair = reg.exec(detail)) !== null) {
        const items = convertNodeLog(pair[1], parseFloat(pair[2]));
        items.forEach(({ item, value }) => result.data.push({ pid, item, value }));
      }
    }
  } else {
    while ((matched = patt.exec(msg)) !== null) {
      result.xnode_version = matched[1];
      const level = matched[2];
      if (level !== 'info') {
        continue;
      }
      const type = matched[3];
      if (!PERFORMANCE_LOG_TYPE.includes(type)) {
        continue;
      }
      const pid = matched[4];
      const detail = matched[5];
      let pair;
      while ((pair = reg.exec(detail)) !== null) {
        result.data.push({
          pid: pid,
          item: pair[1],
          value: parseFloat(pair[2])
        });
      }
    }
  }
  return result;
};

const getCurrentLogPath = function () {
  const oldpath = path.join(exports.logdir, `xnode-${moment().format('YYYYMMDD')}.log`);
  const newpath = path.join(exports.logdir, `xprofiler-${moment().format('YYYYMMDD')}.log`);
  let currentPath = '';
  if (fs.existsSync(oldpath) & !fs.existsSync(newpath)) {
    currentPath = oldpath;
    fileType = 'xnode';
  } else {
    currentPath = newpath;
    fileType = 'xprofiler';
  }
  return currentPath;
};

const readFile = function (filepath, callback) {
  fs.stat(filepath, function (err, stats) {
    if (err) {
      if (err.code === 'ENOENT') {
        return callback(null);
      }
      return callback(err);
    }

    if (!stats.isFile()) {
      return callback(new Error(filepath + ' is not a file'));
    }

    let start = map.get(filepath) || 0;
    if (stats.size === start) {
      return callback(null);
    }

    const readable = fs.createReadStream(filepath, { start });
    readable.pipe(split()).pipe(through(function (line, _, next) {
      if (line.length) {
        buffered.push(line);
        if (buffered.length > MAX_LINES) {
          buffered.shift();
        }
      }
      next();
    }));

    readable.on('data', function (data) {
      start += data.length;
    });

    readable.on('end', function () {
      map.set(filepath, start);
      callback(null);
    });
  });
};

const readLog = function (callback) {
  const currentPath = getCurrentLogPath();
  const current = map.get('currentFile');

  if (currentPath !== current) {
    map.set('currentFile', currentPath);
    readFile(current, function (err) {
      if (err) {
        return callback(err);
      }
      readFile(currentPath, callback);
    });
  } else {
    readFile(currentPath, callback);
  }
};

exports.init = function (config) {
  exports.logdir = config.logdir;
  const currentPath = getCurrentLogPath();
  map.set('currentFile', currentPath);
  if (fs.existsSync(currentPath)) {
    map.set(currentPath, fs.statSync(currentPath).size);
  }
  buffered = [];
};

exports.run = function (callback) {
  if (!exports.logdir) {
    return callback(new Error('Not specific logdir in xagent config file'));
  }

  readLog(function (err) {
    if (err) {
      return callback(err);
    }

    const message = buffered.join('\n');
    // clean
    buffered = [];
    callback(null, {
      type: 'node_log',
      metrics: getNodeLog(message)
    });
  });
};


exports.immediate = false;