'use strict';

const EventEmitter = require('events');
const WebSocket = require('ws');

// Connection utils
class Connection extends EventEmitter {
  constructor(server, logger) {
    super();
    this.ws = new WebSocket(server);
    this.logger = logger;
    logger.info('connecting to ' + server + '...');
    this.handleEvents();
  }

  handleEvents() {
    const ws = this.ws;
    // connected
    ws.on('open', () => {
      this.emit('open');
    });

    // error occured
    ws.on('error', err => {
      this.emit('error', err);
    });

    // socket closed
    ws.on('close', () => {
      this.logger.info('Websocket closed.');
      this.emit('close');
    });

    // message received
    ws.on('message', data => {
      try {
        const message = JSON.parse(data);
        this.emit('message', message);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(err);
        this.logger.debug(`message handle error: ${error.stack}`);
      }
    });
  }

  sendMessage(message) {
    this.ws.send(JSON.stringify(message), err => {
      if (err) {
        this.logger.error('send message when connected not ok.');
        this.ws.close();
      }
    });
  }

  close() {
    this.ws.close();
  }
}

module.exports = Connection;
