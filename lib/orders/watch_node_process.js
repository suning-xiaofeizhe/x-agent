'use strict';

const utils = require('../utils');

const watched = {};
const notxnodes = {};

const watchInterval = 5000;

async function isXNode(pid, logger) {
  let isXnode = false;
  try {
    const info = await utils.execCommandAsync('check_node_process.js', [pid]);
    isXnode = JSON.parse(info).xnodeVersion;
  } catch (err) {
    logger.error(`check node process ${pid} failed: ${err}`);
  }
  return isXnode;
}

async function watchPid(pid, cmd, process, logger, callback) {
  if (!pid || watched[pid]) {
    return;
  }
  watched[pid] = true;
  if (notxnodes[process]) {
    return;
  }
  const isxnode = await isXNode(pid, logger);
  notxnodes[process] = !isxnode;
  if (!isxnode) {
    return;
  }

  logger.info(`start watching node process: ${pid}，cmd: ${cmd}`);
  const interval = setInterval(() => {
    if (!utils.isAlive(pid)) {
      logger.info(`node process exited: ${pid}, cmd: ${cmd}`);
      callback(null, {
        type: 'xagent_notification',
        metrics: { ok: true, data: { node_process_exit: { pid, cmd } } }
      });
      clearInterval(interval);
      delete watched[pid];
    }
  }, watchInterval);
}

async function watchNodeProcesses(logger, callback) {
  try {
    const processes = await utils.execCommandAsync('get_node_processes.js');
    for (let process of processes.split('\n')) {
      const result = utils.getPidAndCmd(process);
      if (result) {
        await watchPid(result.pid, result.command, process, logger, callback);
      }
    }
  } catch (err) {
    logger.error(`watch node process error: ${err}`);
  }
}

exports.run = function (callback, logger) {
  watchNodeProcesses(logger, callback);
};

exports.reportInterval = 30000;

exports.immediate = true;
