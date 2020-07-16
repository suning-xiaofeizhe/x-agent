'use strict';

const os = require('os');
const path = require('path');
const crypto = require('crypto');
const moment = require('moment');
const pkg = require('../package.json');
const execFile = require('child_process').execFile;
const address = require('address');

const logger = {
  infoConsole(str) {
    return `\x1b[35;1m${str}\x1b[0m`;
  },

  infoConsole2(str) {
    return `\x1b[32;1m${str}\x1b[0m`;
  },

  debugConsole(str) {
    return `\x1b[36;1m${str}\x1b[0m`;
  },

  errorConsole(str) {
    return `\x1b[31;1m${str}\x1b[0m`;
  },

  warnConsole(str) {
    return `\x1b[33;1m${str}\x1b[0m`;
  },

  lineConsole(str) {
    return `\x1b[4;1m${str}\x1b[0m`;
  }
};

class Logger {
  constructor(level) {
    this.level = level;
  }

  getPrefix(level) {
    return `[${moment(Date.now()).format('YYYY-MM-DD HH:mm:ss')}] [${pkg.version}] [${level}] [${process.pid}]`;
  }

  error(msg) {
    if (this.level >= 0) {
      console.error(`${this.getPrefix('error')} ${msg}`);
    }
  }

  info(msg) {
    if (this.level >= 1) {
      console.log(`${this.getPrefix('info')} ${msg}`);
    }
  }

  warn(msg) {
    if (this.level >= 2) {
      console.log(`${this.getPrefix('warn')} ${msg}`);
    }
  }

  debug(msg) {
    if (this.level >= 3) {
      console.log(`${this.getPrefix('debug')} ${msg}`);
    }
  }
}

exports.getLogger = function (level) {
  return new Logger(level);
};

exports.getTagedAgentID = function (agentidMode) {
  if (agentidMode !== 'IP') {
    return os.hostname();
  }
  return `${address.ip()}_${os.hostname()}`;
};

let uid = 1000;
exports.uid = function () {
  return uid++;
};

exports.sha1 = function (str, key) {
  return crypto.createHmac('sha1', key).update(str).digest('hex');
};

exports.random = function (min, max) {
  return Math.floor(min + Math.random() * (max - min));
};

exports.helpText = `
Usage: xagent [CMD]... [ARGS]

  ${logger.infoConsole('-v --version')}           show xagent version
  ${logger.infoConsole('version')}
  ${logger.infoConsole('-h --help')}              show this usage
  ${logger.infoConsole('help')}
  ${logger.infoConsole('list')}                   show running xagent(s)
  ${logger.infoConsole('start config.json')}      start xagent with config.json
  ${logger.infoConsole('stop all')}               stop all running xagent(s)
  ${logger.infoConsole('stop appid')}             stop running xagent(s) for the appid
`;

exports.execCommand = function (file, args, opts, callback) {
  execFile(file, args, opts, callback);
};

exports.execCommandAsync = function (file, args = [], opts = {}) {
  return new Promise((resolve, reject) => {
    file = path.join(__dirname, '../commands', file);
    args.unshift(file);
    exports.execCommand(
      'node',
      args,
      Object.assign({}, exports.execCommonOptions, opts),
      (err, stdout, stderr) => {
        if (err) {
          reject(err);
          return;
        }
        if (stderr.toString().trim()) {
          reject(stderr.toString().trim());
          return;
        }
        resolve(stdout.toString().trim());
      });
  });
};

exports.isAlive = function (pid) {
  try {
    return process.kill(pid, 0);
  } catch (ex) {
    return false;
  }
};

exports.getPidAndCmd = function (proc) {
  const result = {};
  let processRegexp;
  if (os.platform() === 'win32') {
    processRegexp = /^(.*) (\d+)$/;
  } else {
    processRegexp = /^(\d+) (.*)$/;
  }
  const parts = processRegexp.exec(proc.trim());
  if (parts) {
    if (os.platform() === 'win32') {
      result.pid = parts[2];
      result.command = parts[1];
    } else {
      result.pid = parts[1];
      result.command = parts[2];
    }
  }

  return result;
};

exports.execCommonOptions = {
  timeout: 2000,
  env: process.env
};

exports.pad2 = function (num) {
  if (num < 10) {
    return '0' + num;
  }
  return '' + num;
};

exports.resolveYYYYMMDDHH = function (str) {
  var now = new Date();
  return str.replace('#YYYY#', now.getFullYear())
    .replace('#MM#', exports.pad2(now.getMonth() + 1))
    .replace('#DD#', exports.pad2(now.getDate()))
    .replace('#HH#', exports.pad2(now.getHours()));
};