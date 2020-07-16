'use strict';

const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');
const uuid = require('uuid/v4');
const Connection = require('./lib/connection');
const utils = require('./lib/utils');
const packageInfo = require('./package.json');
const AGENT_VERSION = packageInfo.version;

const AgentState = {
  INIT: 'init',
  WORK: 'work',
  CLOSED: 'closed',
  REGISTERING: 'registering'
};

let notReConnected = false;

class Agent extends EventEmitter {
  constructor(config) {
    if (!config.server || !config.appid || !config.secret || !config.logdir) {
      const error = `配置文件: ${JSON.stringify(config)} 错误，请确保以下参数配置正确: ` +
        'server, appid, secret, logdir';
      throw new Error(error);
    }
    super();
    // config
    this.logger = config.logger || utils.getLogger(config.log_level || 2);
    this.config = config;
    this.conn = null;
    this.server = config.server;
    this.appId = config.appid;
    this.secret = config.secret;
    this.agentIdMode = config.agentIdMode;
    this.libMode = config.libMode;
    this.packages = config.packages || [];
    this.error_log = [];

    // connect handle
    this.state = AgentState.INIT;
    this.heartbeatMissCount = 0;

    // heartbeat
    this.heartbeatTimer = null;
    this.heartbeatInterval = config.heartbeatInterval * 1000 || 60000;

    // reconnect
    this.reconnectTimer = null;
    this.reconnectDelayBase = config.reconnectDelayBase * 1000 || 3000;
    this.reconnectDelay = config.reconnectDelay * 1000 || 10000;

    // register message
    this.registerTimer = null;
    this.registerRetryDelay = 5000;

    // report
    this.connectSockets = 0;
    this.reportInterval = (config.reportInterval || 60) * 1000;
    if (process.env.XNODE_AGENT_TEST !== 'YES' && this.reportInterval < 60000) {
      throw new Error('report interval should not less than 60s');
    }

    // for test clearing local interval
    this.monitorIntervalList = [];

    // start
    this.handleMonitor();
  }

  run() {
    this.conn = new Connection(this.server, this.logger);
    this.handleConnection();
    ++this.connectSockets;
  }

  handleConnection() {
    const conn = this.conn;
    let onerror, onclose, cleanup;

    onerror = err => {
      cleanup();
      this.onError(err);
    };

    onclose = () => {
      cleanup();
      this.onClose();
    };

    cleanup = function () {
      conn.removeListener('error', onerror);
      conn.removeListener('close', onclose);
    };

    conn.on('open', () => {
      this.onOpen();
    });
    conn.on('message', (data) => {
      this.onMessage(data);
    });
    conn.on('error', onerror);
    conn.on('close', onclose);
  }

  onOpen() {
    this.logger.info('x-agentserver connected.');
    this.sendRegisterMessage();
    this.state = AgentState.REGISTERING;
    this.registerTimer = setInterval(() => {
      if (this.state === AgentState.REGISTERING) {
        this.sendRegisterMessage();
      }
    }, this.registerRetryDelay);
  }

  onClose() {
    this.logger.error('connection closed');
    if (!notReConnected) {
      this.reconnect();
    }
  }

  onError(err) {
    this.logger.error(`get an error: ${err}`);
    this.reconnect();
  }

  sendRegisterMessage() {
    this.logger.info('send register message.');
    const params = {
      version: AGENT_VERSION,
      pid: process.pid
    };

    const message = {
      type: 'register',
      params: params,
    };

    this.sendMessage(message);
  }

  signature(message) {
    return utils.sha1(JSON.stringify(message), this.secret);
  }

  sendMessage(message, traceId) {
    message.appId = this.appId;
    message.agentId = utils.getTagedAgentID(this.agentIdMode);
    message.id = utils.uid();
    message.traceId = traceId || uuid();
    message.timestamp = Date.now();
    const signature = this.signature(message);
    message.signature = signature;
    if (this.conn && typeof this.conn.sendMessage === 'function') {
      this.logger.debug(`>>>>>>>>>>>>>>>>>>>>>> send message to server: ${JSON.stringify(message)}`);
      this.conn.sendMessage(message);
    }
  }

  onMessage(message) {
    this.logger.debug(`<<<<<<<<<<<<<<<<<<<<<< receive message from server: ${JSON.stringify(message)}`);
    const type = message.type;
    const params = message.params || {};
    const signature = message.signature;
    let err;
    // shut down xagent
    if (message.type === 'shutdown') {
      this.teardown();
      clearTimeout(this.reconnectTimer);
      this.monitorIntervalList.forEach(clearInterval);
      notReConnected = true;
      this.logger.error(`shutdown message: ${JSON.stringify(message)}`);
      if (!this.libMode && process.send) {
        process.send({ type: 'suicide' });
        process.exit(0);
      }
      return;
    }

    // signature error
    if (!signature) {
      if (type === 'error') {
        this.logger.info(`signature error: ${params.error}`);
        err = new Error(String(params.error || 'signature unknow error'));
        err.name = 'XNodeSignatureError';
        this.logger.error(err);
        return;
      }
    }

    delete message.signature;

    if (signature !== this.signature(message)) {
      this.logger.error(`signature error, ignore it, message id: ${message.id}, raw message: ${JSON.stringify(message)}`);
      return;
    }

    switch (type) {
    case 'result':  //register and heartbeat ack
      if (params.result === 'REG_OK') {
        this.logger.info('agent register ok.');
        this.state = AgentState.WORK;
        this.stopRegister();
        this.startHeartbeat();
        this.emit('ready');
      } else if (params.result === 'HEARTBEAT_ACK') {
        this.heartbeatMissCount = 0;
      }
      break;

    case 'command':
      this.execCommand(params, message.traceId);
      break;

    default:
      this.logger.error('message type: %s not supported', type);
      break;
    }
  }

  execCommand(params, traceId) {
    const command = params.command;
    const opts = {
      timeout: params.timeout || 3000,
      env: Object.assign({
        logdir: this.config.logdir,
        agentid: utils.getTagedAgentID(this.agentIdMode)
      }, process.env, params.env || {})
    };
    this.logger.debug(`execute command: ${command}, traceId: ${traceId}`);
    const parts = command.split(' ');
    const cmd = parts[0];
    const args = parts.slice(1);

    const file = path.join(__dirname, './commands', cmd);
    args.unshift(`${file}.js`);
    utils.execCommand('node', args, opts, (err, stdout, stderr) => {
      this.sendResultMessage(traceId, err, stdout, stderr);
    });
  }

  sendResultMessage(traceId, err, stdout, stderr) {
    this.logger.debug(`send result message. traceId: ${traceId}`);
    const params = { ok: false };
    if (err) {
      params.message = err.message;
    } else {
      params.ok = true;
      params.data = { stdout, stderr };
    }
    const message = { type: 'result', params };
    this.sendMessage(message, traceId);
  }

  stopRegister() {
    clearInterval(this.registerTimer);
    this.registerTimer = null;
  }

  startHeartbeat() {
    let id = 100;
    this.heartbeatMissCount = 0;

    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
    }

    this.heartbeatTimer = setInterval(() => {
      if (this.heartbeatMissCount >= 3) {
        this.logger.error(`heartbeat missed ${this.heartbeatMissCount} times.`);
        this.reconnect();
        return;
      }
      if (this.state === AgentState.WORK) {
        this.sendHeartbeatMessage(id++);
        this.heartbeatMissCount++;
      }
    }, this.heartbeatInterval);
  }

  reconnect() {
    this.teardown();
    // delay 3 - 10s
    const delay = utils.random(this.reconnectDelayBase, this.reconnectDelay);
    this.logger.info(`Try to connect after ${delay / 1000}s.`);
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      // delay and retry
      this.run();
    }, delay);
  }

  teardown() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
    }

    if (this.registerTimer) {
      clearInterval(this.registerTimer);
    }

    this.state = AgentState.CLOSED;
    if (this.conn) {
      --this.connectSockets;
      this.conn.close();
      this.conn = null;
    }
  }

  sendHeartbeatMessage(id) {
    this.logger.debug(`send heartbeat message. id: ${id}`);
    const params = { interval: this.heartbeatInterval };
    const message = {
      type: 'heartbeat',
      params: params
    };
    this.sendMessage(message);
  }

  reportCallback(err, params) {
    if (err) {
      this.logger.error(err);
      return;
    }

    if (!params) {
      return;
    }

    if (Array.isArray(params) && params.length === 0) {
      return;
    }

    this.sendMessage({
      type: 'log',
      params: params
    });
  }

  handleMonitor() {
    const orderPath = path.join(__dirname, 'lib/orders');
    const orders = fs.readdirSync(orderPath);
    // wait for ws connected & registrer ready
    this.once('ready', () => {
      this.logger.info('start execute orders.');
      orders.forEach(order => {
        const origin = order;
        order = require(path.join(orderPath, order));
        this.logger.info(`- ${origin}, immediate: ${order.immediate}`);
        if (typeof order.init === 'function') {
          order.init(this.config);
        }
        if (order.immediate) {
          order.run(this.reportCallback.bind(this), this.logger);
        }
        const intervalTime = order.reportInterval || this.reportInterval;
        const interval = setInterval(() => {
          order.run(this.reportCallback.bind(this), this.logger);
        }, intervalTime);
        this.monitorIntervalList.push(interval);
      });
    });
  }
}

module.exports = Agent;
