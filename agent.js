
/**
 * Module dependencies.
 */

var net = require('net');
var inherits = require('util').inherits;
var EventEmitter = require('events').EventEmitter;

/**
 * Module exports.
 */

module.exports = Agent;

/**
 * Barebones HTTP "Agent" implementation. Emulates the node-core `http.Agent`
 * class, but implemented in a way that can be easily extended for additional
 * functionality.
 *
 * This base implementation does no socket pooling, and opens
 * a new connection for every HTTP request.
 *
 * It behaves more-or-less like `agent: false`.
 *
 * @api public
 */

function Agent () {
  if (!(this instanceof Agent)) return new Agent();
  EventEmitter.call(this);
}
inherits(Agent, EventEmitter);

/**
 * Default port to connect to.
 */

Agent.prototype.defaultPort = 80;

/**
 * Called by node-core's "_http_client.js" module when creating
 * a new HTTP request with this Agent instance.
 *
 * @api public
 */

Agent.prototype.addRequest = function (req, host, port, localAddress) {
  var opts;
  if ('object' == typeof host) {
    // >= v0.11.x API
    opts = host;
  } else {
    // <= v0.10.x API
    opts = {
      host: host,
      port: port,
      localAddress: localAddress
    };
  }

  // hint to use "Connection: close"
  req.shouldKeepAlive = false;

  // create the `net.Socket` instance
  var info = {
    host: opts.hostname || opts.host,
    port: +opts.port || this.defaultPort,
    localAddress: opts.localAddress
  };
  this.createConnection(info, function (err, socket) {
    if (err) {
      req.emit('error', err);
    } else {
      req.onSocket(socket);
    }
  });
};

/**
 * Creates and returns a `net.Socket` instance to use for an HTTP request.
 *
 * @api protected
 */

Agent.prototype.createConnection = function (opts, fn) {
  var socket = net.connect(opts);
  fn(null, socket);
  return socket;
};
