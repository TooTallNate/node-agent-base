
/**
 * Module dependencies.
 */

var inherits = require('util').inherits;
var EventEmitter = require('events').EventEmitter;

/**
 * Module exports.
 */

module.exports = Agent;

/**
 *
 * @api public
 */

function Agent (callback) {
  if (!(this instanceof Agent)) return new Agent(callback);
  if ('function' != typeof callback) throw new Error('Must pass a "callback function"');
  EventEmitter.call(this);
  this.callback = callback;
}
inherits(Agent, EventEmitter);

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
    if (opts.host && opts.path) {
      // if both a `host` and `path` are specified then it's most likely the
      // result of a `url.parse()` call... we need to remove the `path` portion so
      // that `net.connect()` doesn't attempt to open that as a unix socket file.
      delete opts.path;
    }
  } else {
    // <= v0.10.x API
    opts = { host: host, port: port };
    if (null != localAddress) {
      opts.localAddress = localAddress;
    }
  }

  // hint to use "Connection: close"
  // XXX: non-documented `http` module API :(
  req._last = true;
  req.shouldKeepAlive = false;

  // create the `net.Socket` instance
  this.callback(req, opts, function (err, socket) {
    if (err) {
      req.emit('error', err);
    } else {
      req.onSocket(socket);
    }
  });
};
