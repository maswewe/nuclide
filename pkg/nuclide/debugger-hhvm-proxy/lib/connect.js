'use babel';
/* @flow */

/*
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 */


var {
  log,
  parseDbgpMessage,
  pathToUri,
} = require('./utils');

/**
 * Connect to requested dbgp debuggee on given port.
 *
 * Starts listening for socket connections on the given port.
 * Waits for dbgp init connection message for each connection.
 * If the connection matches the given pid/ideky/path then
 * resolve with the connection and stop listening for new
 * connections.
 * If the connection does not match the given pid/idekey/path
 * then close the connection and continue waiting for a match.
 *
 * TODO: Add timeout or cancel callback.
 */
function getFirstConnection(
  port: number,
  pid: ?number,
  idekey: ?string,
  path: ?string): Promise<Socket> {

  log('Creating debug server on port ' + port);

  var server = require('net').createServer();
  server.on('close', socket => log('Closing port ' + port));
  server.listen(port, () => log('Listening on port ' + port));

  var connected = false;

  function onSocketConnection(socket: Socket, accept: (socket: Socket) => void) {
    log('Connection on port ' + port);
    if (checkForExistingConnection(socket, 'Connection')) {
      return;
    }
    socket.once('data', data => onSocketData(socket, data, accept));
  }

  function onServerError(error: Object, reject: (reason: Object) => void): void {
    if (error.code === 'EADDRINUSE') {
      log('Port in use ' + port);
    } else {
      log('Unknown socket error ' + error.code);
    }
    server.close();
    reject(error);
  }

  function onSocketData(socket: Socket, data: Buffer | string, accept: (socket: Socket) => void): void {
    if (checkForExistingConnection(socket, 'Data')) {
      return;
    }

    var message;
    try {
      message = parseDbgpMessage(data.toString());
    } catch (error) {
      log('Non XML connection string: ' + data.toString() + '. Discarding connection.');
      socket.end();
      socket.destroy();
      return;
    }

    if (isCorrectConnection(message)) {
      connected = true;
      server.close();
      accept(socket);
    } else {
      log('Discarding connection ' + JSON.stringify(message));
      socket.end();
      socket.destroy();
    }
  }

  /**
   * Checks if a connection already exists. If it does, then close the new socket.
   */
  function checkForExistingConnection(socket: Socket, message: string): void {
    if (connected) {
      log('Ignoring ' + message + ' on port ' + port + ' after successful connection.');
      socket.end();
      socket.destroy();
    }
    return connected;
  }

  function isCorrectConnection(message: Object): boolean {
    if (!message || !message.init || !message.init.$) {
      log('Incorrect init');
      return false;
    }

    var init = message.init;
    if (!init.engine || !init.engine || !init.engine[0] || init.engine[0]._ !== 'xdebug') {
      log('Incorrect engine');
      return false;
    }

    var attributes = init.$;
    if (attributes.xmlns !== 'urn:debugger_protocol_v1'
      || attributes['xmlns:xdebug'] !== 'http://xdebug.org/dbgp/xdebug'
      || attributes.language !== 'PHP') {
        log('Incorrect attributes');
        return false;
    }

    return (pid === null || attributes.appid === String(pid)) &&
      (idekey === null || attributes.idekey === idekey) &&
      (path === null || attributes.fileuri === pathToUri(path));
  }

  return new Promise((resolve, reject) => {
    server.on('error', error => onServerError(error, reject));
    server.on('connection', socket => onSocketConnection(socket, resolve));
  });
}

module.exports = {
  getFirstConnection,
};
