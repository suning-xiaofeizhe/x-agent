#!/usr/bin/env node
'use strict';

const os = require('os');
const fs = require('fs');
const path = require('path');
const child_process = require('child_process');
const spawn = child_process.spawn;

const utils = require('../lib/utils');

const SPLITTER = '\u0000';

const xagentBin = path.join(__dirname, 'xagent_main');
const xagentStatusPath = path.join(os.homedir(), '.xagent');

// make sure the ~/.xagent file exists
if (!fs.existsSync(xagentStatusPath)) {
  fs.closeSync(fs.openSync(xagentStatusPath, 'w'));
}

const listHeader =
  '|- App ID -|- PID -|---- Start Time -----|--- Config Path ------------------------------------|';

const listFooter =
  '|----------|-------|---------------------|----------------------------------------------------|';

function pad(n) {
  if (n < 10) {
    return '0' + n;
  }

  return '' + n;
}

function timestamp(time) {
  var date = new Date();
  date.setTime(+time);
  const YYYY = date.getFullYear();
  const MM = pad(date.getMonth() + 1);
  const DD = pad(date.getDate());
  const HH = pad(date.getHours());
  const mm = pad(date.getMinutes());
  const ss = pad(date.getSeconds());
  return `${YYYY}-${MM}-${DD} ${HH}:${mm}:${ss}`;
}

function format(data, width) {
  data = data.toString();
  if (data.length >= width) {
    return data;
  }
  // 靠右对齐
  return ' '.repeat(width - data.length) + data;
}

function contentShaping(appid, pid, config, startTime) {
  appid = format(appid, 8);
  pid = format(pid, 5);
  config = format(config, 40);
  startTime = timestamp(startTime);
  return '| ' + [appid, pid, startTime, config].join(' | ') + ' |';
}

function appendXAgentStatus(appid, pid, config) {
  const line = [appid, pid, config, Date.now()].join(SPLITTER) + '\n';
  fs.appendFileSync(xagentStatusPath, line);
}

function killRunning(pid) {
  if (!pid) { return false; }
  try {
    process.kill(pid);
  } catch (ex) {
    return false;
  }
}

function isAppid(appid) {
  if (!appid) {
    return false;
  }

  appid = appid.toString();
  if (appid.length === 0) {
    return false;
  }

  return /\d*/.test(appid);
}

function start(configPath) {
  if (!configPath) {
    console.log('config.json not provided.');
    console.log();
    console.log('Usage: ');
    console.log('    xagent start /path/to/config.json');
    process.exit(1);
  }

  configPath = path.resolve(configPath);
  if (!fs.existsSync(configPath)) {
    console.log('%s not exists.', configPath);
    process.exit(1);
  }

  if (!configPath.endsWith('.json')) {
    console.log('%s must be a JSON file.', configPath);
    process.exit(1);
  }

  var cfg;
  try {
    cfg = require(configPath);
  } catch (ex) {
    console.log('%s must be a valid JSON file.', configPath);
    console.log('Error stack:');
    console.log(ex.stack);
    process.exit(1);
  }

  if (!cfg.appid || !cfg.secret) {
    console.log('`appid` and `secret` must be provided.');
    process.exit(1);
  }

  var appid = cfg.appid;
  const logPath = path.join(os.homedir(), '.xagent.log');
  const out = fs.openSync(logPath, 'a');
  const err = fs.openSync(logPath, 'a');
  const proc = spawn('node', [xagentBin, configPath], {
    detached: true,
    stdio: ['ipc', out, err],
    env: process.env
  });
  if (proc.pid) {
    console.log('xagent has started(pid: %s).', proc.pid);
    appendXAgentStatus(appid, proc.pid, configPath);
  } else {
    console.log('xagent started failed.');
  }
  process.exit(0);
}

function getAlives() {
  var raw = fs.readFileSync(xagentStatusPath, 'utf8').trim().split('\n');
  var xagents = raw.filter(function (line) {
    return line.length > 0;
  }).map(function (line) {
    const [appid, pid, config, startTime] = line.split(SPLITTER);
    return { appid, pid, config, startTime };
  });

  var alives = xagents.filter(function (item) {
    return utils.isAlive(item.pid);
  });

  return alives;
}

function writeBackAlives(alives) {
  fs.writeFileSync(xagentStatusPath, alives.map((item) => {
    return [item.appid, item.pid, item.config, item.startTime]
      .join(SPLITTER) + '\n';
  }).join(''));
}

function list() {
  /*
   * get from ~/.xagent.pid
   * return [{appid: 123, pid: 3868, config: '/path/to/config.json'}, ... ]
   */
  if (!fs.existsSync(xagentStatusPath)) {
    console.log('There is no running xagent.');
    process.exit(0);
  }

  const alives = getAlives();

  writeBackAlives(alives);

  if (alives.length === 0) {
    console.log('There is no running xagent.');
    process.exit(0);
  }

  console.log(listHeader);
  alives.forEach(function (item) {
    console.log(contentShaping(item.appid, item.pid, item.config, item.startTime));
  });
  console.log(listFooter);
  process.exit(0);
}

function stopAll() {
  const alives = getAlives();
  alives.forEach(function (item) {
    killRunning(item.pid);
  });

  writeBackAlives([]);
}

function stopApp(appid) {
  const alives = getAlives();
  if (!alives.find(function (item) {
    return item.appid === appid;
  })) {
    console.log(`There is no running xagent for appid: ${appid}.`);
    return;
  }

  const newlist = alives.filter(function (item) {
    if (item.appid === appid) {
      killRunning(item.pid);
      return false;
    }
    return true;
  });

  writeBackAlives(newlist);
}

function stop(input) {
  if (input === 'all') {
    stopAll();
    process.exit(0);
  } else if (isAppid(input)) {
    stopApp(input);
    process.exit(0);
  } else {
    console.log('xagent stop all      stop all xagents');
    console.log('xagent stop <appid>  stop the xagent(s) for appid');
    process.exit(1);
  }
}

const argv = process.argv.slice(2);

if (argv.length < 1) {
  console.log(utils.helpText);
  process.exit(1);
}

switch (argv[0]) {
case '-v':
case '--version':
case 'version':
  console.log(require('../package.json').version);
  process.exit(0);
  break;
case '-h':
case '--help':
case 'help':
  console.log(utils.helpText);
  process.exit(0);
  break;
case 'start':
  start(argv[1]);
  break;
case 'list':
  list();
  break;
case 'stop':
  stop(argv[1]);
  break;
default:
  console.log(utils.helpText);
  process.exit(1);
}
